/**
 * Web Worker that runs Stockfish WASM and processes UCI evaluation requests.
 *
 * Messages IN:  { type: "init" } | { type: "eval", fen: string, id: number } | { type: "stop" }
 * Messages OUT: { type: "ready" } | { type: "result", id, scoreCp, mate, bestLine, depth } | { type: "error", message }
 */

declare const self: DedicatedWorkerGlobalScope;

let engine: any = null;
let pendingResolve: ((data: string[]) => void) | null = null;

const TARGET_DEPTH = 16;

function initEngine() {
  try {
    importScripts("/stockfish.js");

    const sf = (self as any).STOCKFISH?.() || (self as any).Stockfish?.();
    if (!sf) {
      self.postMessage({ type: "error", message: "Failed to initialize Stockfish" });
      return;
    }

    engine = sf;

    const outputLines: string[] = [];
    let collecting = false;

    sf.addMessageListener((line: string) => {
      if (collecting) {
        outputLines.push(line);
      }

      if (line.startsWith("bestmove")) {
        collecting = false;
        if (pendingResolve) {
          pendingResolve([...outputLines]);
          pendingResolve = null;
          outputLines.length = 0;
        }
      }
    });

    sf.postMessage("uci");
    sf.postMessage("setoption name Threads value 1");
    sf.postMessage("setoption name Hash value 16");
    sf.postMessage("isready");

    self.postMessage({ type: "ready" });
  } catch (err) {
    self.postMessage({ type: "error", message: `Init failed: ${err}` });
  }
}

async function evaluatePosition(fen: string, id: number) {
  if (!engine) {
    self.postMessage({ type: "error", message: "Engine not initialized" });
    return;
  }

  const sf = engine;

  const lines = await new Promise<string[]>((resolve) => {
    pendingResolve = resolve;

    const outputLines: string[] = [];
    let collecting = true;

    sf.addMessageListener(function handler(line: string) {
      if (collecting) {
        outputLines.push(line);
      }
      if (line.startsWith("bestmove")) {
        collecting = false;
        sf.removeMessageListener(handler);
        resolve([...outputLines]);
      }
    });

    sf.postMessage("ucinewgame");
    sf.postMessage(`position fen ${fen}`);
    sf.postMessage(`go depth ${TARGET_DEPTH}`);
  });

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

  self.postMessage({ type: "result", id, scoreCp, mate, bestLine, depth });
}

self.addEventListener("message", (e) => {
  const { type, fen, id } = e.data;

  switch (type) {
    case "init":
      initEngine();
      break;
    case "eval":
      evaluatePosition(fen, id);
      break;
    case "stop":
      if (engine) {
        engine.postMessage?.("quit");
        engine = null;
      }
      break;
  }
});
