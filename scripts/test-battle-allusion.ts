/**
 * Smoke tests for battle-allusion classifier and feature extractors.
 * Run: npx tsx scripts/test-battle-allusion.ts
 * Exits with code 1 if any assertion fails.
 */

import { strict as assert } from "node:assert";
import {
  classifyBattle,
  BATTLES,
  buildFeaturesFromEngineEvals,
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

test("mate positions are ignored by the swing detector", () => {
  // A mate score in the middle of the game should not distort the running
  // min/max. The extractor reads only scoreCp (white-POV) and ignores mate
  // sign semantics entirely. Here: white recovers from -300 to +400 with
  // a mate-in-2 marker at index 10 (scoreCp=0). The comeback value should
  // reflect the scoreCp trajectory, unaffected by the mate score.
  const positions: EvalPos[] = [];
  for (let i = 0; i < 20; i++) {
    const color = i % 2 === 0 ? "w" : "b";
    if (i === 10) {
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
  // Running min was -300, final eval is 400, so comebackSwingCp = 300.
  assert.equal(f.comebackSwingCp, 300);
  assert.equal(f.collapseSwingCp, undefined);
});

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
