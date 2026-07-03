# Architecture Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the confirmed UCI score-perspective bug, deduplicate engine logic into a shared core used by both the app and the batch script, harden `/api/analyze`, validate Claude's JSON at the boundary, and clean up dead code and repo clutter.

**Architecture:** All engine parsing/normalization/derivation moves into `src/lib/engine-core.ts`, which normalizes every eval to **white-POV at parse time** (verified empirically: the `stockfish` npm package and the browser WASM build both report UCI scores from the **side-to-move's** perspective). The browser path (`stockfish.ts`), the server route, and `scripts/batch-analyze.ts` all consume this one module. The server stops trusting client-computed drops and recomputes them, and computes missed-mates-in-one itself so the live Claude path finally produces them.

**Tech Stack:** Next.js 16 App Router (route handlers receive `params` as a Promise — the codebase already follows this), chess.js, stockfish WASM, Upstash Redis, zod (new), vitest (new).

## Global Constraints

- **Perspective convention:** after Task 1, every `PositionEval.scoreCp`/`mate` stored or passed anywhere in the codebase is **white-POV** (positive = White better, `mate > 0` = White mates). Raw UCI output is side-to-move-POV and must be converted via `toWhitePov()` immediately after parsing.
- `positions[i]` is always the eval **after** `moves[i]` was played. `moves[i-1].fen` is the decision FEN for `moves[i]`.
- Terminal checkmate positions are encoded as `scoreCp: ±10000, mate: null` (use `MATE_SCORE_CP`). `mate: 0` must never appear.
- Do not modify the Claude system prompts except where a task explicitly says so.
- After every task: `npx tsc --noEmit` must pass and `npx vitest run` must pass before committing.
- This is a Windows machine; the shell for verification commands is PowerShell or Git Bash. All commands below work in both unless noted.
- Cached data compatibility: bump client cache prefixes (`engine-eval-v2:`, `analysis-v2:`) so stale wrong-perspective entries are never reused. Redis analyses are regenerated in Task 7.
- Commit messages end with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: Test infrastructure + shared engine core

**Files:**
- Create: `vitest.config.ts`
- Create: `src/lib/engine-core.ts`
- Create: `tests/engine-core.test.ts`
- Modify: `src/lib/chess-utils.ts` (add 4 exported functions at end of file)
- Modify: `package.json` (add `test` script, vitest devDependency)

**Interfaces:**
- Consumes: `MoveDetail` from `src/lib/chess-utils.ts`, `PositionEval`, `EvalDrop`, `MissedMateInOne` from `src/lib/types.ts` (all already exist).
- Produces (used by Tasks 2, 3, 4, 5):
  - `MATE_SCORE_CP = 10000` (const)
  - `parseUciInfoLines(lines: string[]): RawEvalResult`
  - `toWhitePov(raw: RawEvalResult, fen: string): RawEvalResult`
  - `getTerminalEval(fen: string, depth?: number): RawEvalResult | null`
  - `findEvalDrops(positions: PositionEval[], moves: MoveDetail[], threshold?: number): EvalDrop[]`
  - `detectMissedMatesInOne(moves: MoveDetail[], positions: PositionEval[]): MissedMateInOne[]`
  - `interface RawEvalResult { scoreCp: number; mate: number | null; bestLine: string[]; depth: number }`
  - From chess-utils: `uciToSan(fen, uciMove): string | null`, `uciLineToSan(fen, uciMoves): string[]`, `isLegalMoveInFen(fen, san): boolean`, `getLegalMovesInFen(fen, exclude?): string[]`

- [ ] **Step 1: Install vitest and add config**

```bash
npm install --save-dev vitest
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
```

In `package.json` scripts, add: `"test": "vitest run"`.

- [ ] **Step 2: Add FEN-based helpers to `src/lib/chess-utils.ts`**

Append to the end of the file (these come from `scripts/batch-analyze.ts` lines 180–228, unchanged logic):

```ts
/**
 * Convert a UCI move (e.g. "e2e4") to SAN (e.g. "e4") given a FEN position.
 * Returns null if the move is illegal in that position.
 */
export function uciToSan(fen: string, uciMove: string): string | null {
  try {
    const chess = new Chess(fen);
    const from = uciMove.slice(0, 2);
    const to = uciMove.slice(2, 4);
    const promotion = uciMove.length > 4 ? uciMove[4] : undefined;
    const result = chess.move({ from, to, promotion });
    return result ? result.san : null;
  } catch {
    return null;
  }
}

/**
 * Convert a UCI line (array of UCI moves) to SAN, starting from a FEN position.
 * Stops at the first illegal move.
 */
export function uciLineToSan(fen: string, uciMoves: string[]): string[] {
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
    } catch {
      break;
    }
  }
  return sanMoves;
}

/** Check whether a SAN move is legal in the given FEN position. */
export function isLegalMoveInFen(fen: string, san: string): boolean {
  try {
    const chess = new Chess(fen);
    return chess.move(san) !== null;
  } catch {
    return false;
  }
}

/** All legal SAN moves in a FEN position, optionally excluding one move. */
export function getLegalMovesInFen(fen: string, exclude?: string): string[] {
  try {
    const chess = new Chess(fen);
    return chess.moves().filter((m) => m !== exclude);
  } catch {
    return [];
  }
}
```

- [ ] **Step 3: Write the failing tests**

Create `tests/engine-core.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  parseUciInfoLines,
  toWhitePov,
  getTerminalEval,
  findEvalDrops,
  detectMissedMatesInOne,
  MATE_SCORE_CP,
} from "@/lib/engine-core";
import { getAllMoves } from "@/lib/chess-utils";
import { PositionEval } from "@/lib/types";

function pos(over: Partial<PositionEval>): PositionEval {
  return {
    moveNumber: 1,
    color: "w",
    san: "e4",
    scoreCp: 0,
    mate: null,
    bestLine: [],
    depth: 12,
    ...over,
  };
}

describe("parseUciInfoLines", () => {
  it("takes the last scored info line", () => {
    const r = parseUciInfoLines([
      "info depth 10 seldepth 12 score cp 30 nodes 100 pv e2e4 e7e5",
      "info depth 12 seldepth 14 score cp -616 nodes 3767 pv b8c6 c2c3",
      "bestmove b8c6",
    ]);
    expect(r).toEqual({ scoreCp: -616, mate: null, bestLine: ["b8c6", "c2c3"], depth: 12 });
  });

  it("parses mate scores", () => {
    const r = parseUciInfoLines(["info depth 12 seldepth 2 score mate 1 nodes 361 pv d8h4"]);
    expect(r.mate).toBe(1);
    expect(r.bestLine).toEqual(["d8h4"]);
  });

  it("returns zeros when no info lines", () => {
    expect(parseUciInfoLines(["bestmove (none)"])).toEqual({
      scoreCp: 0,
      mate: null,
      bestLine: [],
      depth: 0,
    });
  });
});

describe("toWhitePov", () => {
  // Verified empirically 2026-07-03: stockfish npm pkg reports side-to-move POV.
  // Black to move, White up a queen => raw cp is NEGATIVE; white-POV is positive.
  it("negates cp and mate when black is to move", () => {
    const fen = "rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1";
    const r = toWhitePov({ scoreCp: -616, mate: null, bestLine: [], depth: 12 }, fen);
    expect(r.scoreCp).toBe(616);
    const m = toWhitePov({ scoreCp: 0, mate: 1, bestLine: ["d8h4"], depth: 12 }, fen);
    expect(m.mate).toBe(-1); // black mates in 1 => negative in white-POV
  });

  it("leaves scores unchanged when white is to move", () => {
    const fen = "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4";
    const r = toWhitePov({ scoreCp: 0, mate: 1, bestLine: ["h5f7"], depth: 12 }, fen);
    expect(r.mate).toBe(1);
  });
});

describe("getTerminalEval", () => {
  it("scores checkmate for the winner in white-POV", () => {
    // Fool's mate final position: white is checkmated, black won.
    const fen = "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3";
    const r = getTerminalEval(fen, 16);
    expect(r).toEqual({ scoreCp: -MATE_SCORE_CP, mate: null, bestLine: [], depth: 16 });
  });

  it("scores stalemate as 0", () => {
    const fen = "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1"; // black stalemated
    const r = getTerminalEval(fen, 16);
    expect(r).toEqual({ scoreCp: 0, mate: null, bestLine: [], depth: 16 });
  });

  it("returns null for non-terminal positions", () => {
    expect(getTerminalEval("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1")).toBeNull();
  });
});

describe("findEvalDrops", () => {
  it("detects a white blunder and converts engine line to SAN", () => {
    // 1. e4 e5 2. Qh5?! g6?? — craft evals so 2...g6 is a black blunder
    const moves = getAllMoves("1. e4 e5 2. Qh5 g6");
    const positions: PositionEval[] = [
      pos({ moveNumber: 1, color: "w", san: "e4", scoreCp: 30 }),
      pos({ moveNumber: 1, color: "b", san: "e5", scoreCp: 25 }),
      // after 2.Qh5, black to move; white-POV +30. Engine best for black: g8f6... etc.
      pos({ moveNumber: 2, color: "w", san: "Qh5", scoreCp: 30, bestLine: ["b8c6", "f1c4"] }),
      // after 2...g6?? white-POV +250 => black lost 220cp
      pos({ moveNumber: 2, color: "b", san: "g6", scoreCp: 250 }),
    ];
    const drops = findEvalDrops(positions, moves, 50);
    expect(drops).toHaveLength(1);
    expect(drops[0]).toMatchObject({
      moveNumber: 2,
      color: "b",
      san: "g6",
      cpLoss: 220, // (30 * -1) - (250 * -1) => -30 - -250
      engineBest: "Nc6", // b8c6 converted to SAN at the decision FEN
    });
    expect(drops[0].engineLine).toEqual(["Nc6", "Bc4"]);
  });

  it("maps mate scores to ±MATE_SCORE_CP", () => {
    const moves = getAllMoves("1. f3 e5 2. g4 d6");
    const positions: PositionEval[] = [
      pos({ moveNumber: 1, color: "w", san: "f3", scoreCp: -50 }),
      pos({ moveNumber: 1, color: "b", san: "e5", scoreCp: -100 }),
      pos({ moveNumber: 2, color: "w", san: "g4", scoreCp: 0, mate: -1, bestLine: ["d8h4"] }),
      pos({ moveNumber: 2, color: "b", san: "d6", scoreCp: -200 }),
    ];
    const drops = findEvalDrops(positions, moves, 50);
    // Black had mate (mover-POV +10000), played d6 (mover-POV +200): loss 9800
    const blackDrop = drops.find((d) => d.san === "d6");
    expect(blackDrop?.cpLoss).toBe(MATE_SCORE_CP - 200);
  });
});

describe("detectMissedMatesInOne", () => {
  it("flags a missed mate for the correct color", () => {
    // After 2.g4 black has Qh4#; black plays d6 instead.
    const moves = getAllMoves("1. f3 e5 2. g4 d6");
    const positions: PositionEval[] = [
      pos({ moveNumber: 1, color: "w", san: "f3" }),
      pos({ moveNumber: 1, color: "b", san: "e5" }),
      // white-POV: black mates in 1 => mate: -1
      pos({ moveNumber: 2, color: "w", san: "g4", mate: -1, bestLine: ["d8h4"] }),
      pos({ moveNumber: 2, color: "b", san: "d6", scoreCp: -300 }),
    ];
    const missed = detectMissedMatesInOne(moves, positions);
    expect(missed).toEqual([
      { moveNumber: 2, color: "b", playedSan: "d6", mateSan: "Qh4#" },
    ]);
  });

  it("does not flag a delivered mate", () => {
    const moves = getAllMoves("1. f3 e5 2. g4 Qh4#");
    const positions: PositionEval[] = [
      pos({ moveNumber: 1, color: "w", san: "f3" }),
      pos({ moveNumber: 1, color: "b", san: "e5" }),
      pos({ moveNumber: 2, color: "w", san: "g4", mate: -1, bestLine: ["d8h4"] }),
      pos({ moveNumber: 2, color: "b", san: "Qh4#", scoreCp: -MATE_SCORE_CP }),
    ];
    expect(detectMissedMatesInOne(moves, positions)).toEqual([]);
  });

  it("does not flag when mate belongs to the other side", () => {
    // white-POV mate +1 while BLACK is to move => white threatens mate, black has nothing
    const moves = getAllMoves("1. f3 e5 2. g4 d6");
    const positions: PositionEval[] = [
      pos({ moveNumber: 1, color: "w", san: "f3" }),
      pos({ moveNumber: 1, color: "b", san: "e5" }),
      pos({ moveNumber: 2, color: "w", san: "g4", mate: 1, bestLine: ["a2a3"] }),
      pos({ moveNumber: 2, color: "b", san: "d6" }),
    ];
    expect(detectMissedMatesInOne(moves, positions)).toEqual([]);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run`
Expected: FAIL — cannot resolve `@/lib/engine-core`.

- [ ] **Step 5: Implement `src/lib/engine-core.ts`**

```ts
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
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run`
Expected: PASS (all engine-core tests). Then `npx tsc --noEmit` — expect no errors.

- [ ] **Step 7: Commit**

```bash
git add vitest.config.ts src/lib/engine-core.ts src/lib/chess-utils.ts tests/ package.json package-lock.json
git commit -m "feat(engine-core): shared UCI parsing with white-POV normalization

Raw UCI scores are side-to-move POV (verified empirically); the codebase
assumed white-POV everywhere except missed-mate detection. Centralize
parse/normalize/drops/missed-mate logic in one tested module."
```

---

### Task 2: Fix the browser engine path + eval display

**Files:**
- Modify: `src/lib/stockfish.ts` (major rewrite of internals)
- Modify: `src/lib/eval-cache.ts:3` (bump prefix)
- Modify: `src/components/analysis-view.tsx:40-64` (EvalBar terminal handling)
- Modify: `src/lib/battle-allusion.ts:229-246` (stale comments)
- Delete: `src/lib/stockfish-worker.ts`
- Modify: `tsconfig.json:33` (drop the exclude)

**Interfaces:**
- Consumes: everything from Task 1's `engine-core.ts`.
- Produces: `evaluateGame(moves, onProgress?)` keeps its exact existing signature and still returns `Promise<EngineAnalysis>` — callers (`use-cached-analysis.ts`) need no changes.

- [ ] **Step 1: Rewrite `src/lib/stockfish.ts`**

Replace the whole file with:

```ts
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
```

(The old `parseEvalLines`, `findEvalDrops`, `getTerminalEval`, and `EvalResult` in this file are deleted — engine-core owns them now.)

- [ ] **Step 2: Bump the eval cache prefix**

In `src/lib/eval-cache.ts` change:

```ts
const CACHE_PREFIX = "engine-eval:";
```

to:

```ts
// v2: evals are now normalized to white-POV; never reuse v1 entries.
const CACHE_PREFIX = "engine-eval-v2:";
```

- [ ] **Step 3: Teach EvalBar about terminal checkmate scores**

In `src/components/analysis-view.tsx`, replace the body of `EvalBar` (lines 40–51) with:

```tsx
function EvalBar({ scoreCp, mate }: { scoreCp: number; mate: number | null }) {
  let whitePercent: number;
  let label: string;

  if (mate !== null) {
    whitePercent = mate > 0 ? 95 : 5;
    label = `M${Math.abs(mate)}`;
  } else if (Math.abs(scoreCp) >= 9999) {
    // Terminal checkmate position (see MATE_SCORE_CP in engine-core)
    whitePercent = scoreCp > 0 ? 100 : 0;
    label = "#";
  } else {
    const clamped = Math.max(-1000, Math.min(1000, scoreCp));
    whitePercent = 50 + (clamped / 1000) * 45;
    label = scoreCp >= 0 ? `+${(scoreCp / 100).toFixed(1)}` : (scoreCp / 100).toFixed(1);
  }
```

(The returned JSX below is unchanged.)

- [ ] **Step 4: Fix stale comments in `battle-allusion.ts`**

Replace the comment at lines 229–231:

```ts
  // evalAtMove10: position after both sides' 10th move = index 19.
  // Normalize to player's perspective. scoreCp is white-POV in this
  // codebase (see batch-analyze.ts cpLoss formula for the same convention).
```

with:

```ts
  // evalAtMove10: position after both sides' 10th move = index 19.
  // Normalize to player's perspective. scoreCp is white-POV
  // (normalized at parse time in engine-core).
```

and the note at lines 243–246:

```ts
  //
  // Note: mate scores are intentionally ignored here — the raw `mate`
  // field follows the UCI side-to-move convention while `scoreCp` is
  // white-POV, and mixing them risks sign errors. Real comebacks and
  // collapses leave plenty of non-mate eval data in the trajectory for
  // detection, so ignoring mate positions doesn't hurt accuracy.
```

with:

```ts
  //
  // Note: mate scores are intentionally ignored here — positions with a
  // mate score carry scoreCp 0, and real comebacks/collapses leave plenty
  // of non-mate eval data in the trajectory for detection.
```

- [ ] **Step 5: Delete dead worker and its tsconfig exclude**

```bash
git rm src/lib/stockfish-worker.ts
```

In `tsconfig.json` change:

```json
  "exclude": ["node_modules", "src/lib/stockfish-worker.ts"]
```

to:

```json
  "exclude": ["node_modules"]
```

- [ ] **Step 6: Verify**

Run: `npx vitest run` — expect PASS.
Run: `npx tsc --noEmit` — expect no errors.
Run: `npm run build` — expect a successful production build.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "fix(engine): normalize browser evals to white-POV, drop dead worker

Eval bars, cp-loss math, and the evals sent to Claude were sign-flipped
on every position where Black was to move. Bump the localStorage eval
cache prefix so stale side-to-move evals are never reused."
```

---

### Task 3: Deduplicate `scripts/batch-analyze.ts` against `src/lib`

**Files:**
- Modify: `scripts/batch-analyze.ts`
- Modify: `src/lib/types.ts` (add `source`/`analysisVersion` to `AnalysisResult`, export `ANALYSIS_VERSION`)

**Interfaces:**
- Consumes: `engine-core.ts` (all exports), `chess-utils.ts` (`getAllMoves`, `uciToSan`, `uciLineToSan`, `isLegalMoveInFen`, `getLegalMovesInFen`), `analysis-cache.ts` (`analysisCacheKey`), `battle-allusion.ts` (unchanged imports).
- Produces: batch-written Redis analyses now carry `source: "batch"` and `analysisVersion: 2`. Task 5 writes `source: "claude"` with the same version constant.

- [ ] **Step 1: Add provenance fields to `AnalysisResult`**

In `src/lib/types.ts`, add to the `AnalysisResult` interface (after `missedMatesInOne?`):

```ts
  /** Who generated this analysis: Claude coaching or the template-based batch script. */
  source?: "claude" | "batch";
  /** Schema/pipeline version. v2 = white-POV normalized evals. */
  analysisVersion?: number;
```

And at the bottom of the types file add:

```ts
export const ANALYSIS_VERSION = 2;
```

- [ ] **Step 2: Replace batch-analyze's duplicated logic with imports**

In `scripts/batch-analyze.ts`:

1. Extend the imports block:

```ts
import {
  classifyBattle,
  buildFeaturesFromEngineEvals,
  type BattleAllusion,
} from "../src/lib/battle-allusion";
import {
  parseUciInfoLines,
  toWhitePov,
  getTerminalEval,
  findEvalDrops,
  detectMissedMatesInOne,
} from "../src/lib/engine-core";
import {
  getAllMoves,
  isLegalMoveInFen,
  getLegalMovesInFen,
  type MoveDetail,
} from "../src/lib/chess-utils";
import { analysisCacheKey } from "../src/lib/analysis-cache";
import { ANALYSIS_VERSION, type PositionEval, type EvalDrop } from "../src/lib/types";
```

2. Delete these now-redundant local definitions (keep everything else):
   - the `MoveDetail`, `PositionEval`, `EvalDrop` interfaces (lines 48–50) and the local `AnalysisResult` interface (lines 51–58) — import `AnalysisResult` from `../src/lib/types` instead
   - `parseResult` (lines 93–107)
   - `getTerminalEval` (lines 116–124)
   - `analysisCacheKey` (lines 135–139)
   - `getAllMoves` (lines 152–172)
   - `uciToSan` and `uciLineToSan` (lines 176–209)
   - `isLegalMoveAt` and `getLegalMovesAt` (lines 216–228) — the two call sites in `generateAnalysis` (lines 421 and 424) become `isLegalMoveInFen(decisionFen, cm.suggestion)` and `getLegalMovesInFen(decisionFen, cm.move)`
   - the missed-mate loop (lines 254–281) and the drops loop (lines 283–305) inside `evaluateGame`

3. `evalPosition` becomes:

```ts
async function evalPosition(fen: string): Promise<ReturnType<typeof parseUciInfoLines>> {
  collectedLines = [];
  engine.ccall("command", null, ["string"], [`position fen ${fen}`]);
  await engine.ccall("command", null, ["string"], [`go depth ${TARGET_DEPTH}`], { async: true });
  return parseUciInfoLines(collectedLines);
}
```

4. The body of the script's `evaluateGame` becomes:

```ts
async function evaluateGame(moves: MoveDetail[]): Promise<{
  positions: PositionEval[];
  drops: EvalDrop[];
  missedMatesInOne: Array<{ moveNumber: number; color: "w" | "b"; playedSan: string; mateSan: string }>;
}> {
  const positions: PositionEval[] = [];

  for (const move of moves) {
    const result =
      getTerminalEval(move.fen, TARGET_DEPTH) ??
      toWhitePov(await evalPosition(move.fen), move.fen);
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

  const drops = findEvalDrops(positions, moves, CP_DROP_THRESHOLD);
  const missedMatesInOne = detectMissedMatesInOne(moves, positions);
  return { positions, drops, missedMatesInOne };
}
```

- [ ] **Step 3: Fix the mate-availability check in `generateAnalysis`**

The check at line 385 treated any nearby mate score as "the player had a forced mate" — under white-POV the mate must belong to the mover. Replace:

```ts
    if (prevEval != null && prevEval.mate !== null && Math.abs(prevEval.mate) <= 10) {
```

with:

```ts
    const moverHadMate =
      prevEval != null &&
      prevEval.mate !== null &&
      Math.abs(prevEval.mate) <= 10 &&
      (drop.color === "w" ? prevEval.mate > 0 : prevEval.mate < 0);
    if (moverHadMate) {
```

(`prevEval.mate` is used two lines below as `Math.abs(prevEval.mate)` — unchanged.)

- [ ] **Step 4: Tag batch-written analyses**

In `generateAnalysis`'s return statement, extend the analysis object:

```ts
    analysis: {
      opening: { name: openingName, assessment: openingAssessment, comment: openingComment },
      criticalMoments,
      positionalThemes: themes,
      endgame: { reached: endgameReached, comment: endgameComment },
      summary: { overallAssessment, focusArea, battleAllusion },
      missedMatesInOne: playerMissedMates.length > 0 ? playerMissedMates : undefined,
      source: "batch",
      analysisVersion: ANALYSIS_VERSION,
    },
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` — expect no errors.
Run: `npx vitest run` — expect PASS.
Smoke test (needs `.env.local` with `KV_REST_API_URL`/`KV_REST_API_TOKEN`; skips already-cached games so it should be quick if no new games):

```bash
npx dotenv-cli -e .env.local -- npx tsx scripts/batch-analyze.ts
```

Expected: initializes Stockfish, lists games with "skipping N already analyzed", exits 0. (Full regeneration happens in Task 7.)

- [ ] **Step 6: Commit**

```bash
git add scripts/batch-analyze.ts src/lib/types.ts
git commit -m "refactor(batch): use shared engine-core, tag analyses with source+version

Deletes ~200 duplicated lines. Batch evals are now white-POV normalized,
and the 'you had a forced mate' template only fires when the mate
actually belonged to the mover."
```

---

### Task 4: Validate Claude's JSON with zod + fix the eval prompt labels

**Files:**
- Create: `src/lib/schemas.ts`
- Create: `tests/schemas.test.ts`
- Modify: `src/lib/claude.ts`

**Interfaces:**
- Consumes: `EngineAnalysis` from types, `detectMissedMatesInOne` from engine-core.
- Produces (used by Task 5):
  - `AnalyzeRequestSchema` — zod schema for the POST /api/analyze body
  - `AnalysisResultSchema`, `MetaAnalysisResultSchema` — Claude response schemas
  - `analyzeGame(pgn, username, color, rating, engineEvals?: EngineAnalysis)` — signature now uses the `EngineAnalysis` type; behavior addition: sets `result.missedMatesInOne` from engine data.

- [ ] **Step 1: Install zod**

```bash
npm install zod
```

- [ ] **Step 2: Write failing schema tests**

Create `tests/schemas.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  AnalysisResultSchema,
  MetaAnalysisResultSchema,
  AnalyzeRequestSchema,
} from "@/lib/schemas";

const validAnalysis = {
  opening: { name: "Italian Game", assessment: "good", comment: "Solid." },
  criticalMoments: [
    { moveNumber: 12, move: "Nxe5", type: "blunder", comment: "Drops a piece.", suggestion: "Nf3" },
  ],
  positionalThemes: "Open center.",
  endgame: { reached: false, comment: "" },
  summary: { overallAssessment: "Good game.", focusArea: "Tactics." },
};

describe("AnalysisResultSchema", () => {
  it("accepts a valid analysis", () => {
    expect(AnalysisResultSchema.safeParse(validAnalysis).success).toBe(true);
  });

  it("defaults a missing suggestion to empty string", () => {
    const noSuggestion = {
      ...validAnalysis,
      criticalMoments: [{ moveNumber: 3, move: "e4", type: "excellent", comment: "Nice." }],
    };
    const parsed = AnalysisResultSchema.parse(noSuggestion);
    expect(parsed.criticalMoments[0].suggestion).toBe("");
  });

  it("rejects an invalid moment type", () => {
    const bad = {
      ...validAnalysis,
      criticalMoments: [{ moveNumber: 1, move: "e4", type: "brilliant", comment: "x", suggestion: "" }],
    };
    expect(AnalysisResultSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a missing summary", () => {
    const { summary: _summary, ...bad } = validAnalysis;
    expect(AnalysisResultSchema.safeParse(bad).success).toBe(false);
  });
});

describe("AnalyzeRequestSchema", () => {
  const base = { pgn: "1. e4 e5", username: "castledoon", color: "white" };

  it("accepts a minimal valid request", () => {
    expect(AnalyzeRequestSchema.safeParse(base).success).toBe(true);
  });

  it("rejects an oversized PGN", () => {
    expect(
      AnalyzeRequestSchema.safeParse({ ...base, pgn: "x".repeat(20001) }).success
    ).toBe(false);
  });

  it("rejects malformed engineEvals positions", () => {
    const bad = {
      ...base,
      engineEvals: { positions: [{ moveNumber: "one" }], drops: [] },
    };
    expect(AnalyzeRequestSchema.safeParse(bad).success).toBe(false);
  });
});

describe("MetaAnalysisResultSchema", () => {
  it("rejects a response missing coachingPlan", () => {
    expect(MetaAnalysisResultSchema.safeParse({ playerUsername: "x" }).success).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/schemas.test.ts`
Expected: FAIL — cannot resolve `@/lib/schemas`.

- [ ] **Step 4: Implement `src/lib/schemas.ts`**

```ts
import { z } from "zod";

// --- Request validation (POST /api/analyze) ---

export const PositionEvalSchema = z.object({
  moveNumber: z.number().int().min(1),
  color: z.enum(["w", "b"]),
  san: z.string().min(1).max(10),
  scoreCp: z.number().int().min(-30000).max(30000),
  mate: z.number().int().nullable(),
  bestLine: z.array(z.string().max(8)).max(64),
  depth: z.number().int().min(0).max(99),
});

export const AnalyzeRequestSchema = z.object({
  pgn: z.string().min(1).max(20000),
  username: z.string().min(1).max(50),
  color: z.enum(["white", "black"]),
  rating: z.number().int().min(0).max(4000).optional(),
  cacheOnly: z.boolean().optional(),
  engineEvals: z
    .object({
      // Client-computed drops are ignored; the server recomputes them.
      positions: z.array(PositionEvalSchema).max(600),
      drops: z.array(z.unknown()).optional(),
    })
    .optional(),
});

// --- Claude response validation ---

const CriticalMomentSchema = z.object({
  moveNumber: z.number().int().min(1),
  move: z.string().min(1),
  type: z.enum(["blunder", "mistake", "excellent", "missed_tactic"]),
  comment: z.string(),
  suggestion: z.string().optional().default(""),
});

export const AnalysisResultSchema = z.object({
  opening: z.object({
    name: z.string(),
    assessment: z.enum(["good", "inaccurate", "dubious"]),
    comment: z.string(),
  }),
  criticalMoments: z.array(CriticalMomentSchema),
  positionalThemes: z.string(),
  endgame: z.object({ reached: z.boolean(), comment: z.string() }),
  summary: z.object({ overallAssessment: z.string(), focusArea: z.string() }),
});

const MetaThemeSchema = z.object({
  title: z.string(),
  sentiment: z.enum(["strength", "weakness", "neutral"]),
  frequency: z.enum(["consistent", "occasional", "rare"]),
  description: z.string(),
  examples: z.array(z.string()),
  actionItem: z.string(),
});

export const MetaAnalysisResultSchema = z.object({
  playerUsername: z.string(),
  gamesAnalyzed: z.number(),
  timeRange: z.string(),
  overallProfile: z.string(),
  ratingTrend: z.string(),
  strengths: z.array(MetaThemeSchema),
  weaknesses: z.array(MetaThemeSchema),
  openingRepertoire: z.object({
    asWhite: z.string(),
    asBlack: z.string(),
    recommendation: z.string(),
  }),
  timeControlInsights: z.object({
    breakdown: z.string(),
    comparison: z.string(),
    recommendation: z.string(),
  }),
  endgameTendency: z.string(),
  coachingPlan: z.array(z.string()),
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/schemas.test.ts`
Expected: PASS.

- [ ] **Step 6: Wire validation + missed-mates into `src/lib/claude.ts`**

1. Update imports:

```ts
import Anthropic from "@anthropic-ai/sdk";
import { AnalysisResult, CriticalMoment, MetaAnalysisResult, EngineAnalysis } from "./types";
import {
  isLegalMoveAt,
  moveExistsInGame,
  getAllMoves,
  getLegalMovesAt,
} from "./chess-utils";
import { detectMissedMatesInOne } from "./engine-core";
import { AnalysisResultSchema, MetaAnalysisResultSchema } from "./schemas";
import {
  classifyBattle,
  buildFeaturesFromEngineEvals,
} from "./battle-allusion";
```

2. Replace the inline `engineEvals` parameter types on **both** `buildUserPrompt` and `analyzeGame` with `engineEvals?: EngineAnalysis` (the inline shapes are identical to `EngineAnalysis`).

3. In `buildUserPrompt`, the eval labels must present white-POV mate signs correctly. Replace:

```ts
        const score = p.mate !== null ? `mate in ${p.mate}` : `${p.scoreCp}cp`;
```

with:

```ts
        const score =
          p.mate !== null
            ? `mate in ${Math.abs(p.mate)} for ${p.mate > 0 ? "White" : "Black"}`
            : Math.abs(p.scoreCp) >= 9999
            ? p.scoreCp > 0
              ? "White wins by checkmate"
              : "Black wins by checkmate"
            : `${p.scoreCp}cp`;
```

4. In `analyzeGame`, replace the parse block:

```ts
  let result: AnalysisResult;
  try {
    result = JSON.parse(jsonStr) as AnalysisResult;
  } catch {
    throw new Error("Failed to parse analysis response from Claude");
  }
```

with:

```ts
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(jsonStr);
  } catch {
    throw new Error("Failed to parse analysis response from Claude");
  }

  const validated = AnalysisResultSchema.safeParse(parsedJson);
  if (!validated.success) {
    const issues = validated.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Claude response failed schema validation: ${issues}`);
  }
  const result: AnalysisResult = validated.data;
```

5. Replace the whole battle-allusion block at the end of `analyzeGame`:

```ts
  // Compute battle allusion deterministically (server-side, prompt untouched).
  if (engineEvals) {
    ...
  }

  return result;
```

with:

```ts
  // Deterministic post-processing from engine data (server-side, prompt untouched).
  if (engineEvals) {
    const playerColorChar: "w" | "b" = color === "white" ? "w" : "b";

    // Missed mates-in-one were previously only computed by the batch script;
    // now the live path produces them too.
    const moves = getAllMoves(pgn);
    const playerMissedMates = detectMissedMatesInOne(moves, engineEvals.positions).filter(
      (m) => m.color === playerColorChar
    );
    if (playerMissedMates.length > 0) {
      result.missedMatesInOne = playerMissedMates;
    }

    const gameResult = deriveResultFromPgn(pgn, playerColorChar);
    if (gameResult) {
      result.summary.battleAllusion = classifyBattle(
        buildFeaturesFromEngineEvals(
          engineEvals,
          playerColorChar,
          gameResult,
          result.opening.assessment,
          result.endgame.reached,
          { missedMate: playerMissedMates.length > 0 }
        )
      );
    }
  }

  return result;
```

6. In `analyzePlayerMeta`, replace:

```ts
  try {
    return JSON.parse(jsonStr) as MetaAnalysisResult;
  } catch {
    throw new Error("Failed to parse meta analysis response from Claude");
  }
```

with:

```ts
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(jsonStr);
  } catch {
    throw new Error("Failed to parse meta analysis response from Claude");
  }

  const validated = MetaAnalysisResultSchema.safeParse(parsedJson);
  if (!validated.success) {
    const issues = validated.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Meta analysis response failed schema validation: ${issues}`);
  }
  return validated.data as MetaAnalysisResult;
```

- [ ] **Step 7: Verify and commit**

Run: `npx vitest run` and `npx tsc --noEmit` — expect PASS / no errors.

```bash
git add src/lib/schemas.ts src/lib/claude.ts tests/schemas.test.ts package.json package-lock.json
git commit -m "feat(claude): zod-validate LLM responses, accurate mate labels, live missed-mate detection"
```

---

### Task 5: Harden /api/analyze and fix the cache-check client

**Files:**
- Create: `src/lib/rate-limit.ts`
- Create: `tests/rate-limit.test.ts`
- Modify: `src/app/api/analyze/route.ts` (rewrite)
- Modify: `src/hooks/use-cached-analysis.ts` (checkCache signature + cache prefix bump)
- Modify: `src/app/analysis/[username]/page.tsx:70` (checkCache call site)

**Interfaces:**
- Consumes: `AnalyzeRequestSchema` (Task 4), `findEvalDrops` (Task 1), `ANALYSIS_VERSION` (Task 3), `getAllMoves`.
- Produces: `allowRequest(key: string, limit?: number, windowMs?: number, now?: number): boolean`; `checkCache(pgn: string, username: string, color: "white" | "black")` — new hook signature.

- [ ] **Step 1: Write failing rate-limit test**

Create `tests/rate-limit.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { allowRequest } from "@/lib/rate-limit";

describe("allowRequest", () => {
  it("allows up to the limit within a window, then blocks", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) {
      expect(allowRequest("k1", 5, 60_000, t0 + i)).toBe(true);
    }
    expect(allowRequest("k1", 5, 60_000, t0 + 10)).toBe(false);
  });

  it("frees slots after the window expires", () => {
    const t0 = 2_000_000;
    for (let i = 0; i < 3; i++) allowRequest("k2", 3, 1_000, t0);
    expect(allowRequest("k2", 3, 1_000, t0 + 500)).toBe(false);
    expect(allowRequest("k2", 3, 1_000, t0 + 1_001)).toBe(true);
  });

  it("tracks keys independently", () => {
    const t0 = 3_000_000;
    allowRequest("k3", 1, 60_000, t0);
    expect(allowRequest("k3", 1, 60_000, t0)).toBe(false);
    expect(allowRequest("k4", 1, 60_000, t0)).toBe(true);
  });
});
```

Run: `npx vitest run tests/rate-limit.test.ts` — expect FAIL (module not found).

- [ ] **Step 2: Implement `src/lib/rate-limit.ts`**

```ts
/**
 * Minimal in-memory sliding-window rate limiter. Per-instance only — good
 * enough for a personal deployment; swap for Upstash Ratelimit if this app
 * ever runs multi-instance.
 */
const hits = new Map<string, number[]>();

export function allowRequest(
  key: string,
  limit = 10,
  windowMs = 60_000,
  now = Date.now()
): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}
```

Run: `npx vitest run tests/rate-limit.test.ts` — expect PASS.

- [ ] **Step 3: Rewrite `src/app/api/analyze/route.ts`**

```ts
import { NextRequest } from "next/server";
import { analyzeGame } from "@/lib/claude";
import { isAllowedUser } from "@/lib/chess-com";
import { getCachedAnalysis, setCachedAnalysis } from "@/lib/analysis-cache";
import { AnalyzeRequestSchema } from "@/lib/schemas";
import { findEvalDrops } from "@/lib/engine-core";
import { getAllMoves } from "@/lib/chess-utils";
import { allowRequest } from "@/lib/rate-limit";
import { ANALYSIS_VERSION, EngineAnalysis } from "@/lib/types";

export async function POST(request: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = AnalyzeRequestSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: "Invalid request" }, { status: 400 });
    }
    const { pgn, username, color, rating, cacheOnly, engineEvals } = parsed.data;

    // Allowlist check comes before any cache read — the cache is shared.
    if (!isAllowedUser(username)) {
      return Response.json({ error: "Player not available" }, { status: 403 });
    }

    const cached = await getCachedAnalysis(pgn);
    if (cached) {
      return Response.json(cached);
    }

    // If cache-only mode, don't call Claude — just report the miss
    if (cacheOnly) {
      return new Response(null, { status: 204 });
    }

    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    if (!allowRequest(`analyze:${ip}`, 10, 60_000)) {
      return Response.json({ error: "Too many requests" }, { status: 429 });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return Response.json(
        { error: "ANTHROPIC_API_KEY not configured" },
        { status: 500 }
      );
    }

    // Never trust client-derived analysis data: verify the submitted positions
    // actually correspond to this PGN, and recompute the eval drops here.
    let serverEvals: EngineAnalysis | undefined;
    if (engineEvals) {
      const moves = getAllMoves(pgn);
      const aligned =
        engineEvals.positions.length === moves.length &&
        engineEvals.positions.every((p, i) => p.san === moves[i].san);
      if (!aligned) {
        return Response.json(
          { error: "engineEvals do not match the submitted PGN" },
          { status: 400 }
        );
      }
      serverEvals = {
        positions: engineEvals.positions,
        drops: findEvalDrops(engineEvals.positions, moves),
      };
    }

    const analysis = await analyzeGame(pgn, username, color, rating || 1000, serverEvals);
    const tagged = { ...analysis, source: "claude" as const, analysisVersion: ANALYSIS_VERSION };

    // Store in cache for future requests (fire-and-forget)
    setCachedAnalysis(pgn, tagged);

    return Response.json(tagged);
  } catch (error) {
    console.error("Analysis error:", error);
    return Response.json(
      { error: "Failed to analyze game. Please try again." },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 4: Fix the cache-check client**

In `src/hooks/use-cached-analysis.ts`:

1. Bump the localStorage prefix (stale pre-fix analyses shouldn't be reused):

```ts
const CACHE_PREFIX = "analysis-v2:";
```

2. Change `checkCache` to send real identity instead of `username: "_"`:

```ts
  async function checkCache(pgn: string, username: string, color: "white" | "black") {
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pgn, username, color, cacheOnly: true }),
      });

      if (res.status === 204) return;

      if (res.ok) {
        const result: AnalysisResult = await res.json();
        setAnalysis(result);
        saveToLocalStorage(result);
        setPhase("done");
      }
    } catch {
      // Cache check failed — not critical
    }
  }
```

3. In `src/app/analysis/[username]/page.tsx`, update the call site (the `useEffect` around line 67):

```ts
  useEffect(() => {
    if (game && !analysis && !loading) {
      checkCache(game.pgn, username, getPlayerColor(game, username));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, analysis, loading]);
```

(`getPlayerColor` is already imported in this file.)

- [ ] **Step 5: Verify end-to-end**

Run: `npx vitest run` and `npx tsc --noEmit` — PASS / no errors.
Run: `npm run build` — expect success.

Manual smoke (requires `.env.local`): `npm run dev`, then:

```bash
# 403 for a non-allowlisted user (allowlist now precedes cache):
curl -s -X POST http://localhost:3000/api/analyze -H "Content-Type: application/json" -d "{\"pgn\":\"1. e4 e5\",\"username\":\"someone-else\",\"color\":\"white\",\"cacheOnly\":true}"
# 400 for junk:
curl -s -X POST http://localhost:3000/api/analyze -H "Content-Type: application/json" -d "{\"pgn\":\"\"}"
```

In the app, open a cached game for CastleDoon and confirm the cached analysis still loads.

- [ ] **Step 6: Commit**

```bash
git add src/lib/rate-limit.ts tests/rate-limit.test.ts src/app/api/analyze/route.ts src/hooks/use-cached-analysis.ts "src/app/analysis/[username]/page.tsx"
git commit -m "feat(api): validate + rate-limit /api/analyze, recompute drops server-side

Allowlist now precedes the shared-cache read, request bodies are
zod-validated, client-computed drops are ignored and recomputed, and
Claude analyses are tagged source=claude/version=2."
```

---

### Task 6: Repo hygiene — gitignore, deps, README, batch-source note in UI

**Files:**
- Modify: `.gitignore`
- Modify: `package.json` (remove `stockfish.js` dependency)
- Rewrite: `README.md`
- Modify: `src/components/analysis-view.tsx` (small source badge)
- Add to git: `scripts/rapid-report.ts`, `scripts/build-rapid-html.ts`

**Interfaces:**
- Consumes: `AnalysisResult.source` from Task 3.
- Produces: nothing consumed by other tasks.

- [ ] **Step 1: Remove the unused `stockfish.js` dependency**

The browser worker loads `/stockfish.wasm.js` from `public/` (tracked in git); the npm package was only its original source. The batch script uses the separate `stockfish` package, which stays.

```bash
npm uninstall stockfish.js
npx tsc --noEmit
npm run build
```

Expected: both succeed.

- [ ] **Step 2: Extend `.gitignore` and untrack generated data**

Append to `.gitignore`:

```gitignore
# local debug/analysis artifacts
*.log
/*.PNG
/*.png
/*.html
scripts/data/
.claude/scheduled_tasks.lock
tsconfig.tsbuildinfo
```

Untrack committed artifacts (files stay on disk):

```bash
git rm -r --cached --ignore-unmatch scripts/data tsconfig.tsbuildinfo
```

Track the two intentional scripts that are currently untracked:

```bash
git add scripts/rapid-report.ts scripts/build-rapid-html.ts
```

- [ ] **Step 3: Show analysis provenance in the UI**

In `src/components/analysis-view.tsx`, inside the SUMMARY card, directly under `<p className="text-gray-200">{analysis.summary.overallAssessment}</p>`, add:

```tsx
        {analysis.source === "batch" && (
          <p className="mt-2 text-xs text-gray-500">
            Engine-generated summary — tap Analyze on the game page for full coaching commentary.
          </p>
        )}
```

- [ ] **Step 4: Rewrite `README.md`**

Replace the stock create-next-app README with:

```markdown
# Chess Coach

A mobile-first chess coaching app for Chess.com games. Runs Stockfish WASM
in the browser for objective evaluations, then asks Claude for coaching
commentary grounded in those evals.

## How it works

1. **Games** are fetched from the Chess.com public API and cached in
   Upstash Redis (past months forever, current month for 5 minutes).
2. **Engine analysis** runs client-side in a Web Worker
   (`public/stockfish.wasm.js`, depth 16). All scores are normalized to
   white-POV at parse time (`src/lib/engine-core.ts`).
3. **Coaching** — `/api/analyze` recomputes eval drops server-side, sends
   PGN + evals to Claude, validates the JSON response with zod, verifies
   every suggested move is legal, and caches the result in Redis for 90 days.
4. **Meta coaching** (`/meta/[username]`) is generated offline by
   `scripts/backfill-meta.ts` and served read-only.

Access is limited to the users in `ALLOWED_USERS` (`src/lib/chess-com.ts`).

## Setup

```bash
npm install
```

Create `.env.local`:

```
ANTHROPIC_API_KEY=sk-ant-...
KV_REST_API_URL=https://...upstash.io
KV_REST_API_TOKEN=...
```

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server (use `npm run dev -- -H 0.0.0.0` for LAN/mobile testing) |
| `npm run build` / `npm start` | Production build / serve |
| `npm test` | Run the vitest suite |
| `npx dotenv-cli -e .env.local -- npx tsx scripts/batch-analyze.ts` | Engine-analyze all uncached games ($0 API cost), then refresh meta analysis |
| `npx dotenv-cli -e .env.local -- npx tsx scripts/batch-analyze.ts --force-days N` | Re-analyze games from the last N days even if cached |
| `npx dotenv-cli -e .env.local -- npx tsx scripts/backfill-meta.ts --force` | Regenerate the meta coaching report (uses Claude) |

## Architecture notes

- `src/lib/engine-core.ts` — single source of truth for UCI parsing,
  white-POV normalization, eval-drop detection, and missed-mate-in-1
  detection. Used by the browser path, the API route, and the batch script.
- Analyses in Redis carry `source: "claude" | "batch"` and
  `analysisVersion` so the two writers are distinguishable.
- Caches: localStorage (`analysis-v2:` 7d, `engine-eval-v2:` 30d),
  Redis (`analysis:<pgn-hash>` 90d, game archives).
```

- [ ] **Step 5: Verify and commit**

Run: `npx vitest run`, `npx tsc --noEmit` — PASS.
Run: `git status` — confirm `scripts/data/`, root logs/PNGs/HTML no longer appear as untracked/tracked changes (aside from files intentionally staged).

```bash
git add .gitignore package.json package-lock.json README.md src/components/analysis-view.tsx
git commit -m "chore: gitignore artifacts, drop unused stockfish.js dep, real README, batch-source badge"
```

---

### Task 7: Regenerate cached analyses (operational, long-running)

All Redis analyses written before this cleanup were derived from sign-flipped evals; their eval drops, mate claims, and battle allusions are unreliable. The 90-day TTL would age them out eventually, but regenerating now is cheap ($0 — batch is template-based).

**Trade-off to know:** `--force-days 90` also overwrites Claude-written analyses with batch (template) ones. That is acceptable — the old Claude commentary was grounded in wrong evals — and any game can be re-analyzed with Claude from the UI afterward.

- [ ] **Step 1: Full regeneration** (takes a long time — depth-14 eval of every position of ~3 months of games; run when the machine can be left alone)

```bash
npx dotenv-cli -e .env.local -- npx tsx scripts/batch-analyze.ts --force-days 90
```

Expected: per-game `OK` lines; finishes with "Done! Analyzed N games" and then runs the meta backfill automatically.

- [ ] **Step 2: Spot-check in the app**

Open a recent loss on the analysis page: the eval bar should now move smoothly (no per-move sign zigzag), and any "missed mate" claims should match what the board shows. Check the meta page renders and its missed-mates section populates.

- [ ] **Step 3: Commit nothing** — this task only touches Redis data.

---

## Self-Review Notes

- **Spec coverage:** assessment items → tasks: perspective bug (#1) → Tasks 1–3; dedup + dead code (#2) → Tasks 2–3, 6; cache provenance + live missed-mates (#3) → Tasks 3–5; API trust boundary (#4) → Task 5 (decision: no shared-secret auth — any secret shipped in client JS is theater for a personal LAN app; ordering fix + validation + rate limit + server recompute instead); zod validation (#5) → Task 4; tests/hygiene/README (#6) → Tasks 1, 6.
- **Perspective consistency check:** after Task 1, the only places raw side-to-move scores exist are inside `evaluatePosition` (browser) and `evalPosition` (batch), both immediately wrapped by `toWhitePov`/`getTerminalEval`. `detectMissedMatesInOne` expects white-POV and both callers pass normalized data.
- **Type consistency:** `findEvalDrops(positions, moves, threshold?)` is used with that exact argument order in Tasks 2, 3, 5. `checkCache(pgn, username, color)` matches between hook and page. `ANALYSIS_VERSION` lives in `src/lib/types.ts` and is imported by Tasks 3 and 5.
