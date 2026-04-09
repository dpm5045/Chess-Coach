# WW2 Battle Allusion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a small WW2 battle allusion card to every game's summary section, driven by a shared deterministic classifier that plugs into batch-analyze, the runtime Claude path, and a one-shot backfill script for existing cached analyses.

**Architecture:** One module `src/lib/battle-allusion.ts` owns the catalog, feature types, extraction helpers, and classifier. Three callers use it: `scripts/batch-analyze.ts` and `src/lib/claude.ts` compute rich features from engine evals; `scripts/backfill-battle-allusions.ts` computes coarse features from `AnalysisResult` + PGN alone. The UI reads `analysis.summary.battleAllusion` and renders a small card below the focus area when present.

**Tech Stack:** TypeScript, Next.js 16.2.2, Upstash Redis, chess.js, Tailwind (existing tokens), `tsx` for standalone scripts. No test framework — lightweight smoke-test script uses `node:assert` and runs under `tsx`.

**Spec:** `docs/superpowers/specs/2026-04-09-ww2-battle-allusion-design.md`

---

## File structure

**Create:**
- `src/lib/battle-allusion.ts` — catalog, types, classifier, feature extractors
- `scripts/test-battle-allusion.ts` — standalone smoke tests (runnable via `npx tsx`)
- `scripts/backfill-battle-allusions.ts` — backfill Redis analyses

**Modify:**
- `src/lib/types.ts` — add `BattleAllusion` interface + optional field on `AnalysisResult.summary`
- `scripts/batch-analyze.ts` — update local `AnalysisResult` interface, call classifier in `generateAnalysis`
- `src/lib/claude.ts` — post-parse server-side classification (prompt untouched)
- `src/components/analysis-view.tsx` — render the battle card below the focus area

---

## Task 1: Type additions and catalog module scaffold

**Files:**
- Modify: `src/lib/types.ts`
- Create: `src/lib/battle-allusion.ts`

- [ ] **Step 1: Add `BattleAllusion` interface and optional summary field**

Edit `src/lib/types.ts`. Find the `AnalysisResult` interface (starts around line 80). Add a new interface immediately before it and extend the `summary` field:

```ts
export interface BattleAllusion {
  battleName: string;
  subtitle: string;
  flavor: string;
}
```

Then in the `AnalysisResult.summary` object, add `battleAllusion?: BattleAllusion;`:

```ts
  summary: {
    overallAssessment: string;
    focusArea: string;
    battleAllusion?: BattleAllusion;
  };
```

- [ ] **Step 2: Create `src/lib/battle-allusion.ts` with the catalog and type stubs**

Create the file with this exact content:

```ts
import { BattleAllusion } from "./types";

/**
 * Catalog of WW2 battles used as game-shape analogies.
 * Each entry is frozen and referenced by rule id in classifyBattle.
 * To tweak a flavor line, edit it here — no other changes needed.
 */
export const BATTLES = {
  blitzkrieg: {
    battleName: "Blitzkrieg",
    subtitle: "Poland, 1939",
    flavor:
      "Overwhelming force, minimal resistance, victory in a handful of moves.",
  },
  fall_of_berlin: {
    battleName: "Fall of Berlin",
    subtitle: "Germany, 1945",
    flavor: "The outcome was never in doubt — only the march to finish it.",
  },
  battle_of_the_bulge: {
    battleName: "Battle of the Bulge",
    subtitle: "Ardennes, 1944",
    flavor:
      "Caught cold in a losing position, you regrouped and counter-attacked to flip the result.",
  },
  midway: {
    battleName: "Midway",
    subtitle: "Pacific, 1942",
    flavor:
      "An inferior position turned decisive in a handful of pivotal moves.",
  },
  stalingrad: {
    battleName: "Stalingrad",
    subtitle: "Eastern Front, 1942–43",
    flavor:
      "Long, attritional, and decided by who made fewer mistakes over the final stretch.",
  },
  el_alamein: {
    battleName: "El Alamein",
    subtitle: "North Africa, 1942",
    flavor:
      "A positional squeeze with no tactical fireworks — technique won it.",
  },
  iwo_jima: {
    battleName: "Iwo Jima",
    subtitle: "Pacific, 1945",
    flavor:
      "You won, but you left forced mates on the board that should have ended things sooner.",
  },
  leningrad: {
    battleName: "Siege of Leningrad",
    subtitle: "Eastern Front, 1941–44",
    flavor:
      "Under pressure the entire game, you never broke, and the position held.",
  },
  dunkirk: {
    battleName: "Dunkirk",
    subtitle: "English Channel, 1940",
    flavor:
      "A losing position that you scrambled to save — not pretty, but the damage was contained.",
  },
  pearl_harbor: {
    battleName: "Pearl Harbor",
    subtitle: "Hawaii, 1941",
    flavor:
      "Caught unprepared in the opening — the damage was done before the middlegame began.",
  },
  market_garden: {
    battleName: "Operation Market Garden",
    subtitle: "Netherlands, 1944",
    flavor:
      "A winning plan unraveled one bridge too far — a decisive advantage slipped away.",
  },
  fall_of_france: {
    battleName: "Fall of France",
    subtitle: "Western Front, 1940",
    flavor:
      "Outmaneuvered from early on, and every attempt to regroup only delayed the inevitable.",
  },
} as const satisfies Record<string, BattleAllusion>;

export type BattleId = keyof typeof BATTLES;

/**
 * Shape features extracted from a game. All "rich-mode only" fields are
 * omitted in backfill (coarse) mode where eval trajectory data isn't
 * available. classifyBattle degrades gracefully when fields are undefined.
 */
export interface BattleShapeFeatures {
  result: "win" | "loss" | "draw";
  totalMoves: number;
  playerBlunders: number;
  playerMistakes: number;
  openingAssessment: "good" | "inaccurate" | "dubious";
  missedMate: boolean;
  endgameReached: boolean;

  // Rich-mode only:
  opponentBlunders?: number;
  comebackSwingCp?: number;
  collapseSwingCp?: number;
  evalAtMove10?: number;
}

/**
 * Deterministically map a game's shape to a battle. Rules are evaluated
 * top to bottom; the first match wins. Rules whose required fields are
 * undefined (coarse mode) are skipped.
 */
export function classifyBattle(features: BattleShapeFeatures): BattleAllusion {
  const f = features;

  // Rule 1: pyrrhic win (missed mate while winning)
  if (f.missedMate && f.result === "win") return BATTLES.iwo_jima;

  // Rule 2: opening collapse loss
  if (
    f.result === "loss" &&
    f.evalAtMove10 !== undefined &&
    f.evalAtMove10 < -300 &&
    f.playerBlunders >= 1 &&
    f.totalMoves <= 25
  ) {
    return BATTLES.pearl_harbor;
  }

  // Rule 3: thrown win (was winning, then lost)
  if (
    f.result === "loss" &&
    f.collapseSwingCp !== undefined &&
    f.collapseSwingCp >= 300
  ) {
    return BATTLES.market_garden;
  }

  // Rule 4: comeback win (was losing, then won)
  if (
    f.result === "win" &&
    f.comebackSwingCp !== undefined &&
    f.comebackSwingCp >= 300
  ) {
    return f.totalMoves < 35 ? BATTLES.midway : BATTLES.battle_of_the_bulge;
  }

  // Rule 5: evacuation draw (was losing, held to a draw)
  if (
    f.result === "draw" &&
    f.evalAtMove10 !== undefined &&
    f.evalAtMove10 < -150
  ) {
    return BATTLES.dunkirk;
  }

  // Rule 6: defensive hold draw (any other draw)
  if (f.result === "draw") return BATTLES.leningrad;

  // Rule 7: fast crushing win
  if (
    f.result === "win" &&
    f.totalMoves <= 20 &&
    f.playerBlunders === 0
  ) {
    return BATTLES.blitzkrieg;
  }

  // Rule 8: clean positional win in endgame
  if (
    f.result === "win" &&
    f.playerBlunders === 0 &&
    f.endgameReached
  ) {
    return BATTLES.el_alamein;
  }

  // Rule 9: grinding win reaching endgame
  if (f.result === "win" && f.endgameReached) return BATTLES.stalingrad;

  // Rule 10: default win
  if (f.result === "win") return BATTLES.fall_of_berlin;

  // Rule 11: default loss
  return BATTLES.fall_of_france;
}
```

- [ ] **Step 3: Verify the build passes**

Run: `npm run build`
Expected: `✓ Compiled successfully`, TypeScript clean, no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/types.ts src/lib/battle-allusion.ts
git commit -m "feat(battle-allusion): add BattleAllusion type, catalog, and classifier"
```

---

## Task 2: Smoke tests for the classifier (TDD)

**Files:**
- Create: `scripts/test-battle-allusion.ts`

This task creates the test harness before we touch the feature extractors. If the classifier logic from Task 1 has a bug, this test catches it before we build anything on top.

- [ ] **Step 1: Create the test script**

Create `scripts/test-battle-allusion.ts` with this exact content:

```ts
/**
 * Smoke tests for battle-allusion classifier and feature extractors.
 * Run: npx tsx scripts/test-battle-allusion.ts
 * Exits with code 1 if any assertion fails.
 */

import { strict as assert } from "node:assert";
import {
  classifyBattle,
  BATTLES,
  type BattleShapeFeatures,
} from "../src/lib/battle-allusion";

let failures = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures++;
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  FAIL ${name}\n       ${msg}`);
  }
}

function baseFeatures(
  overrides: Partial<BattleShapeFeatures> = {}
): BattleShapeFeatures {
  return {
    result: "win",
    totalMoves: 40,
    playerBlunders: 0,
    playerMistakes: 0,
    openingAssessment: "good",
    missedMate: false,
    endgameReached: false,
    ...overrides,
  };
}

console.log("\n=== classifyBattle rules ===");

test("rule 1: missed mate while winning -> Iwo Jima", () => {
  const r = classifyBattle(baseFeatures({ missedMate: true }));
  assert.equal(r, BATTLES.iwo_jima);
});

test("rule 2: opening collapse loss -> Pearl Harbor", () => {
  const r = classifyBattle(
    baseFeatures({
      result: "loss",
      evalAtMove10: -450,
      playerBlunders: 2,
      totalMoves: 22,
    })
  );
  assert.equal(r, BATTLES.pearl_harbor);
});

test("rule 3: thrown win loss -> Market Garden", () => {
  const r = classifyBattle(
    baseFeatures({
      result: "loss",
      collapseSwingCp: 500,
      totalMoves: 45,
    })
  );
  assert.equal(r, BATTLES.market_garden);
});

test("rule 4: short comeback win -> Midway", () => {
  const r = classifyBattle(
    baseFeatures({
      result: "win",
      comebackSwingCp: 400,
      totalMoves: 30,
    })
  );
  assert.equal(r, BATTLES.midway);
});

test("rule 4: long comeback win -> Battle of the Bulge", () => {
  const r = classifyBattle(
    baseFeatures({
      result: "win",
      comebackSwingCp: 400,
      totalMoves: 60,
    })
  );
  assert.equal(r, BATTLES.battle_of_the_bulge);
});

test("rule 5: evacuation draw -> Dunkirk", () => {
  const r = classifyBattle(
    baseFeatures({ result: "draw", evalAtMove10: -250 })
  );
  assert.equal(r, BATTLES.dunkirk);
});

test("rule 6: defensive hold draw -> Leningrad", () => {
  const r = classifyBattle(baseFeatures({ result: "draw" }));
  assert.equal(r, BATTLES.leningrad);
});

test("rule 7: fast clean win -> Blitzkrieg", () => {
  const r = classifyBattle(
    baseFeatures({ result: "win", totalMoves: 18, playerBlunders: 0 })
  );
  assert.equal(r, BATTLES.blitzkrieg);
});

test("rule 8: clean endgame win -> El Alamein", () => {
  const r = classifyBattle(
    baseFeatures({
      result: "win",
      totalMoves: 50,
      playerBlunders: 0,
      endgameReached: true,
    })
  );
  assert.equal(r, BATTLES.el_alamein);
});

test("rule 9: grinding endgame win -> Stalingrad", () => {
  const r = classifyBattle(
    baseFeatures({
      result: "win",
      totalMoves: 60,
      playerBlunders: 2,
      endgameReached: true,
    })
  );
  assert.equal(r, BATTLES.stalingrad);
});

test("rule 10: default win -> Fall of Berlin", () => {
  const r = classifyBattle(
    baseFeatures({
      result: "win",
      totalMoves: 30,
      playerBlunders: 1,
      endgameReached: false,
    })
  );
  assert.equal(r, BATTLES.fall_of_berlin);
});

test("rule 11: default loss -> Fall of France", () => {
  const r = classifyBattle(baseFeatures({ result: "loss" }));
  assert.equal(r, BATTLES.fall_of_france);
});

console.log("\n=== coarse-mode fallthrough ===");

test("coarse-mode loss (no eval fields) falls to Fall of France", () => {
  // In coarse mode, evalAtMove10/collapseSwingCp/comebackSwingCp are undefined,
  // so rules 2, 3, 4 cannot fire. A simple loss falls to rule 11.
  const r = classifyBattle(
    baseFeatures({ result: "loss", playerBlunders: 3 })
  );
  assert.equal(r, BATTLES.fall_of_france);
});

test("rule 1 fires before rule 7 (missed mate beats Blitzkrieg)", () => {
  const r = classifyBattle(
    baseFeatures({
      result: "win",
      totalMoves: 18,
      playerBlunders: 0,
      missedMate: true,
    })
  );
  assert.equal(r, BATTLES.iwo_jima);
});

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 2: Run the tests and verify they pass**

Run: `npx tsx scripts/test-battle-allusion.ts`
Expected output ends with `ALL PASS` and exit code 0. Every rule has a green `ok` line.

If any test fails, the classifier logic in Task 1 has a bug — fix `src/lib/battle-allusion.ts` before proceeding. Do not weaken the assertions.

- [ ] **Step 3: Commit**

```bash
git add scripts/test-battle-allusion.ts
git commit -m "test(battle-allusion): add classifier smoke tests"
```

---

## Task 3: `buildFeaturesFromEngineEvals` (rich mode) — TDD

**Files:**
- Modify: `src/lib/battle-allusion.ts`
- Modify: `scripts/test-battle-allusion.ts`

- [ ] **Step 1: Update the top-of-file import to include the new function**

Edit `scripts/test-battle-allusion.ts`. Find the existing import block at the top:

```ts
import {
  classifyBattle,
  BATTLES,
  type BattleShapeFeatures,
} from "../src/lib/battle-allusion";
```

Replace it with:

```ts
import {
  classifyBattle,
  BATTLES,
  buildFeaturesFromEngineEvals,
  type BattleShapeFeatures,
} from "../src/lib/battle-allusion";
```

- [ ] **Step 2: Append the failing tests for the extractor**

Append to `scripts/test-battle-allusion.ts` (above the final `console.log(\`\n${failures ...\`)` line):

```ts
console.log("\n=== buildFeaturesFromEngineEvals ===");

// Minimal shape matching the engineEvals passed around the codebase.
type EvalPos = {
  moveNumber: number;
  color: "w" | "b";
  san: string;
  scoreCp: number;
  mate: number | null;
  bestLine: string[];
  depth: number;
};
type EvalDrop = {
  moveNumber: number;
  color: "w" | "b";
  san: string;
  evalBefore: number;
  evalAfter: number;
  cpLoss: number;
  engineBest: string;
  engineLine: string[];
};

function pos(
  i: number,
  color: "w" | "b",
  scoreCp: number,
  mate: number | null = null
): EvalPos {
  return {
    moveNumber: Math.floor(i / 2) + 1,
    color,
    san: "a1",
    scoreCp,
    mate,
    bestLine: [],
    depth: 14,
  };
}

function drop(
  color: "w" | "b",
  cpLoss: number,
  moveNumber = 15
): EvalDrop {
  return {
    moveNumber,
    color,
    san: "a1",
    evalBefore: 0,
    evalAfter: 0,
    cpLoss,
    engineBest: "",
    engineLine: [],
  };
}

// Build a 40-half-move game where white is the player and starts winning,
// goes to -400 around move 10, recovers to +500 at the end (comeback).
function comebackEvals() {
  const positions: EvalPos[] = [];
  for (let i = 0; i < 40; i++) {
    const color = i % 2 === 0 ? "w" : "b";
    let cp = 0;
    if (i < 10) cp = 50;
    else if (i < 20) cp = -400;
    else if (i < 30) cp = -100;
    else cp = 500;
    positions.push(pos(i, color, cp));
  }
  return { positions, drops: [] as EvalDrop[] };
}

test("extracts totalMoves from positions length", () => {
  const evals = comebackEvals();
  const f = buildFeaturesFromEngineEvals(
    evals,
    "w",
    "win",
    "good",
    true
  );
  assert.equal(f.totalMoves, 40);
});

test("extracts evalAtMove10 from position index 19 (player perspective)", () => {
  const evals = comebackEvals();
  const f = buildFeaturesFromEngineEvals(
    evals,
    "w",
    "win",
    "good",
    true
  );
  // White at index 19: positions[19].scoreCp === -400, already white POV.
  assert.equal(f.evalAtMove10, -400);
});

test("evalAtMove10 is negated for black player", () => {
  const evals = comebackEvals();
  const f = buildFeaturesFromEngineEvals(
    evals,
    "b",
    "loss",
    "good",
    true
  );
  assert.equal(f.evalAtMove10, 400);
});

test("comebackSwingCp detects recovered deficit", () => {
  const evals = comebackEvals();
  const f = buildFeaturesFromEngineEvals(
    evals,
    "w",
    "win",
    "good",
    true
  );
  // Running min was -400 (white POV), final is +500 >= 0 -> comeback = 400.
  assert(
    f.comebackSwingCp !== undefined && f.comebackSwingCp >= 400,
    `expected comebackSwingCp >= 400, got ${f.comebackSwingCp}`
  );
  assert.equal(f.collapseSwingCp, undefined);
});

test("collapseSwingCp detects lost advantage", () => {
  // Game where white peaks at +600 then drops to -400 (loss).
  const positions: EvalPos[] = [];
  for (let i = 0; i < 30; i++) {
    const color = i % 2 === 0 ? "w" : "b";
    let cp = 0;
    if (i < 10) cp = 200;
    else if (i < 20) cp = 600;
    else cp = -400;
    positions.push(pos(i, color, cp));
  }
  const f = buildFeaturesFromEngineEvals(
    { positions, drops: [] },
    "w",
    "loss",
    "good",
    false
  );
  assert(
    f.collapseSwingCp !== undefined && f.collapseSwingCp >= 600,
    `expected collapseSwingCp >= 600, got ${f.collapseSwingCp}`
  );
  assert.equal(f.comebackSwingCp, undefined);
});

test("counts player and opponent blunders from drops", () => {
  const evals = {
    positions: comebackEvals().positions,
    drops: [
      drop("w", 250), // player blunder (>=200)
      drop("w", 150), // player mistake (100-199)
      drop("b", 300), // opponent blunder
      drop("b", 80), // below mistake threshold
    ],
  };
  const f = buildFeaturesFromEngineEvals(
    evals,
    "w",
    "win",
    "good",
    true
  );
  assert.equal(f.playerBlunders, 1);
  assert.equal(f.playerMistakes, 1);
  assert.equal(f.opponentBlunders, 1);
});

test("mate scores are clamped so swings don't exceed 1000cp", () => {
  // Game with a mate score in the middle. Even though the engine reports
  // "mate in 2", the clamped normalized value is ±1000, not ±10000. This
  // prevents a single mate score from saturating the comeback/collapse
  // detectors at unrealistic magnitudes.
  const positions: EvalPos[] = [];
  for (let i = 0; i < 20; i++) {
    const color = i % 2 === 0 ? "w" : "b";
    if (i === 10) {
      // Engine shows mate in 2 for white at this point.
      positions.push(pos(i, color, 0, 2));
    } else if (i < 10) {
      positions.push(pos(i, color, -300));
    } else {
      positions.push(pos(i, color, 400));
    }
  }
  const f = buildFeaturesFromEngineEvals(
    { positions, drops: [] },
    "w",
    "win",
    "good",
    false
  );
  // White recovered from -300 (not clamped) to a win. comebackSwingCp = 300,
  // NOT 10000 (which would be the unclamped mate magnitude).
  assert(
    f.comebackSwingCp !== undefined && f.comebackSwingCp <= 1000,
    `expected comebackSwingCp clamped to <= 1000, got ${f.comebackSwingCp}`
  );
});
```

- [ ] **Step 3: Run tests and confirm they fail**

Run: `npx tsx scripts/test-battle-allusion.ts`
Expected: the classifier tests still pass, but every `buildFeaturesFromEngineEvals` test fails with `TypeError: buildFeaturesFromEngineEvals is not a function` (or similar) because the import resolves to `undefined`. The script exits with a non-zero code.

- [ ] **Step 4: Implement `buildFeaturesFromEngineEvals`**

Append to `src/lib/battle-allusion.ts`:

```ts
// --- Feature extraction (rich mode) ---

type EnginePos = {
  moveNumber: number;
  color: "w" | "b";
  scoreCp: number;
  mate: number | null;
};
type EngineDrop = {
  color: "w" | "b";
  cpLoss: number;
};

interface EngineEvalsLike {
  positions: EnginePos[];
  drops: EngineDrop[];
}

/**
 * Convert a raw engine score (with optional mate) to a signed centipawn
 * value from WHITE's perspective, clamped to ±1000 so mate scores don't
 * distort running min/max calculations.
 */
function normalizedScoreWhitePov(pos: EnginePos): number {
  if (pos.mate !== null) {
    // mate > 0 means the side to move is mating; mate < 0 means being mated.
    // By convention in this codebase, positive mate on white's move = white
    // mates. We clamp to ±1000 to avoid distorting swings.
    const sign = pos.mate > 0 ? 1 : pos.mate < 0 ? -1 : 0;
    return sign * 1000;
  }
  return pos.scoreCp;
}

/**
 * Extract BattleShapeFeatures from a full engine analysis. Called from
 * batch-analyze and the runtime Claude path — both have engineEvals.
 */
export function buildFeaturesFromEngineEvals(
  evals: EngineEvalsLike,
  playerColor: "w" | "b",
  result: "win" | "loss" | "draw",
  openingAssessment: "good" | "inaccurate" | "dubious",
  endgameReached: boolean,
  opts: { missedMate?: boolean } = {}
): BattleShapeFeatures {
  const positions = evals.positions;
  const totalMoves = positions.length;

  // evalAtMove10: position after both sides' 10th move = index 19.
  // Normalize to player's perspective.
  let evalAtMove10: number | undefined;
  if (positions.length > 19) {
    const raw = normalizedScoreWhitePov(positions[19]);
    evalAtMove10 = playerColor === "w" ? raw : -raw;
  }

  // Walk positions tracking running min/max from the player's perspective.
  // comebackSwingCp: deepest deficit that was later recovered to >= 0.
  // collapseSwingCp: peak advantage that was later lost to <= 0.
  let runningMin = Infinity;
  let runningMax = -Infinity;
  let finalEval = 0;
  for (const p of positions) {
    const whitePov = normalizedScoreWhitePov(p);
    const playerPov = playerColor === "w" ? whitePov : -whitePov;
    if (playerPov < runningMin) runningMin = playerPov;
    if (playerPov > runningMax) runningMax = playerPov;
    finalEval = playerPov;
  }

  let comebackSwingCp: number | undefined;
  if (runningMin < 0 && finalEval >= 0) {
    comebackSwingCp = -runningMin;
  }

  let collapseSwingCp: number | undefined;
  if (runningMax > 0 && finalEval <= 0) {
    collapseSwingCp = runningMax;
  }

  // Count drops by color and severity.
  // Threshold: >=200cp = blunder, 100..199cp = mistake.
  const opponentColor = playerColor === "w" ? "b" : "w";
  let playerBlunders = 0;
  let playerMistakes = 0;
  let opponentBlunders = 0;
  for (const d of evals.drops) {
    if (d.color === playerColor) {
      if (d.cpLoss >= 200) playerBlunders++;
      else if (d.cpLoss >= 100) playerMistakes++;
    } else if (d.color === opponentColor) {
      if (d.cpLoss >= 200) opponentBlunders++;
    }
  }

  return {
    result,
    totalMoves,
    playerBlunders,
    playerMistakes,
    openingAssessment,
    missedMate: opts.missedMate ?? false,
    endgameReached,
    opponentBlunders,
    comebackSwingCp,
    collapseSwingCp,
    evalAtMove10,
  };
}
```

- [ ] **Step 5: Run tests and confirm they pass**

Run: `npx tsx scripts/test-battle-allusion.ts`
Expected: all tests (rules + extractor) end with `ALL PASS`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/battle-allusion.ts scripts/test-battle-allusion.ts
git commit -m "feat(battle-allusion): add rich-mode feature extractor with tests"
```

---

## Task 4: `buildFeaturesFromAnalysisResult` (coarse mode) — TDD

**Files:**
- Modify: `src/lib/battle-allusion.ts`
- Modify: `scripts/test-battle-allusion.ts`

- [ ] **Step 1: Update the imports at the top of the test script**

Edit `scripts/test-battle-allusion.ts`. The existing import from `../src/lib/battle-allusion` (already containing `classifyBattle`, `BATTLES`, `buildFeaturesFromEngineEvals`, and `BattleShapeFeatures` after Task 3) should be extended to add `buildFeaturesFromAnalysisResult`. Also add a new import for the `AnalysisResult` type from `../src/lib/types`.

After this step the import block at the top of the file should read:

```ts
import { strict as assert } from "node:assert";
import {
  classifyBattle,
  BATTLES,
  buildFeaturesFromEngineEvals,
  buildFeaturesFromAnalysisResult,
  type BattleShapeFeatures,
} from "../src/lib/battle-allusion";
import type { AnalysisResult } from "../src/lib/types";
```

- [ ] **Step 2: Append the failing tests**

Append to `scripts/test-battle-allusion.ts` above the final `console.log` summary line:

```ts
console.log("\n=== buildFeaturesFromAnalysisResult ===");

// Minimal PGN with 40 half-moves, standard headers.
const SAMPLE_PGN = `[Event "Test"]
[Site "?"]
[Date "2026.04.09"]
[Round "?"]
[White "Player"]
[Black "Opponent"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Nb8 10. d4 Nbd7 11. c4 c6 12. cxb5 axb5 13. Nc3 Bb7 14. Bg5 b4 15. Nb1 h6 16. Bh4 c5 17. dxe5 Nxe4 18. Bxe7 Qxe7 19. exd6 Qf6 20. Nbd2 Nxd6 1-0`;

function sampleAnalysis(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    opening: { name: "Ruy Lopez", assessment: "good", comment: "" },
    criticalMoments: [],
    positionalThemes: "",
    endgame: { reached: true, comment: "" },
    summary: { overallAssessment: "", focusArea: "" },
    ...overrides,
  };
}

test("extracts totalMoves from PGN", () => {
  const f = buildFeaturesFromAnalysisResult(sampleAnalysis(), SAMPLE_PGN, "win");
  assert.equal(f.totalMoves, 40);
});

test("counts blunders and mistakes from criticalMoments", () => {
  const analysis = sampleAnalysis({
    criticalMoments: [
      { moveNumber: 10, move: "e4", type: "blunder", comment: "", suggestion: "" },
      { moveNumber: 15, move: "Nf3", type: "blunder", comment: "", suggestion: "" },
      { moveNumber: 20, move: "d4", type: "mistake", comment: "", suggestion: "" },
      { moveNumber: 25, move: "f4", type: "excellent", comment: "", suggestion: "" },
    ],
  });
  const f = buildFeaturesFromAnalysisResult(analysis, SAMPLE_PGN, "loss");
  assert.equal(f.playerBlunders, 2);
  assert.equal(f.playerMistakes, 1);
});

test("detects missedMate from analysis.missedMatesInOne", () => {
  const analysis = sampleAnalysis({
    missedMatesInOne: [
      { moveNumber: 18, color: "w", playedSan: "Qf3", mateSan: "Qxf7#" },
    ],
  });
  const f = buildFeaturesFromAnalysisResult(analysis, SAMPLE_PGN, "win");
  assert.equal(f.missedMate, true);
});

test("missedMate is false when field absent", () => {
  const f = buildFeaturesFromAnalysisResult(sampleAnalysis(), SAMPLE_PGN, "win");
  assert.equal(f.missedMate, false);
});

test("coarse mode leaves rich fields undefined", () => {
  const f = buildFeaturesFromAnalysisResult(sampleAnalysis(), SAMPLE_PGN, "win");
  assert.equal(f.opponentBlunders, undefined);
  assert.equal(f.comebackSwingCp, undefined);
  assert.equal(f.collapseSwingCp, undefined);
  assert.equal(f.evalAtMove10, undefined);
});
```

- [ ] **Step 3: Run tests, confirm failure**

Run: `npx tsx scripts/test-battle-allusion.ts`
Expected: classifier + rich-mode tests still pass, but every `buildFeaturesFromAnalysisResult` test fails with `TypeError: buildFeaturesFromAnalysisResult is not a function`. Non-zero exit code.

- [ ] **Step 4: Add imports to the top of `src/lib/battle-allusion.ts`**

Edit the top of `src/lib/battle-allusion.ts`. The file currently imports only `BattleAllusion` from `./types`. Extend it and add a new import for `getAllMoves`:

```ts
import { BattleAllusion, AnalysisResult } from "./types";
import { getAllMoves } from "./chess-utils";
```

- [ ] **Step 5: Append `buildFeaturesFromAnalysisResult` to the bottom of `src/lib/battle-allusion.ts`**

```ts
// --- Feature extraction (coarse mode, for backfill) ---

/**
 * Extract BattleShapeFeatures from an existing cached AnalysisResult + the
 * original PGN. Used by the backfill script — the rich eval trajectory is
 * not available at backfill time, so comebackSwingCp/collapseSwingCp/
 * evalAtMove10/opponentBlunders are intentionally left undefined and the
 * classifier skips rules that require them.
 */
export function buildFeaturesFromAnalysisResult(
  analysis: AnalysisResult,
  pgn: string,
  result: "win" | "loss" | "draw"
): BattleShapeFeatures {
  const moves = getAllMoves(pgn);
  const totalMoves = moves.length;

  let playerBlunders = 0;
  let playerMistakes = 0;
  for (const cm of analysis.criticalMoments) {
    if (cm.type === "blunder") playerBlunders++;
    else if (cm.type === "mistake") playerMistakes++;
  }

  const missedMate = (analysis.missedMatesInOne?.length ?? 0) > 0;

  return {
    result,
    totalMoves,
    playerBlunders,
    playerMistakes,
    openingAssessment: analysis.opening.assessment,
    missedMate,
    endgameReached: analysis.endgame.reached,
    // Rich-mode fields intentionally undefined.
  };
}
```

- [ ] **Step 6: Run tests and verify they pass**

Run: `npx tsx scripts/test-battle-allusion.ts`
Expected: all tests pass including the new coarse-mode section.

- [ ] **Step 7: Verify the build still passes**

Run: `npm run build`
Expected: `✓ Compiled successfully`, no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/battle-allusion.ts scripts/test-battle-allusion.ts
git commit -m "feat(battle-allusion): add coarse-mode feature extractor with tests"
```

---

## Task 5: Wire classifier into `batch-analyze.ts`

**Files:**
- Modify: `scripts/batch-analyze.ts`

- [ ] **Step 1: Add the import and update the local `AnalysisResult` interface**

Edit `scripts/batch-analyze.ts`. Near the top of the file (after the existing `import { Chess } from "chess.js";` line), add:

```ts
import {
  classifyBattle,
  buildFeaturesFromEngineEvals,
  type BattleAllusion,
} from "../src/lib/battle-allusion";
```

Then find the local `AnalysisResult` interface (currently around lines 43-50) and extend its `summary` field to include the optional `battleAllusion`. Make a **targeted edit** — change only the `summary:` line. The full post-edit interface should read:

```ts
interface AnalysisResult {
  opening: { name: string; assessment: "good" | "inaccurate" | "dubious"; comment: string; };
  criticalMoments: Array<{ moveNumber: number; move: string; type: "blunder" | "mistake" | "excellent" | "missed_tactic"; comment: string; suggestion: string; }>;
  positionalThemes: string;
  endgame: { reached: boolean; comment: string; };
  summary: { overallAssessment: string; focusArea: string; battleAllusion?: BattleAllusion; };
  missedMatesInOne?: Array<{ moveNumber: number; color: "w" | "b"; playedSan: string; mateSan: string; }>;
}
```

If the current file has any fields that differ from what's shown above (e.g. extra fields added since this plan was written), preserve them exactly — only the `summary` line changes.

- [ ] **Step 2: Compute the battle allusion in `generateAnalysis`**

Find the `return { analysis: { ... } }` at the bottom of `generateAnalysis` (around line 482). Immediately before the `return` statement, add:

```ts
  // Compute battle allusion deterministically from engine evals.
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
```

Then update the returned object so `summary` includes the new field:

```ts
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
```

- [ ] **Step 3: Verify the build passes**

Run: `npm run build`
Expected: `✓ Compiled successfully`. Turbopack should not complain.

- [ ] **Step 4: Dry-run the script on a single day**

Run: `npx dotenv-cli -e .env.local -- npx tsx scripts/batch-analyze.ts --force-days 1`
Expected: Stockfish initializes, a handful of recent games are re-analyzed, and the log lines show normal output. The cached `AnalysisResult` blobs in Redis now have a `summary.battleAllusion` field. You don't need to assert against Redis here — the smoke test covers the classifier and Task 9 does the end-to-end verification.

- [ ] **Step 5: Commit**

```bash
git add scripts/batch-analyze.ts
git commit -m "feat(batch-analyze): attach battle allusion to generated analyses"
```

---

## Task 6: Wire classifier into the runtime Claude path

**Files:**
- Modify: `src/lib/claude.ts`

The Claude prompt is NOT changed. The classifier runs server-side after the JSON is parsed, so the battle name is deterministic and can never be hallucinated.

- [ ] **Step 1: Add the import**

Edit `src/lib/claude.ts`. Near the existing imports (around line 1-8), add:

```ts
import {
  classifyBattle,
  buildFeaturesFromEngineEvals,
} from "./battle-allusion";
```

- [ ] **Step 2: Add a PGN result parser helper**

Immediately after the existing `extractJson` function (around line 119), add:

```ts
/** Derive win/loss/draw from the PGN [Result] tag relative to the player's color. */
function deriveResultFromPgn(
  pgn: string,
  playerColor: "w" | "b"
): "win" | "loss" | "draw" | null {
  const match = pgn.match(/\[Result\s+"([^"]+)"\]/);
  if (!match) return null;
  const tag = match[1];
  if (tag === "1/2-1/2") return "draw";
  if (tag === "1-0") return playerColor === "w" ? "win" : "loss";
  if (tag === "0-1") return playerColor === "b" ? "win" : "loss";
  return null;
}
```

- [ ] **Step 3: Attach the battle allusion after JSON parse**

Find the end of `analyzeGame(...)` — specifically the post-processing loop that filters/validates `criticalMoments` (ends around line 183 with `return result;`).

Immediately before `return result;`, add:

```ts
  // Compute battle allusion deterministically (server-side, prompt untouched).
  if (engineEvals) {
    const playerColorChar: "w" | "b" = color === "white" ? "w" : "b";
    const gameResult = deriveResultFromPgn(pgn, playerColorChar);
    if (gameResult) {
      const missedMate = (result.missedMatesInOne?.length ?? 0) > 0;
      result.summary.battleAllusion = classifyBattle(
        buildFeaturesFromEngineEvals(
          engineEvals,
          playerColorChar,
          gameResult,
          result.opening.assessment,
          result.endgame.reached,
          { missedMate }
        )
      );
    }
  }
```

- [ ] **Step 4: Verify the build passes**

Run: `npm run build`
Expected: `✓ Compiled successfully`, TypeScript clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/claude.ts
git commit -m "feat(claude): attach battle allusion server-side after JSON parse"
```

---

## Task 7: Render the battle card in the analysis view

**Files:**
- Modify: `src/components/analysis-view.tsx`

- [ ] **Step 1: Add the conditional card below the focus area**

Edit `src/components/analysis-view.tsx`. Find the SUMMARY card (around lines 117-128) — specifically the closing `</div>` of the `rounded-xl bg-surface-card p-4` wrapper that contains `overallAssessment` and `focusArea`.

Immediately before that closing `</div>` (i.e. after the focus-area sub-box on line 127), add:

```tsx
        {analysis.summary.battleAllusion && (
          <div className="mt-3 rounded-lg border-l-2 border-accent-yellow bg-surface-elevated/60 px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-accent-yellow">
              This game was like…
            </span>
            <p className="mt-1 text-sm font-semibold text-gray-100">
              {analysis.summary.battleAllusion.battleName}
              <span className="ml-2 text-xs font-normal text-gray-400">
                ({analysis.summary.battleAllusion.subtitle})
              </span>
            </p>
            <p className="mt-1 text-xs italic text-gray-300">
              {analysis.summary.battleAllusion.flavor}
            </p>
          </div>
        )}
```

- [ ] **Step 2: Verify the build passes**

Run: `npm run build`
Expected: `✓ Compiled successfully`.

- [ ] **Step 3: Manual visual check**

Start the dev server: `npm run dev`
Open `http://localhost:3000/analysis/castledoon` (or whichever player you used for the batch-analyze dry-run in Task 5.4). Click into a recent game that was re-analyzed. Confirm the "This game was like..." card appears below the focus area with a battle name, subtitle, and flavor line.

If Task 5 has NOT been run on recent games yet, most cached analyses won't have the field — that's expected; the card gracefully hides. Pick a game you re-analyzed in step 5.4 or wait until Task 9 runs the backfill.

Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add src/components/analysis-view.tsx
git commit -m "feat(ui): render battle allusion card in game summary"
```

---

## Task 8: Backfill script for existing cached analyses

**Files:**
- Create: `scripts/backfill-battle-allusions.ts`

- [ ] **Step 1: Create the backfill script**

Create `scripts/backfill-battle-allusions.ts` with this exact content:

```ts
/**
 * One-shot backfill: add battleAllusion to existing cached analyses in Redis.
 *
 * Usage:
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/backfill-battle-allusions.ts [--dry-run]
 *
 * The script is idempotent: analyses that already have battleAllusion are skipped.
 * Because this runs outside a browser context, it talks to Chess.com directly
 * to list archives/games (same pattern the meta-API fix uses) rather than
 * relying on the 5-minute-TTL Redis archive caches.
 */

import { Redis } from "@upstash/redis";
import { createHash } from "crypto";
import {
  classifyBattle,
  buildFeaturesFromAnalysisResult,
} from "../src/lib/battle-allusion";
import type { AnalysisResult } from "../src/lib/types";

const USERS = ["castledoon", "exstrax"];
const MONTHS = 3;
const ANALYSIS_TTL = 90 * 24 * 60 * 60;
const CHESS_COM = "https://api.chess.com/pub";
const HEADERS = {
  "User-Agent": "ChessCoach/1.0 (backfill)",
  Accept: "application/json",
};

const DRY_RUN = process.argv.includes("--dry-run");

interface ChessComGame {
  url: string;
  pgn: string;
  end_time: number;
  white: { username: string; result: string };
  black: { username: string; result: string };
}

function analysisCacheKey(pgn: string): string {
  const moves = pgn.replace(/\[.*?\]\s*/g, "").replace(/\s+/g, " ").trim();
  const hash = createHash("sha256").update(moves).digest("hex").slice(0, 16);
  return `analysis:${hash}`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return res.json() as Promise<T>;
}

function getPlayerOutcome(
  game: ChessComGame,
  username: string
): "win" | "loss" | "draw" {
  const isWhite = game.white.username.toLowerCase() === username.toLowerCase();
  const result = (isWhite ? game.white : game.black).result;
  if (result === "win") return "win";
  if (
    ["stalemate", "insufficient", "repetition", "agreed", "50move", "timevsinsufficient"].includes(result)
  ) {
    return "draw";
  }
  return "loss";
}

async function main() {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    console.error("Missing Redis env vars KV_REST_API_URL / KV_REST_API_TOKEN");
    process.exit(1);
  }
  const redis = new Redis({ url, token });

  let totalProcessed = 0;
  let totalAdded = 0;
  let totalSkipped = 0;
  let totalMissing = 0;

  for (const username of USERS) {
    console.log(`\n=== ${username} ===`);

    // List archives directly from Chess.com (not Redis — the 5-min TTL
    // means the cached list is often stale).
    const { archives } = await fetchJson<{ archives: string[] }>(
      `${CHESS_COM}/player/${username}/games/archives`
    );
    const recent = archives.slice(-MONTHS);

    // Collect all games from the recent window.
    const allGames: ChessComGame[] = [];
    for (const archiveUrl of recent) {
      const { games } = await fetchJson<{ games: ChessComGame[] }>(archiveUrl);
      for (const g of games) if (g.pgn) allGames.push(g);
    }
    allGames.sort((a, b) => b.end_time - a.end_time);
    console.log(`  Loaded ${allGames.length} games from Chess.com`);

    for (let i = 0; i < allGames.length; i++) {
      const game = allGames[i];
      const key = analysisCacheKey(game.pgn);
      const analysis = await redis.get<AnalysisResult>(key);
      totalProcessed++;

      if (!analysis) {
        totalMissing++;
        continue;
      }
      if (analysis.summary.battleAllusion) {
        totalSkipped++;
        continue;
      }

      const gameResult = getPlayerOutcome(game, username);
      const features = buildFeaturesFromAnalysisResult(
        analysis,
        game.pgn,
        gameResult
      );
      const battleAllusion = classifyBattle(features);

      const opponent =
        game.white.username.toLowerCase() === username.toLowerCase()
          ? game.black.username
          : game.white.username;
      const date = new Date(game.end_time * 1000).toISOString().slice(0, 10);

      console.log(
        `  [${i + 1}/${allGames.length}] ${username} vs ${opponent} (${date}): ${battleAllusion.battleName}${DRY_RUN ? " [dry-run]" : ""}`
      );

      if (!DRY_RUN) {
        analysis.summary.battleAllusion = battleAllusion;
        await redis.set(key, analysis, { ex: ANALYSIS_TTL });
      }
      totalAdded++;
    }
  }

  console.log(
    `\nDone. Processed ${totalProcessed} game records: ${totalAdded} battles added${DRY_RUN ? " (dry-run)" : ""}, ${totalSkipped} already present, ${totalMissing} missing analyses.`
  );

  process.exit(0);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Verify the build (Turbopack doesn't typecheck scripts/ by default, but tsc via next does)**

Run: `npm run build`
Expected: `✓ Compiled successfully`. If tsc complains about unused `Chess` import, the `void Chess` line at the bottom handles it; if it still complains, remove the `Chess` import and the `void Chess` line.

- [ ] **Step 3: Dry-run the backfill**

Run: `npx dotenv-cli -e .env.local -- npx tsx scripts/backfill-battle-allusions.ts --dry-run`
Expected output: lines like `[1/91] castledoon vs OldGimmick (2026-04-06): Fall of France [dry-run]` for every cached game. Final summary: something like `Processed 197 game records: 197 battles added (dry-run), 0 already present, 0 missing analyses.`

Inspect the distribution across battles — most wins will be Fall of Berlin (rule 10 default) and most losses will be Fall of France (rule 11 default) because coarse mode can't fire the eval-trajectory rules. That's expected per the spec.

- [ ] **Step 4: Commit**

```bash
git add scripts/backfill-battle-allusions.ts
git commit -m "feat(backfill): add script to attach battle allusion to existing analyses"
```

---

## Task 9: Run the real backfill and end-to-end verification

**Files:** none (runtime operations only)

- [ ] **Step 1: Run the backfill for real**

Run: `npx dotenv-cli -e .env.local -- npx tsx scripts/backfill-battle-allusions.ts`
Expected: same output as the dry-run but without `[dry-run]` suffixes, and without "already present" skips (first run).

- [ ] **Step 2: Spot-check one analysis in Redis**

Run this inline Node one-liner (adjust the username if needed):

```bash
npx dotenv-cli -e .env.local -- node -e "
const { Redis } = require('@upstash/redis');
const { createHash } = require('crypto');
(async () => {
  const r = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
  // Pick any cached analysis key by scanning a small batch.
  const keys = await r.keys('analysis:*');
  if (keys.length === 0) { console.log('no analysis keys found'); return; }
  const sample = await r.get(keys[0]);
  console.log('key:', keys[0]);
  console.log('battleAllusion:', JSON.stringify(sample.summary.battleAllusion, null, 2));
})();
"
```

Expected: the sampled analysis has a `battleAllusion` object with `battleName`, `subtitle`, and `flavor` populated.

- [ ] **Step 3: Visual check in the browser**

Run: `npm run dev`
Open `http://localhost:3000/analysis/castledoon`. Click into several different games — ideally a short win, a loss, and a draw — and confirm the "This game was like…" card appears below the focus area for each one. Different games should show different battle names (especially across wins vs losses vs draws).

Stop the dev server.

- [ ] **Step 4: Re-run the smoke tests one last time**

Run: `npx tsx scripts/test-battle-allusion.ts`
Expected: `ALL PASS`.

- [ ] **Step 5: Run the final production build**

Run: `npm run build`
Expected: `✓ Compiled successfully`, all routes generated.

- [ ] **Step 6: Idempotency check — re-run the backfill**

Run: `npx dotenv-cli -e .env.local -- npx tsx scripts/backfill-battle-allusions.ts`
Expected: every game reports "already present" and `0 battles added`. This proves the `if (analysis.summary.battleAllusion)` skip guard works.

- [ ] **Step 7: Commit (if anything was modified)**

If Task 9 resulted in any file changes (unlikely — it's verification only), commit them. Otherwise skip.

- [ ] **Step 8: Push to origin/main**

```bash
eval "$(ssh-agent -s)" && ssh-add ~/.ssh/id_ed25519
git push origin main
```

Expected: successful push; Vercel auto-deploys.

---

## Post-implementation notes for the engineer

- **If a battle's flavor line reads poorly in practice:** edit `BATTLES` in `src/lib/battle-allusion.ts`, re-run the backfill (it will skip analyses already populated — either delete the `battleAllusion` field from cached values first or force re-classification by extending the backfill script with a `--force` flag).
- **If rule 10/11 dominate too heavily in coarse mode:** that's expected until users accumulate new analyses via the live paths. Don't widen the coarse rules — adding rules that require data we don't have creates silent bugs.
- **If the Claude runtime path is invoked without `engineEvals`:** the battle allusion is silently omitted and the UI card hides. This is acceptable degradation.
- **Do not modify `SYSTEM_PROMPT` in `src/lib/claude.ts` to mention battles.** The spec is explicit about this.
