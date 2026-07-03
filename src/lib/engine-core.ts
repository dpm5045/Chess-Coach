import { Chess } from "chess.js";
import { MoveDetail, uciToSan, uciLineToSan } from "./chess-utils";
import { PositionEval, EvalDrop, MissedMateInOne } from "./types";

/**
 * Shared engine-analysis core used by the browser Stockfish path
 * (src/lib/stockfish.ts), the server (/api/analyze), and
 * scripts/batch-analyze.ts.
 *
 * PERSPECTIVE CONVENTION: raw UCI scores are from the side-to-move's
 * perspective (verified empirically against the stockfish npm package).
 * Everything downstream of toWhitePov() is white-POV: positive = White
 * better, mate > 0 = White delivers mate.
 */

export const MATE_SCORE_CP = 10000;

export interface RawEvalResult {
  scoreCp: number;
  mate: number | null;
  bestLine: string[];
  depth: number;
}

/** Parse UCI output, taking the last "info depth" line that carries a score. */
export function parseUciInfoLines(lines: string[]): RawEvalResult {
  const infoLines = lines.filter(
    (l) => l.startsWith("info depth") && / score /.test(l)
  );
  const last = infoLines[infoLines.length - 1];
  if (!last) return { scoreCp: 0, mate: null, bestLine: [], depth: 0 };

  const cp = last.match(/score cp (-?\d+)/);
  const mate = last.match(/score mate (-?\d+)/);
  const pv = last.match(/ pv (.+)/);
  const depth = last.match(/depth (\d+)/);

  return {
    scoreCp: cp ? parseInt(cp[1], 10) : 0,
    mate: mate ? parseInt(mate[1], 10) : null,
    bestLine: pv ? pv[1].split(" ") : [],
    depth: depth ? parseInt(depth[1], 10) : 0,
  };
}

function sideToMove(fen: string): "w" | "b" {
  return fen.split(" ")[1] === "b" ? "b" : "w";
}

/** Convert a raw side-to-move-POV eval to white-POV. */
export function toWhitePov(raw: RawEvalResult, fen: string): RawEvalResult {
  if (sideToMove(fen) === "w") return raw;
  return {
    ...raw,
    scoreCp: -raw.scoreCp,
    mate: raw.mate === null ? null : -raw.mate,
  };
}

/**
 * Synthetic white-POV eval for terminal positions (checkmate/stalemate/draw),
 * which Stockfish cannot search. Returns null for non-terminal positions.
 */
export function getTerminalEval(fen: string, depth = 0): RawEvalResult | null {
  try {
    const chess = new Chess(fen);
    if (!chess.isGameOver()) return null;
    if (chess.isCheckmate()) {
      const whiteWins = sideToMove(fen) === "b";
      return {
        scoreCp: whiteWins ? MATE_SCORE_CP : -MATE_SCORE_CP,
        mate: null,
        bestLine: [],
        depth,
      };
    }
    return { scoreCp: 0, mate: null, bestLine: [], depth };
  } catch {
    return null;
  }
}

/** Collapse a white-POV eval to a single centipawn number. */
function toCp(p: PositionEval): number {
  return p.mate !== null ? Math.sign(p.mate) * MATE_SCORE_CP : p.scoreCp;
}

/**
 * Find moves that lost >= threshold centipawns from the mover's perspective.
 * positions[i] is the white-POV eval AFTER moves[i]; moves[i-1].fen is the
 * decision FEN, used to convert the engine's UCI line to SAN.
 */
export function findEvalDrops(
  positions: PositionEval[],
  moves: MoveDetail[],
  threshold = 50
): EvalDrop[] {
  const drops: EvalDrop[] = [];
  const n = Math.min(positions.length, moves.length);

  for (let i = 1; i < n; i++) {
    const prev = positions[i - 1];
    const curr = positions[i];
    const mult = curr.color === "w" ? 1 : -1;
    const prevScore = toCp(prev) * mult;
    const currScore = toCp(curr) * mult;
    const cpLoss = prevScore - currScore;
    if (cpLoss < threshold) continue;

    const decisionFen = moves[i - 1].fen;
    const engineBest =
      prev.bestLine.length > 0 ? uciToSan(decisionFen, prev.bestLine[0]) ?? "" : "";
    const engineLine =
      prev.bestLine.length > 0 ? uciLineToSan(decisionFen, prev.bestLine) : [];

    drops.push({
      moveNumber: curr.moveNumber,
      color: curr.color,
      san: curr.san,
      evalBefore: prevScore,
      evalAfter: currScore,
      cpLoss,
      engineBest,
      engineLine,
    });
  }
  return drops;
}

/**
 * Find moves where the mover had a forced mate-in-1 (per the engine) and
 * played something else. Expects white-POV positions.
 */
export function detectMissedMatesInOne(
  moves: MoveDetail[],
  positions: PositionEval[]
): MissedMateInOne[] {
  const missed: MissedMateInOne[] = [];
  const n = Math.min(positions.length, moves.length);

  for (let i = 1; i < n; i++) {
    const prev = positions[i - 1];
    const move = moves[i];
    if (prev.mate === null) continue;
    // white-POV -> mover-POV: mate must belong to the side about to move.
    const moverMate = move.color === "w" ? prev.mate : -prev.mate;
    if (moverMate !== 1) continue;

    let deliveredMate = false;
    try {
      deliveredMate = new Chess(move.fen).isCheckmate();
    } catch {
      continue;
    }
    if (deliveredMate) continue;

    const decisionFen = moves[i - 1].fen;
    const mateSan =
      prev.bestLine.length > 0 ? uciToSan(decisionFen, prev.bestLine[0]) : null;
    if (mateSan) {
      missed.push({
        moveNumber: move.moveNumber,
        color: move.color,
        playedSan: move.san,
        mateSan,
      });
    }
  }
  return missed;
}
