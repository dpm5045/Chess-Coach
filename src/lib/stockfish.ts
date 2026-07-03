import { MoveDetail } from "./chess-utils";
import { PositionEval, EngineAnalysis } from "./types";
import {
  parseUciInfoLines,
  toWhitePov,
  getTerminalEval,
  findEvalDrops,
  RawEvalResult,
} from "./engine-core";

const CP_DROP_THRESHOLD = 50;
const TARGET_DEPTH = 16;

/**
 * Spawns /stockfish.wasm.js as a Web Worker and evaluates every position in
 * the game via UCI. All returned evals are normalized to white-POV.
 */
export async function evaluateGame(
  moves: MoveDetail[],
  onProgress?: (completed: number, total: number) => void
): Promise<EngineAnalysis> {
  const worker = new Worker("/stockfish.wasm.js");

  try {
    await uciReady(worker);
    worker.postMessage("isready");
    await waitForLine(worker, (line) => line === "readyok");

    const positions: PositionEval[] = [];
    const total = moves.length;

    for (let i = 0; i < moves.length; i++) {
      const move = moves[i];
      const result =
        getTerminalEval(move.fen, TARGET_DEPTH) ??
        toWhitePov(await evaluatePosition(worker, move.fen), move.fen);

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

    const drops = findEvalDrops(positions, moves, CP_DROP_THRESHOLD);
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

/** Wait for a specific line from the worker (with timeout) */
function waitForLine(
  worker: Worker,
  predicate: (line: string) => boolean,
  timeoutMs = 15000
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      worker.removeEventListener("message", handler);
      reject(new Error("waitForLine timed out"));
    }, timeoutMs);

    function handler(e: MessageEvent) {
      const line = typeof e.data === "string" ? e.data : "";
      if (predicate(line)) {
        clearTimeout(timeout);
        worker.removeEventListener("message", handler);
        resolve();
      }
    }
    worker.addEventListener("message", handler);
  });
}

/** Evaluate a single FEN position to TARGET_DEPTH (raw side-to-move POV). */
function evaluatePosition(worker: Worker, fen: string): Promise<RawEvalResult> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Eval timeout")), 10000);

    const lines: string[] = [];

    function handler(e: MessageEvent) {
      const line = typeof e.data === "string" ? e.data : "";
      lines.push(line);

      if (line.startsWith("bestmove")) {
        clearTimeout(timeout);
        worker.removeEventListener("message", handler);
        resolve(parseUciInfoLines(lines));
      }
    }

    worker.addEventListener("message", handler);
    worker.postMessage("ucinewgame");
    worker.postMessage(`position fen ${fen}`);
    worker.postMessage(`go depth ${TARGET_DEPTH}`);
  });
}
