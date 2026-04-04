import { MoveDetail } from "./chess-utils";
import { PositionEval, EngineAnalysis, EvalDrop } from "./types";

const CP_DROP_THRESHOLD = 50;
const TARGET_DEPTH = 16;

/**
 * Spawns /stockfish.js (niklasf WASM build) as a Web Worker and evaluates
 * every position in the game via UCI protocol.
 *
 * The stockfish.js file IS the worker — it sets its own onmessage handler
 * and communicates via postMessage with plain UCI strings.
 */
export async function evaluateGame(
  moves: MoveDetail[],
  onProgress?: (completed: number, total: number) => void
): Promise<EngineAnalysis> {
  const worker = new Worker("/stockfish.js");

  try {
    // Wait for engine to be ready
    await uciReady(worker);

    // Configure engine
    worker.postMessage("setoption name Threads value 1");
    worker.postMessage("setoption name Hash value 16");
    worker.postMessage("isready");
    await waitForLine(worker, (line) => line === "readyok");

    const positions: PositionEval[] = [];
    const total = moves.length;

    for (let i = 0; i < moves.length; i++) {
      const move = moves[i];
      const result = await evaluatePosition(worker, move.fen);

      positions.push({
        moveNumber: move.moveNumber,
        color: move.color,
        san: move.san,
        scoreCp: result.scoreCp,
        mate: result.mate,
        bestLine: result.bestLine,
        depth: result.depth,
      });

      onProgress?.(i + 1, total);
    }

    const drops = findEvalDrops(positions);
    return { positions, drops };
  } finally {
    worker.postMessage("quit");
    worker.terminate();
  }
}

/** Send "uci" and wait for "uciok" */
function uciReady(worker: Worker): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Failed to initialize Stockfish")),
      15000
    );

    function handler(e: MessageEvent) {
      const line = typeof e.data === "string" ? e.data : "";
      if (line === "uciok") {
        clearTimeout(timeout);
        worker.removeEventListener("message", handler);
        resolve();
      }
    }

    worker.addEventListener("message", handler);
    worker.postMessage("uci");
  });
}

/** Wait for a specific line from the worker */
function waitForLine(
  worker: Worker,
  predicate: (line: string) => boolean
): Promise<void> {
  return new Promise((resolve) => {
    function handler(e: MessageEvent) {
      const line = typeof e.data === "string" ? e.data : "";
      if (predicate(line)) {
        worker.removeEventListener("message", handler);
        resolve();
      }
    }
    worker.addEventListener("message", handler);
  });
}

interface EvalResult {
  scoreCp: number;
  mate: number | null;
  bestLine: string[];
  depth: number;
}

/** Evaluate a single FEN position to TARGET_DEPTH */
function evaluatePosition(worker: Worker, fen: string): Promise<EvalResult> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Eval timeout")),
      10000
    );

    const lines: string[] = [];

    function handler(e: MessageEvent) {
      const line = typeof e.data === "string" ? e.data : "";
      lines.push(line);

      if (line.startsWith("bestmove")) {
        clearTimeout(timeout);
        worker.removeEventListener("message", handler);
        resolve(parseEvalLines(lines));
      }
    }

    worker.addEventListener("message", handler);
    worker.postMessage("ucinewgame");
    worker.postMessage(`position fen ${fen}`);
    worker.postMessage(`go depth ${TARGET_DEPTH}`);
  });
}

/** Parse UCI info lines to extract the best evaluation */
function parseEvalLines(lines: string[]): EvalResult {
  let scoreCp = 0;
  let mate: number | null = null;
  let bestLine: string[] = [];
  let depth = 0;

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.startsWith("info depth")) continue;

    const depthMatch = line.match(/depth (\d+)/);
    const cpMatch = line.match(/score cp (-?\d+)/);
    const mateMatch = line.match(/score mate (-?\d+)/);
    const pvMatch = line.match(/ pv (.+)/);

    if (depthMatch) depth = parseInt(depthMatch[1], 10);
    if (cpMatch) scoreCp = parseInt(cpMatch[1], 10);
    if (mateMatch) mate = parseInt(mateMatch[1], 10);
    if (pvMatch) bestLine = pvMatch[1].split(" ");

    if (depth >= TARGET_DEPTH) break;
  }

  return { scoreCp, mate, bestLine, depth };
}

function findEvalDrops(positions: PositionEval[]): EvalDrop[] {
  const drops: EvalDrop[] = [];

  for (let i = 1; i < positions.length; i++) {
    const prev = positions[i - 1];
    const curr = positions[i];

    const playerMultiplier = curr.color === "w" ? 1 : -1;

    const prevScore =
      prev.mate !== null
        ? (prev.mate > 0 ? 10000 : -10000) * playerMultiplier
        : prev.scoreCp * playerMultiplier;
    const currScore =
      curr.mate !== null
        ? (curr.mate > 0 ? 10000 : -10000) * playerMultiplier
        : curr.scoreCp * playerMultiplier;

    const cpLoss = prevScore - currScore;

    if (cpLoss >= CP_DROP_THRESHOLD) {
      drops.push({
        moveNumber: curr.moveNumber,
        color: curr.color,
        san: curr.san,
        evalBefore: prevScore,
        evalAfter: currScore,
        cpLoss,
        engineBest: prev.bestLine[0] || "",
        engineLine: prev.bestLine,
      });
    }
  }

  return drops;
}
