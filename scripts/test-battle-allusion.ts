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
