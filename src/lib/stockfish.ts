import { MoveDetail } from "./chess-utils";
import { PositionEval, EngineAnalysis, EvalDrop } from "./types";

interface WorkerResult {
  id: number;
  scoreCp: number;
  mate: number | null;
  bestLine: string[];
  depth: number;
}

const CP_DROP_THRESHOLD = 50;

export async function evaluateGame(
  moves: MoveDetail[],
  onProgress?: (completed: number, total: number) => void
): Promise<EngineAnalysis> {
  const worker = new Worker(
    new URL("./stockfish-worker.ts", import.meta.url),
    { type: "classic" }
  );

  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Stockfish init timeout")), 15000);
      worker.addEventListener("message", function handler(e) {
        if (e.data.type === "ready") {
          clearTimeout(timeout);
          worker.removeEventListener("message", handler);
          resolve();
        } else if (e.data.type === "error") {
          clearTimeout(timeout);
          worker.removeEventListener("message", handler);
          reject(new Error(e.data.message));
        }
      });
      worker.postMessage({ type: "init" });
    });

    const positions: PositionEval[] = [];
    const total = moves.length;

    for (let i = 0; i < moves.length; i++) {
      const move = moves[i];
      const result = await evaluatePosition(worker, move.fen, i);

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
    worker.postMessage({ type: "stop" });
    worker.terminate();
  }
}

function evaluatePosition(worker: Worker, fen: string, id: number): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Eval timeout for position ${id}`)), 10000);

    function handler(e: MessageEvent) {
      if (e.data.type === "result" && e.data.id === id) {
        clearTimeout(timeout);
        worker.removeEventListener("message", handler);
        resolve(e.data as WorkerResult);
      } else if (e.data.type === "error") {
        clearTimeout(timeout);
        worker.removeEventListener("message", handler);
        reject(new Error(e.data.message));
      }
    }

    worker.addEventListener("message", handler);
    worker.postMessage({ type: "eval", fen, id });
  });
}

function findEvalDrops(positions: PositionEval[]): EvalDrop[] {
  const drops: EvalDrop[] = [];

  for (let i = 1; i < positions.length; i++) {
    const prev = positions[i - 1];
    const curr = positions[i];

    const playerMultiplier = curr.color === "w" ? 1 : -1;

    const prevScore = prev.mate !== null ? (prev.mate > 0 ? 10000 : -10000) * playerMultiplier : prev.scoreCp * playerMultiplier;
    const currScore = curr.mate !== null ? (curr.mate > 0 ? 10000 : -10000) * playerMultiplier : curr.scoreCp * playerMultiplier;

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
