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
