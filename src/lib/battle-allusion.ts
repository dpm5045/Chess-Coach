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
 *
 * Note: `playerMistakes` and `openingAssessment` are populated by callers
 * but not yet read by any rule in classifyBattle. They are reserved for
 * future rules (e.g. a "weak opening -> Maginot Line" rule) and kept in
 * the struct so extending the classifier doesn't require plumbing new
 * fields through every caller.
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
  evalAtMove10?: number;      // signed centipawn value after both sides'
                              // 10th move, from player's perspective.
                              // Negative = player was already losing;
                              // positive = player was already winning.
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
