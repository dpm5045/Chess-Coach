/**
 * Batch Game Analysis Script
 *
 * Evaluates all games using local Stockfish WASM, generates coaching
 * commentary from engine evaluations (no Claude API calls), validates
 * all move suggestions are legal, and stores results in Redis.
 *
 * Usage:
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/batch-analyze.ts
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/batch-analyze.ts --force-days 30
 */

import { Redis } from "@upstash/redis";
import { createHash } from "crypto";
import { Chess } from "chess.js";
import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";
import {
  classifyBattle,
  buildFeaturesFromEngineEvals,
  type BattleAllusion,
} from "../src/lib/battle-allusion";

// Save native fetch before Stockfish can clobber globals
const nativeFetch = globalThis.fetch;

const CHESS_COM_API = "https://api.chess.com/pub";
const HEADERS = {
  "User-Agent": "ChessCoach/1.0 (github.com/chess-coach)",
  Accept: "application/json",
};
const USERS = ["castledoon", "exstrax"];
const MONTHS_TO_FETCH = 3;
const ANALYSIS_TTL = 90 * 24 * 60 * 60; // 90 days
const TARGET_DEPTH = 14;
const CP_DROP_THRESHOLD = 50;

// Parse --force-days N from CLI args
const forceDaysArg = process.argv.indexOf("--force-days");
const FORCE_DAYS = forceDaysArg !== -1 ? parseInt(process.argv[forceDaysArg + 1], 10) : 0;
const FORCE_CUTOFF = FORCE_DAYS > 0 ? Date.now() / 1000 - FORCE_DAYS * 86400 : 0;

// --- Types ---

interface PlayerResult { username: string; rating: number; result: string; }
interface Game { url: string; pgn: string; uuid: string; time_class: string; white: PlayerResult; black: PlayerResult; end_time: number; }
interface MoveDetail { moveNumber: number; color: "w" | "b"; san: string; from: string; to: string; fen: string; }
interface PositionEval { moveNumber: number; color: "w" | "b"; san: string; scoreCp: number; mate: number | null; bestLine: string[]; depth: number; }
interface EvalDrop { moveNumber: number; color: "w" | "b"; san: string; evalBefore: number; evalAfter: number; cpLoss: number; engineBest: string; engineLine: string[]; }
interface AnalysisResult {
  opening: { name: string; assessment: "good" | "inaccurate" | "dubious"; comment: string; };
  criticalMoments: Array<{ moveNumber: number; move: string; type: "blunder" | "mistake" | "excellent" | "missed_tactic"; comment: string; suggestion: string; }>;
  positionalThemes: string;
  endgame: { reached: boolean; comment: string; };
  summary: { overallAssessment: string; focusArea: string; battleAllusion?: BattleAllusion; };
  missedMatesInOne?: Array<{ moveNumber: number; color: "w" | "b"; playedSan: string; mateSan: string; }>;
}

// --- Stockfish Engine ---

let collectedLines: string[] = [];
const origWrite = process.stdout.write.bind(process.stdout);

function log(...args: unknown[]) {
  origWrite(args.map(String).join(" ") + "\n");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let engine: any = null;

async function initStockfish() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const initEngine = require("stockfish");
  engine = await initEngine("single");

  // Restore fetch after Stockfish WASM initialization
  globalThis.fetch = nativeFetch;

  // Intercept stdout to capture engine output
  process.stdout.write = function(chunk: unknown, encodingOrCb?: unknown, cb?: unknown): boolean {
    const str = String(chunk);
    for (const line of str.split("\n")) {
      const trimmed = line.trim();
      if (trimmed) collectedLines.push(trimmed);
    }
    if (typeof encodingOrCb === "function") { (encodingOrCb as () => void)(); return true; }
    if (typeof cb === "function") { (cb as () => void)(); return true; }
    return true;
  } as typeof process.stdout.write;
}

function parseResult(lines: string[]): { scoreCp: number; mate: number | null; bestLine: string[]; depth: number } {
  const infoLines = lines.filter(l => l.startsWith("info depth"));
  if (infoLines.length === 0) return { scoreCp: 0, mate: null, bestLine: [], depth: 0 };
  const lastInfo = infoLines[infoLines.length - 1];
  const cp = lastInfo.match(/score cp (-?\d+)/);
  const mate = lastInfo.match(/score mate (-?\d+)/);
  const pv = lastInfo.match(/ pv (.+)/);
  const d = lastInfo.match(/depth (\d+)/);
  return {
    scoreCp: cp ? parseInt(cp[1], 10) : 0,
    mate: mate ? parseInt(mate[1], 10) : null,
    bestLine: pv ? pv[1].split(" ") : [],
    depth: d ? parseInt(d[1], 10) : 0,
  };
}

async function evalPosition(fen: string): Promise<{ scoreCp: number; mate: number | null; bestLine: string[]; depth: number }> {
  collectedLines = [];
  engine.ccall("command", null, ["string"], [`position fen ${fen}`]);
  await engine.ccall("command", null, ["string"], [`go depth ${TARGET_DEPTH}`], { async: true });
  return parseResult(collectedLines);
}

/** Return a synthetic eval for checkmate/stalemate/draw positions */
function getTerminalEval(fen: string): { scoreCp: number; mate: number | null; bestLine: string[]; depth: number } | null {
  try {
    const chess = new Chess(fen);
    if (chess.isCheckmate()) return { scoreCp: 0, mate: 0, bestLine: [], depth: TARGET_DEPTH };
    if (chess.isStalemate() || chess.isDraw()) return { scoreCp: 0, mate: null, bestLine: [], depth: TARGET_DEPTH };
  } catch { /* invalid FEN — let engine handle */ }
  return null;
}

// --- Helpers ---

function getRedis(): Redis {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error("Missing KV_REST_API_URL or KV_REST_API_TOKEN");
  return new Redis({ url, token });
}

function analysisCacheKey(pgn: string): string {
  const moves = pgn.replace(/\[.*?\]\s*/g, "").replace(/\s+/g, " ").trim();
  const hash = createHash("sha256").update(moves).digest("hex").slice(0, 16);
  return `analysis:${hash}`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await nativeFetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Chess.com API error: ${res.status} for ${url}`);
  return res.json() as Promise<T>;
}

function isCurrentMonth(year: string, month: string): boolean {
  const now = new Date();
  return parseInt(year, 10) === now.getFullYear() && parseInt(month, 10) === now.getMonth() + 1;
}

function getAllMoves(pgn: string): MoveDetail[] {
  try {
    const chess = new Chess();
    chess.loadPgn(pgn);
    const history = chess.history({ verbose: true });
    const replay = new Chess();
    const moves: MoveDetail[] = [];
    for (const move of history) {
      replay.move(move.san);
      moves.push({
        moveNumber: Math.floor(moves.length / 2) + 1,
        color: move.color,
        san: move.san,
        from: move.from,
        to: move.to,
        fen: replay.fen(),
      });
    }
    return moves;
  } catch { return []; }
}

// --- UCI to SAN conversion ---

/**
 * Convert a UCI move (e.g. "e2e4") to SAN (e.g. "e4") given a FEN position.
 * Returns null if the move is illegal in that position.
 */
function uciToSan(fen: string, uciMove: string): string | null {
  try {
    const chess = new Chess(fen);
    const from = uciMove.slice(0, 2);
    const to = uciMove.slice(2, 4);
    const promotion = uciMove.length > 4 ? uciMove[4] : undefined;
    const result = chess.move({ from, to, promotion });
    return result ? result.san : null;
  } catch { return null; }
}

/**
 * Convert a UCI line (array of UCI moves) to SAN, starting from a FEN position.
 * Stops at the first illegal move.
 */
function uciLineToSan(fen: string, uciMoves: string[]): string[] {
  const sanMoves: string[] = [];
  const chess = new Chess(fen);
  for (const uci of uciMoves) {
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = uci.length > 4 ? uci[4] : undefined;
    try {
      const result = chess.move({ from, to, promotion });
      if (!result) break;
      sanMoves.push(result.san);
    } catch { break; }
  }
  return sanMoves;
}

/**
 * Get the FEN position BEFORE a move was played (the decision point).
 */
// --- Move Validation ---

function isLegalMoveAt(fen: string, san: string): boolean {
  try {
    const chess = new Chess(fen);
    return chess.move(san) !== null;
  } catch { return false; }
}

function getLegalMovesAt(fen: string, exclude?: string): string[] {
  try {
    const chess = new Chess(fen);
    return chess.moves().filter((m) => m !== exclude);
  } catch { return []; }
}

// --- Engine Evaluation ---

async function evaluateGame(moves: MoveDetail[]): Promise<{ positions: PositionEval[]; drops: EvalDrop[]; missedMatesInOne: Array<{ moveNumber: number; color: "w" | "b"; playedSan: string; mateSan: string }> }> {
  const positions: PositionEval[] = [];

  for (const move of moves) {
    const terminal = getTerminalEval(move.fen);
    if (terminal) {
      positions.push({ moveNumber: move.moveNumber, color: move.color, san: move.san, ...terminal });
      continue;
    }

    const result = await evalPosition(move.fen);
    positions.push({
      moveNumber: move.moveNumber,
      color: move.color,
      san: move.san,
      scoreCp: result.scoreCp,
      mate: result.mate,
      bestLine: result.bestLine,
      depth: result.depth,
    });
  }

  // Detect missed mate-in-1 opportunities
  const missedMatesInOne: Array<{ moveNumber: number; color: "w" | "b"; playedSan: string; mateSan: string }> = [];
  for (let i = 1; i < positions.length; i++) {
    const prev = positions[i - 1];
    const curr = positions[i];
    // prev is eval AFTER the opponent's move = side-to-move is curr's color
    // prev.mate === 1 means the side about to play has forced mate in 1
    if (prev.mate === 1) {
      // Check if the move actually played delivered checkmate
      const resultingFen = moves[i].fen;
      try {
        const chess = new Chess(resultingFen);
        if (!chess.isCheckmate()) {
          // Player had mate in 1 but didn't play it
          const decisionFen = moves[i - 1].fen;
          const mateSan = prev.bestLine.length > 0 ? uciToSan(decisionFen, prev.bestLine[0]) : null;
          if (mateSan) {
            missedMatesInOne.push({
              moveNumber: curr.moveNumber,
              color: curr.color,
              playedSan: curr.san,
              mateSan,
            });
          }
        }
      } catch { /* invalid FEN — skip */ }
    }
  }

  const drops: EvalDrop[] = [];
  for (let i = 1; i < positions.length; i++) {
    const prev = positions[i - 1];
    const curr = positions[i];
    const playerMultiplier = curr.color === "w" ? 1 : -1;
    const prevScore = prev.mate !== null ? (prev.mate > 0 ? 10000 : -10000) * playerMultiplier : prev.scoreCp * playerMultiplier;
    const currScore = curr.mate !== null ? (curr.mate > 0 ? 10000 : -10000) * playerMultiplier : curr.scoreCp * playerMultiplier;
    const cpLoss = prevScore - currScore;

    if (cpLoss >= CP_DROP_THRESHOLD) {
      // FEN before the current move — the position where the player was deciding
      const decisionFen = i > 0 ? moves[i - 1].fen : "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

      const bestSan = prev.bestLine.length > 0 ? uciToSan(decisionFen, prev.bestLine[0]) : null;
      const lineSan = prev.bestLine.length > 0 ? uciLineToSan(decisionFen, prev.bestLine) : [];

      drops.push({
        moveNumber: curr.moveNumber, color: curr.color, san: curr.san,
        evalBefore: prevScore, evalAfter: currScore, cpLoss,
        engineBest: bestSan || "", engineLine: lineSan,
      });
    }
  }

  return { positions, drops, missedMatesInOne };
}

// --- Analysis Generation (template-based, no API) ---

function getOpeningName(pgn: string): string {
  const ecoMatch = pgn.match(/\[ECOUrl "https:\/\/www\.chess\.com\/openings\/([^"]+)"\]/);
  if (ecoMatch) return ecoMatch[1].replace(/-/g, " ").replace(/\d+\.\.\./g, "").replace(/\d+\./g, "").trim();
  return pgn.match(/\[Opening "([^"]+)"\]/)?.[1] || "Unknown Opening";
}

function classifyDrop(cpLoss: number): "blunder" | "mistake" | "missed_tactic" {
  if (cpLoss >= 200) return "blunder";
  if (cpLoss >= 100) return "mistake";
  return "missed_tactic";
}

function formatScore(scoreCp: number, mate: number | null): string {
  if (mate !== null) return `mate in ${Math.abs(mate)}`;
  const pawns = Math.abs(scoreCp) / 100;
  return `${pawns.toFixed(1)} pawn${pawns !== 1 ? "s" : ""}`;
}

function generateAnalysis(
  pgn: string, moves: MoveDetail[],
  evals: { positions: PositionEval[]; drops: EvalDrop[]; missedMatesInOne: Array<{ moveNumber: number; color: "w" | "b"; playedSan: string; mateSan: string }> },
  username: string, color: "white" | "black", rating: number,
  opponentName: string, result: string
): { analysis: AnalysisResult; fixes: number } {
  const playerColor = color === "white" ? "w" : "b";
  const openingName = getOpeningName(pgn);
  let fixes = 0;

  // --- Opening assessment ---
  const openingDrops = evals.drops.filter(d => d.moveNumber <= 8 && d.color === playerColor);
  const openingAssessment: "good" | "inaccurate" | "dubious" =
    openingDrops.some(d => d.cpLoss >= 100) ? "dubious" :
    openingDrops.length > 0 ? "inaccurate" : "good";

  let openingComment = "";
  if (openingAssessment === "good") {
    openingComment = `Solid opening play in the ${openingName}. You emerged with a playable position.`;
  } else if (openingAssessment === "inaccurate") {
    const drop = openingDrops[0];
    openingComment = `The ${openingName} started okay but ${drop.moveNumber}${drop.color === "w" ? "." : "..."} ${drop.san} lost some ground (${drop.cpLoss}cp). Review the key ideas here.`;
  } else {
    const drop = openingDrops[0];
    openingComment = `Trouble in the ${openingName}. ${drop.moveNumber}${drop.color === "w" ? "." : "..."} ${drop.san} was a significant error (${drop.cpLoss}cp loss). Study the main lines.`;
  }

  // --- Critical moments ---
  const playerDrops = evals.drops.filter(d => d.color === playerColor).sort((a, b) => b.cpLoss - a.cpLoss).slice(0, 4);
  const criticalMoments: AnalysisResult["criticalMoments"] = [];

  // Excellent moves: positions where the player gained significant advantage
  for (let i = 1; i < evals.positions.length; i++) {
    const curr = evals.positions[i], prev = evals.positions[i - 1];
    if (curr.color !== playerColor) continue;
    const gain = (curr.scoreCp - prev.scoreCp) * (playerColor === "w" ? 1 : -1);
    if (gain >= 80 && criticalMoments.filter(m => m.type === "excellent").length < 2) {
      criticalMoments.push({
        moveNumber: curr.moveNumber, move: curr.san, type: "excellent",
        comment: `Strong move! This gained ${gain}cp, shifting the position in your favor.`,
        suggestion: "",
      });
    }
  }

  // Mistakes/blunders from eval drops
  for (const drop of playerDrops) {
    const type = classifyDrop(drop.cpLoss);

    // Build comment with mate accuracy
    let comment = "";
    // Check if the position before had a mate score
    const moveIdx = moves.findIndex(m => m.moveNumber === drop.moveNumber && m.color === drop.color);
    const prevEval = moveIdx > 0 ? evals.positions[moveIdx - 1] : null;

    if (prevEval != null && prevEval.mate !== null && Math.abs(prevEval.mate) <= 10) {
      // There was a forced mate available
      const mateIn = Math.abs(prevEval.mate);
      const lineStr = drop.engineLine.length > 0 ? ` The winning sequence was: ${drop.engineLine.join(", ")}.` : "";
      comment = `You had a forced mate in ${mateIn} here but played ${drop.san} instead, which lost ${drop.cpLoss}cp.${lineStr}${drop.engineBest ? ` The engine's first move was ${drop.engineBest}.` : ""}`;
    } else if (type === "blunder") {
      comment = `This move lost ${drop.cpLoss}cp — a serious error.${drop.engineBest ? ` The engine preferred ${drop.engineBest}.` : ""}`;
      if (drop.engineLine.length > 1) {
        comment += ` The better line continued: ${drop.engineLine.slice(0, 4).join(", ")}.`;
      }
    } else if (type === "mistake") {
      comment = `Lost ${drop.cpLoss}cp here.${drop.engineBest ? ` ${drop.engineBest} was better.` : ""}`;
      if (drop.engineLine.length > 1) {
        comment += ` Continuation: ${drop.engineLine.slice(0, 3).join(", ")}.`;
      }
    } else {
      comment = `A small inaccuracy costing ${drop.cpLoss}cp.${drop.engineBest ? ` ${drop.engineBest} was slightly better.` : ""}`;
    }

    criticalMoments.push({
      moveNumber: drop.moveNumber, move: drop.san, type, comment,
      suggestion: drop.engineBest || "",
    });
  }

  criticalMoments.sort((a, b) => a.moveNumber - b.moveNumber);

  // --- Validate all suggestions ---
  for (const cm of criticalMoments) {
    if (!cm.suggestion || cm.suggestion.length === 0) continue;

    // Find the FEN before this move was played
    const moveIdx = moves.findIndex(m => m.moveNumber === cm.moveNumber && m.san === cm.move);
    if (moveIdx === -1) continue;
    const decisionFen = moveIdx > 0 ? moves[moveIdx - 1].fen : "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

    if (!isLegalMoveAt(decisionFen, cm.suggestion)) {
      fixes++;
      // Pick a legal fallback
      const legalMoves = getLegalMovesAt(decisionFen, cm.move);
      const captures = legalMoves.filter(m => m.includes("x"));
      const checks = legalMoves.filter(m => m.includes("+"));
      const fallback = captures[0] || checks[0] || legalMoves[0] || "";
      cm.suggestion = fallback;
    }
  }

  // --- Positional themes ---
  const blunderCount = playerDrops.filter(d => d.cpLoss >= 200).length;
  const mistakeCount = playerDrops.filter(d => d.cpLoss >= 100 && d.cpLoss < 200).length;
  const inaccuracyCount = evals.drops.filter(d => d.color === playerColor && d.cpLoss >= 50 && d.cpLoss < 100).length;
  const playerPositions = evals.positions.filter(p => p.color === playerColor);
  const avgEval = playerPositions.reduce((sum, p) => sum + p.scoreCp * (playerColor === "w" ? 1 : -1), 0) / (playerPositions.length || 1);

  let themes = "";
  if (blunderCount > 0) themes += `${blunderCount} significant blunder${blunderCount > 1 ? "s" : ""} swung the game. `;
  if (mistakeCount > 0) themes += `${mistakeCount} mistake${mistakeCount > 1 ? "s" : ""} cost material or positional advantage. `;
  if (inaccuracyCount > 1) themes += `Several small inaccuracies (${inaccuracyCount}) added up. `;
  themes += avgEval > 100 ? "You maintained a solid advantage through most of the game." :
    avgEval < -100 ? "You were on the defensive for much of the game." :
    "The position was roughly balanced through most of the game.";

  // --- Endgame ---
  const totalMoves = moves.length;
  const lastMoves = moves.slice(-10);
  const endgameReached = lastMoves.some(m => (m.fen.split(" ")[0].match(/[rnbqRNBQ]/g) || []).length <= 6) && totalMoves > 30;
  let endgameComment = "";
  if (endgameReached) {
    const endgameDrops = evals.drops.filter(d => d.color === playerColor && d.moveNumber > totalMoves / 2);
    if (endgameDrops.length === 0) {
      endgameComment = "Clean endgame technique — no significant errors in the final phase.";
    } else {
      const worst = endgameDrops.sort((a, b) => b.cpLoss - a.cpLoss)[0];
      endgameComment = `The endgame had issues. ${worst.moveNumber}${worst.color === "w" ? "." : "..."} ${worst.san} lost ${worst.cpLoss}cp.${worst.engineBest ? ` ${worst.engineBest} was better.` : ""} Endgame precision is key for converting advantages.`;
    }
  }

  // --- Summary ---
  const won = result === "win";
  const lost = ["checkmated", "resigned", "timeout", "abandoned"].includes(result);
  const errorCount = blunderCount + mistakeCount;

  let overallAssessment = "";
  if (won && errorCount <= 1) {
    overallAssessment = "A well-played victory. Your play was solid with minimal errors. Keep up this accuracy!";
  } else if (won) {
    overallAssessment = `You got the win, but the engine found ${errorCount} significant inaccuracies. Against stronger opponents, those would be punished.`;
  } else if (lost && blunderCount >= 2) {
    overallAssessment = `A tough loss driven by ${blunderCount} blunder${blunderCount > 1 ? "s" : ""}. Focus on slowing down — a quick blunder check can save games.`;
  } else if (lost) {
    overallAssessment = `A competitive game that didn't go your way. The engine shows ${errorCount + inaccuracyCount} areas for improvement.`;
  } else {
    overallAssessment = `A balanced game. Your play was ${blunderCount === 0 ? "mostly solid" : "uneven"} — study the critical moments.`;
  }

  const focusArea = blunderCount >= 2 ? "Blunder prevention: before each move, ask 'what can my opponent do?'" :
    mistakeCount >= 2 ? "Calculation: practice tactical puzzles to improve 2-3 move vision." :
    openingAssessment !== "good" ? `Opening preparation: review the main ideas in the ${openingName}.` :
    endgameReached && endgameComment.includes("issues") ? "Endgame technique: practice king activity and passed pawn conversion." :
    "Consistency: your play is improving — maintain this accuracy across all phases.";

  const playerColorChar = color === "white" ? "w" : "b";
  const playerMissedMates = evals.missedMatesInOne.filter(m => m.color === (playerColorChar as "w" | "b"));

  const gameResult: "win" | "loss" | "draw" =
    result === "win"
      ? "win"
      : ["stalemate", "insufficient", "repetition", "agreed", "50move", "timevsinsufficient"].includes(result)
      ? "draw"
      : "loss";
  const battleAllusion = classifyBattle(
    buildFeaturesFromEngineEvals(
      evals,
      playerColorChar as "w" | "b",
      gameResult,
      openingAssessment,
      endgameReached,
      { missedMate: playerMissedMates.length > 0 }
    )
  );

  return {
    analysis: {
      opening: { name: openingName, assessment: openingAssessment, comment: openingComment },
      criticalMoments,
      positionalThemes: themes,
      endgame: { reached: endgameReached, comment: endgameComment },
      summary: { overallAssessment, focusArea, battleAllusion },
      missedMatesInOne: playerMissedMates.length > 0 ? playerMissedMates : undefined,
    },
    fixes,
  };
}

// --- Main ---

async function main() {
  log("Initializing Stockfish WASM...");
  await initStockfish();
  log("Stockfish ready!");

  if (FORCE_DAYS > 0) {
    log(`Force re-analyzing games from the last ${FORCE_DAYS} days`);
  }

  const redis = getRedis();
  let totalAnalyzed = 0;
  let totalFixes = 0;

  for (const username of USERS) {
    log(`\n=== ${username} ===`);

    const { archives } = await fetchJson<{ archives: string[] }>(`${CHESS_COM_API}/player/${username}/games/archives`);
    await redis.set(`archives:${username}`, archives, { ex: 5 * 60 });

    const recentArchives = archives.slice(-MONTHS_TO_FETCH);
    const allGames: Game[] = [];

    for (const archiveUrl of recentArchives) {
      const parts = archiveUrl.split("/");
      const year = parts[parts.length - 2];
      const month = parts[parts.length - 1];
      const { games } = await fetchJson<{ games: Game[] }>(archiveUrl);
      const withPgn = games.filter((g) => g.pgn);
      allGames.push(...withPgn);
      const key = `games:${username}:${year}/${month}`;
      const ttl = isCurrentMonth(year, month) ? { ex: 5 * 60 } : {};
      await redis.set(key, games, ttl);
      log(`  Cached ${year}/${month}: ${withPgn.length} games`);
    }

    allGames.sort((a, b) => b.end_time - a.end_time);

    // Save fetched games locally so backfill-meta.ts has fresh data
    const dataDir = path.join(process.cwd(), "scripts", "data");
    const gamesPath = path.join(dataDir, `${username}-games.json`);
    fs.writeFileSync(gamesPath, JSON.stringify(allGames, null, 2));

    // Determine which games to analyze
    const toAnalyze: Game[] = [];
    let skipped = 0;

    for (const game of allGames) {
      const key = analysisCacheKey(game.pgn);
      const existing = await redis.get(key);

      if (FORCE_DAYS > 0 && game.end_time >= FORCE_CUTOFF) {
        if (existing) await redis.del(key);
        toAnalyze.push(game);
      } else if (!existing) {
        toAnalyze.push(game);
      } else {
        skipped++;
      }
    }

    const byClass: Record<string, number> = {};
    for (const g of toAnalyze) {
      byClass[g.time_class] = (byClass[g.time_class] || 0) + 1;
    }

    log(`  Total: ${allGames.length} games, skipping ${skipped} already analyzed`);
    log(`  To analyze: ${toAnalyze.length} — ${Object.entries(byClass).map(([tc, n]) => `${tc}: ${n}`).join(", ") || "none"}`);

    for (let i = 0; i < toAnalyze.length; i++) {
      const game = toAnalyze[i];
      const cacheKey = analysisCacheKey(game.pgn);
      const isWhite = game.white.username.toLowerCase() === username.toLowerCase();
      const color = isWhite ? "white" as const : "black" as const;
      const rating = isWhite ? game.white.rating : game.black.rating;
      const opponent = isWhite ? game.black.username : game.white.username;
      const result = isWhite ? game.white.result : game.black.result;
      const date = new Date(game.end_time * 1000).toISOString().slice(0, 10);

      log(`  [${i + 1}/${toAnalyze.length}] ${game.time_class} vs ${opponent} (${date})...`);

      try {
        const moves = getAllMoves(game.pgn);
        if (moves.length === 0) { log("    Skipped (no moves)"); continue; }

        const engineEvals = await evaluateGame(moves);
        const { analysis, fixes } = generateAnalysis(game.pgn, moves, engineEvals, username, color, rating, opponent, result);
        await redis.set(cacheKey, analysis, { ex: ANALYSIS_TTL });
        totalAnalyzed++;
        totalFixes += fixes;

        const playerChar = color === "white" ? "w" : "b";
        const blunders = engineEvals.drops.filter(d => d.color === playerChar && d.cpLoss >= 200).length;
        const mistakes = engineEvals.drops.filter(d => d.color === playerChar && d.cpLoss >= 100 && d.cpLoss < 200).length;
        const missedMateCount = analysis.missedMatesInOne?.length ?? 0;
        log(`    OK ${moves.length} moves, ${blunders}B ${mistakes}M${missedMateCount > 0 ? ` ${missedMateCount}MM1` : ""}${fixes > 0 ? `, ${fixes} suggestion fixes` : ""} — ${analysis.opening.name}`);
      } catch (err) {
        log(`    FAIL: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  log(`\nDone! Analyzed ${totalAnalyzed} games, fixed ${totalFixes} illegal suggestions. $0 API cost.`);

  log("\n=== Running meta analysis ===");
  const metaResult = spawnSync(
    "npx",
    ["tsx", "scripts/backfill-meta.ts", "--force"],
    { stdio: "inherit", env: process.env, shell: true }
  );
  if (metaResult.status !== 0) {
    log("Meta analysis failed (non-zero exit). Check output above.");
  }

  process.exit(0);
}

main().catch((err) => {
  log("Batch analysis failed:", err);
  process.exit(1);
});
