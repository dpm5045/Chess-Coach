# WW2 Battle Allusion in Game Summary — Design

**Date:** 2026-04-09
**Status:** Approved, ready for implementation plan

## Problem

Game summaries today are purely instructional (coaching assessment + focus area). The user wants a small fun element: every analyzed game should be compared to a real WW2 battle whose shape mirrors the chess game's shape. The allusion should feel earned — a quick crushing win should not map to the same battle as a long grinding endgame.

## Goals

- Every analyzed game has a battle allusion attached to its summary.
- Same game always resolves to the same battle (deterministic — no random element).
- Zero incremental API cost — no extra Claude tokens, no Stockfish re-runs.
- Works through both analysis paths (batch-analyze script, runtime Claude API) via one shared module.
- Backfills cleanly over the ~200 already-cached analyses in Redis.
- Tone stays tactical/strategic; no editorial commentary on human cost.

## Non-goals

- No new API endpoints.
- No changes to the meta-analysis page.
- No user-facing toggle or preference.
- No linking battles to specific chess openings.
- No seasonal/rotating catalog.
- No modification of Claude's system prompt — classification is server-side and deterministic so Claude cannot hallucinate battle names.

## Architecture

One shared classifier module, three integration points, one backfill script.

```
                 ┌─────────────────────────┐
                 │  src/lib/battle-allusion.ts
                 │  ─ BATTLES catalog       │
                 │  ─ classifyBattle(...)   │
                 │  ─ buildFeatures*(...)   │
                 └─┬─────────┬─────────┬────┘
                   │         │         │
         ┌─────────┘         │         └──────────┐
         ▼                   ▼                    ▼
 scripts/batch-analyze.ts   src/lib/claude.ts    scripts/backfill-
 (rich features from        analyzeGame(...)    battle-allusions.ts
 engineEvals)               (rich features      (coarse features
                            from engineEvals)    from AnalysisResult
                                                 + PGN)
```

All three callers converge on the same `classifyBattle(features)` function. A change to a rule or flavor line is a one-file edit.

## Data model

### Type additions (`src/lib/types.ts`)

```ts
export interface BattleAllusion {
  battleName: string;   // e.g. "Blitzkrieg"
  subtitle: string;     // e.g. "Poland, 1939"
  flavor: string;       // prewritten 1-sentence description
}

export interface AnalysisResult {
  // ...existing fields unchanged
  summary: {
    overallAssessment: string;
    focusArea: string;
    battleAllusion?: BattleAllusion;  // optional — pre-feature analyses still deserialize
  };
  missedMatesInOne?: MissedMateInOne[];
}
```

The field is **optional** so previously-cached analyses (before the backfill runs) deserialize without error. The UI hides the card when absent.

### `BattleShapeFeatures` (internal to `battle-allusion.ts`)

```ts
interface BattleShapeFeatures {
  result: "win" | "loss" | "draw";
  totalMoves: number;
  playerBlunders: number;
  playerMistakes: number;

  // Rich-mode only (absent in backfill path):
  opponentBlunders?: number;
  comebackSwingCp?: number;   // deepest deficit (in cp, positive number) from player's
                              // perspective that was later recovered to at least 0.
                              // Used for comeback detection (rule 4).
  collapseSwingCp?: number;   // peak advantage (in cp, positive number) from player's
                              // perspective that was later lost to at least 0.
                              // Used for thrown-win detection (rule 3).
  evalAtMove10?: number;      // centipawn eval after both sides' 10th move, from
                              // player's perspective (negative = player is losing).

  // Always available:
  openingAssessment: "good" | "inaccurate" | "dubious";
  missedMate: boolean;
  endgameReached: boolean;
}
```

Rich mode (batch-analyze + Claude paths) populates every field. Coarse mode (backfill) populates only the non-optional fields. The classifier degrades gracefully: rules that require optional fields are skipped when those fields are undefined.

## Catalog

12 battles spanning Eastern/Western/Pacific theaters. Each has a dedicated shape bucket. Tone stays tactical/strategic.

| id | battleName | subtitle | flavor |
|---|---|---|---|
| `blitzkrieg` | Blitzkrieg | Poland, 1939 | Overwhelming force, minimal resistance, victory in a handful of moves. |
| `fall_of_berlin` | Fall of Berlin | Germany, 1945 | The outcome was never in doubt — only the march to finish it. |
| `battle_of_the_bulge` | Battle of the Bulge | Ardennes, 1944 | Caught cold in a losing position, you regrouped and counter-attacked to flip the result. |
| `midway` | Midway | Pacific, 1942 | An inferior position turned decisive in a handful of pivotal moves. |
| `stalingrad` | Stalingrad | Eastern Front, 1942–43 | Long, attritional, and decided by who made fewer mistakes over the final stretch. |
| `el_alamein` | El Alamein | North Africa, 1942 | A positional squeeze with no tactical fireworks — technique won it. |
| `iwo_jima` | Iwo Jima | Pacific, 1945 | You won, but you left forced mates on the board that should have ended things sooner. |
| `leningrad` | Siege of Leningrad | Eastern Front, 1941–44 | Under pressure the entire game, you never broke, and the position held. |
| `dunkirk` | Dunkirk | English Channel, 1940 | A losing position that you scrambled to save — not pretty, but the damage was contained. |
| `pearl_harbor` | Pearl Harbor | Hawaii, 1941 | Caught unprepared in the opening — the damage was done before the middlegame began. |
| `market_garden` | Operation Market Garden | Netherlands, 1944 | A winning plan unraveled one bridge too far — a decisive advantage slipped away. |
| `fall_of_france` | Fall of France | Western Front, 1940 | Outmaneuvered from early on, and every attempt to regroup only delayed the inevitable. |

## Classification rules

Evaluated in order. **First match wins.** A rule whose required feature is undefined (e.g. `maxEvalSwingCp` in coarse mode) is skipped.

1. `missedMate && result === "win"` → **Iwo Jima**
2. `result === "loss" && evalAtMove10 < -300 && playerBlunders >= 1 && totalMoves <= 25` → **Pearl Harbor**
3. `result === "loss" && collapseSwingCp >= 300` → **Operation Market Garden** *(you were winning, then lost)*
4. `result === "win" && comebackSwingCp >= 300` → if `totalMoves < 35` then **Midway**, else **Battle of the Bulge** *(you were losing, then won)*
5. `result === "draw" && evalAtMove10 < -150` → **Dunkirk**
6. `result === "draw"` → **Siege of Leningrad**
7. `result === "win" && totalMoves <= 20 && playerBlunders === 0` → **Blitzkrieg**
8. `result === "win" && playerBlunders === 0 && endgameReached` → **El Alamein**
9. `result === "win" && endgameReached` → **Stalingrad**
10. `result === "win"` → **Fall of Berlin** *(default win)*
11. `result === "loss"` → **Fall of France** *(default loss)*

Because every rule is structural (not probabilistic) and the list is exhaustive (defaults at 10 and 11 cover any win or loss), every input produces exactly one output. No randomness, no tiebreaker hash needed.

### Coarse-mode behavior

When `comebackSwingCp`, `collapseSwingCp`, and `evalAtMove10` are unavailable (backfill path), rules 2, 3, and 4 cannot match. The classifier falls through to the structural rules 5–11. This means backfilled games never get classified as Pearl Harbor, Market Garden, Bulge, or Midway — they get slightly less "dramatic" classifications. This is an accepted trade-off: every game still gets a battle, and future analyses generated from the live paths will use the full rule set.

## Integration points

### 1. `scripts/batch-analyze.ts`

Inside `generateAnalysis(...)`, after computing `overallAssessment` and `focusArea` (around line 478 of the current file):

```ts
const playerColor = color === "white" ? "w" : "b";
const features = buildFeaturesFromEngineEvals(
  evals, moves, playerColor, result, openingAssessment, endgameReached
);
const battleAllusion = classifyBattle(features);

return {
  analysis: {
    // ...existing fields
    summary: { overallAssessment, focusArea, battleAllusion },
    missedMatesInOne: playerMissedMates.length > 0 ? playerMissedMates : undefined,
  },
  fixes,
};
```

`buildFeaturesFromEngineEvals` walks `evals.positions` and `evals.drops` to compute:
- `totalMoves` from `moves.length`
- `playerBlunders`/`playerMistakes`/`opponentBlunders` from `evals.drops` filtered by color and cpLoss thresholds (≥200cp = blunder, 100–199cp = mistake)
- `evalAtMove10` from the position after both sides' 10th move (i.e. `evals.positions[19]` if present, normalized to player perspective — negated for black)
- `comebackSwingCp`: walk positions in order, track the running minimum of player-perspective eval; if the final eval returns to ≥0, `comebackSwingCp = -runningMin` (the size of the deficit that was recovered). If player-perspective eval never went negative, leave undefined.
- `collapseSwingCp`: symmetric — walk positions, track running max of player-perspective eval; if final eval drops to ≤0, `collapseSwingCp = runningMax` (the size of the advantage that was lost). Otherwise undefined.
- `missedMate` from whether `playerMissedMates.length > 0`

### 2. `src/lib/claude.ts` `analyzeGame(...)`

After the existing post-processing loop for `criticalMoments` (around line 183 of the current file), and only when `engineEvals` was passed in:

```ts
if (engineEvals) {
  const playerColor = color === "white" ? "w" : "b";
  const gameResult = deriveResultFromPgn(pgn, playerColor);
  const moves = getAllMoves(pgn);
  const features = buildFeaturesFromEngineEvals(
    engineEvals, moves, playerColor, gameResult,
    result.opening.assessment, result.endgame.reached
  );
  result.summary.battleAllusion = classifyBattle(features);
}
```

`deriveResultFromPgn` reads the `[Result "1-0"]` tag and maps `1-0`/`0-1`/`1/2-1/2` to `"win"`/`"loss"`/`"draw"` from the player's perspective. If the tag is missing or malformed, `battleAllusion` is simply not set — the UI hides the card.

**Claude's system prompt is not modified.** Computing the field server-side after Claude returns means:
- No wasted tokens teaching the LLM the catalog.
- No risk of Claude hallucinating battle names or mismatched flavor lines.
- Perfect consistency with the batch-analyze path.

### 3. UI rendering (`src/components/analysis-view.tsx`)

Inside the existing SUMMARY card, below the Focus Area sub-box:

```tsx
{analysis.summary.battleAllusion && (
  <div className="mt-3 rounded-lg bg-surface-elevated/60 px-3 py-2 border-l-2 border-accent-amber">
    <span className="text-xs font-semibold text-accent-amber uppercase tracking-wide">
      This game was like…
    </span>
    <p className="mt-1 text-sm font-semibold text-gray-100">
      {analysis.summary.battleAllusion.battleName}
      <span className="ml-2 text-xs font-normal text-gray-400">
        ({analysis.summary.battleAllusion.subtitle})
      </span>
    </p>
    <p className="mt-1 text-xs text-gray-300 italic">
      {analysis.summary.battleAllusion.flavor}
    </p>
  </div>
)}
```

If the `accent-amber` Tailwind token is not present in the project's config, substitute `accent-yellow`. The card gracefully hides when the field is absent. No loading or placeholder states.

### 4. Backfill script (`scripts/backfill-battle-allusions.ts`)

New standalone TS script. Run once manually after deploy:

```
npx dotenv-cli -e .env.local -- npx tsx scripts/backfill-battle-allusions.ts
```

Behavior:

1. Connects to Upstash Redis (same pattern as `batch-analyze.ts`).
2. For each username in `["castledoon", "exstrax"]`:
   - Fetches the `archives:${user}` list (or falls back to Chess.com if the 5-minute cache has expired — same pattern the fixed meta API now uses).
   - Loads the last 3 months of games from `games:${user}:YYYY/MM`.
   - For each game:
     - Computes `analysisCacheKey(pgn)` and `redis.get`s the cached `AnalysisResult`.
     - Skips if cache miss or if `analysis.summary.battleAllusion` is already present (idempotent re-runs).
     - Derives `result` from the game record (`getPlayerOutcome`).
     - Builds coarse features via `buildFeaturesFromAnalysisResult(analysis, pgn, result)`.
     - Calls `classifyBattle`, mutates `analysis.summary.battleAllusion`, writes back with a fresh 90-day TTL.
     - Logs `[1/200] castledoon vs Opponent (2026-03-15): Stalingrad`.
3. Prints a final summary: `Processed 200 analyses: 195 battles added, 5 skipped (already present)`.

`buildFeaturesFromAnalysisResult` reads:
- `totalMoves` from `getAllMoves(pgn).length`
- `playerBlunders` from `analysis.criticalMoments.filter(cm => cm.type === "blunder").length`
- `playerMistakes` from `analysis.criticalMoments.filter(cm => cm.type === "mistake").length`
- `openingAssessment` from `analysis.opening.assessment`
- `missedMate` from `(analysis.missedMatesInOne?.length ?? 0) > 0`
- `endgameReached` from `analysis.endgame.reached`
- **Does not populate** `opponentBlunders`, `comebackSwingCp`, `collapseSwingCp`, `evalAtMove10` — the backfill path does not have access to eval trajectory data.

## Testing strategy

**Unit tests for `classifyBattle`:** hand-crafted feature objects for each of the 11 rules, asserting the expected battle is returned. Plus edge cases:
- Empty/missing optional fields → coarse-mode fallthrough works
- `result === "win"` with zero blunders and short game → Blitzkrieg
- `result === "win"` with `missedMate === true` → Iwo Jima (rule 1 fires before rule 7)

**Unit tests for `buildFeaturesFromEngineEvals`:** synthetic `engineEvals` input with known drops, asserting correct feature extraction.

**Unit tests for `buildFeaturesFromAnalysisResult`:** synthetic `AnalysisResult` input, asserting coarse features are correct and optional fields are undefined.

**Integration check (manual):** run `scripts/batch-analyze.ts --force-days 1` on one day of games, verify the written `analysis:*` blob contains `summary.battleAllusion`. Then load the game in the app and confirm the card renders.

**Backfill dry run:** add a `--dry-run` flag to the backfill script that logs classifications without writing to Redis. Run it first, inspect the distribution across the catalog, then run for real.

## Risks and open questions

- **Taste of the battles chosen:** the flavor lines are editorial. They may need revision after seeing real output across ~200 games. The single-module design makes this cheap.
- **Accent color:** `accent-amber` may not exist in the Tailwind config. Verify during implementation; fall back to `accent-yellow` if needed.
- **Result derivation in claude.ts path:** if the PGN lacks a `[Result]` tag, the field is omitted. Acceptable degradation.
- **Distribution skew:** rule 10 (Fall of Berlin as default win) and rule 11 (Fall of France as default loss) will likely dominate the catalog usage in practice. This is by design — the rarer battles feel earned when they do appear.

## Out of scope

- Battle lookups tied to specific openings
- Seasonal or rotating catalogs
- User preference to disable the feature
- Telemetry on which battles appear most often
- Multi-language flavor lines
- Any changes to the meta-analysis page or the new "Doh... You Had Mate in 1" section
