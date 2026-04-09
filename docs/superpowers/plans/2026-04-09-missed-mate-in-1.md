# "Doh..You Had Mate in 1" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a section to the meta analysis page that surfaces games where the user lost or drew despite having a forced mate in 1 they missed.

**Architecture:** Detection runs inside `batch-analyze.ts` during Stockfish evaluation — each game's `AnalysisResult` gains an optional `missedMatesInOne` field. The meta API route composes these per-game flags into an aggregated list at request time by joining games + analyses from Redis. The frontend renders a new section after Weaknesses with clickable cards linking to each game's analysis.

**Tech Stack:** TypeScript, Next.js, Upstash Redis, chess.js, Stockfish WASM, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-04-09-missed-mate-in-1-section-design.md`

---

### Task 1: Add new types

**Files:**
- Modify: `src/lib/types.ts:99-106` (after CriticalMoment, before PositionEval)
- Modify: `src/lib/types.ts:80-97` (AnalysisResult — add optional field)
- Modify: `src/lib/types.ts:146-166` (MetaAnalysisResult — add optional field)

- [ ] **Step 1: Add MissedMateInOne interface**

In `src/lib/types.ts`, after the `CriticalMoment` interface (line ~106), add:

```ts
export interface MissedMateInOne {
  moveNumber: number;
  color: "w" | "b";
  playedSan: string;
  mateSan: string;
}
```

- [ ] **Step 2: Add MissedMateInOneEntry interface**

Directly after `MissedMateInOne`, add:

```ts
export interface MissedMateInOneEntry {
  gameUrl: string;
  opponent: string;
  date: string;
  timeClass: TimeClass;
  result: "loss" | "draw";
  missCount: number;
  firstMiss: MissedMateInOne;
}
```

- [ ] **Step 3: Add optional field to AnalysisResult**

In the existing `AnalysisResult` interface, after the `summary` field, add:

```ts
  missedMatesInOne?: MissedMateInOne[];
```

- [ ] **Step 4: Add optional field to MetaAnalysisResult**

In the existing `MetaAnalysisResult` interface, after the `coachingPlan` field, add:

```ts
  missedMatesInOne?: MissedMateInOneEntry[];
```

- [ ] **Step 5: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat: add MissedMateInOne types to AnalysisResult and MetaAnalysisResult"
```

---

### Task 2: Export analysisCacheKey from analysis-cache.ts

The meta API route needs to compute analysis cache keys to look up per-game analyses. The `cacheKey` function in `src/lib/analysis-cache.ts` is currently private. Export it with a clearer name.

**Files:**
- Modify: `src/lib/analysis-cache.ts:21-28`

- [ ] **Step 1: Rename and export cacheKey**

In `src/lib/analysis-cache.ts`, change:

```ts
function cacheKey(pgn: string): string {
```

to:

```ts
export function analysisCacheKey(pgn: string): string {
```

- [ ] **Step 2: Update internal references**

In the same file, update the two call sites. Change both occurrences of `cacheKey(pgn)` to `analysisCacheKey(pgn)`:

In `getCachedAnalysis` (~line 40):
```ts
    const result = await redis.get<AnalysisResult>(analysisCacheKey(pgn));
```

In `setCachedAnalysis` (~line 58):
```ts
    await redis.set(analysisCacheKey(pgn), analysis, { ex: 90 * 24 * 60 * 60 });
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/lib/analysis-cache.ts
git commit -m "refactor: export analysisCacheKey for reuse by meta API route"
```

---

### Task 3: Lift getPlayerOutcome into shared module

The meta API route needs `getPlayerOutcome` to filter games by loss/draw. It currently lives as a private helper in `scripts/backfill-meta.ts`. Move it to `src/lib/chess-com.ts` (the natural shared location) and update backfill-meta.ts to import it.

**Files:**
- Modify: `src/lib/chess-com.ts` (add two exported functions)
- Modify: `scripts/backfill-meta.ts:60-70` (replace local helpers with imports)

- [ ] **Step 1: Add helpers to chess-com.ts**

At the end of `src/lib/chess-com.ts`, add:

```ts
export function getPlayerColor(
  game: ChessComGame,
  username: string
): "white" | "black" {
  return game.white.username.toLowerCase() === username.toLowerCase()
    ? "white"
    : "black";
}

export function getPlayerOutcome(
  game: ChessComGame,
  username: string
): "win" | "draw" | "loss" {
  const color = getPlayerColor(game, username);
  const result = game[color].result;
  if (result === "win") return "win";
  if (
    [
      "stalemate",
      "insufficient",
      "repetition",
      "agreed",
      "50move",
      "timevsinsufficient",
    ].includes(result)
  )
    return "draw";
  return "loss";
}
```

- [ ] **Step 2: Update backfill-meta.ts to import from chess-com.ts**

In `scripts/backfill-meta.ts`, add this import near the top (after the existing imports):

```ts
import { getPlayerColor, getPlayerOutcome } from "../src/lib/chess-com";
```

Then delete the local `getPlayerColor` and `getPlayerOutcome` function definitions (lines 60-70).

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/lib/chess-com.ts scripts/backfill-meta.ts
git commit -m "refactor: lift getPlayerOutcome into shared chess-com module"
```

---

### Task 4: Add missed-mate-in-1 detection to batch-analyze.ts

This is the core detection logic. During `evaluateGame`, after computing all positions, scan for moments where the user had mate in 1 but played a different move. Store results in the `AnalysisResult`.

**Files:**
- Modify: `scripts/batch-analyze.ts:42-49` (local AnalysisResult interface)
- Modify: `scripts/batch-analyze.ts:222-270` (evaluateGame — add detection after positions loop)
- Modify: `scripts/batch-analyze.ts:292-458` (generateAnalysis — accept and pass through missedMatesInOne)

- [ ] **Step 1: Update local AnalysisResult interface**

In `scripts/batch-analyze.ts`, the local `AnalysisResult` interface (~line 43) currently ends with `summary`. Add the new field:

```ts
interface AnalysisResult {
  opening: { name: string; assessment: "good" | "inaccurate" | "dubious"; comment: string; };
  criticalMoments: Array<{ moveNumber: number; move: string; type: "blunder" | "mistake" | "excellent" | "missed_tactic"; comment: string; suggestion: string; }>;
  positionalThemes: string;
  endgame: { reached: boolean; comment: string; };
  summary: { overallAssessment: string; focusArea: string; };
  missedMatesInOne?: Array<{ moveNumber: number; color: "w" | "b"; playedSan: string; mateSan: string; }>;
}
```

- [ ] **Step 2: Add MissedMateInOne detection to evaluateGame**

In `evaluateGame` (starts ~line 223), after the `positions` loop ends and before the `drops` computation begins, insert the missed-mate detection. Find this block:

```ts
  const drops: EvalDrop[] = [];
```

Insert this **before** it:

```ts
  // Detect missed mate-in-1 opportunities
  const missedMatesInOne: Array<{ moveNumber: number; color: "w" | "b"; playedSan: string; mateSan: string }> = [];
  for (let i = 1; i < positions.length; i++) {
    const prev = positions[i - 1];
    const curr = positions[i];
    // prev is eval AFTER the opponent's move = side-to-move is curr's color
    // prev.mate === 1 means the side about to play has forced mate in 1
    if (prev.mate === 1) {
      // Check if the move actually played delivered checkmate
      const resultingFen = moves[i].fen;
      try {
        const chess = new Chess(resultingFen);
        if (!chess.isCheckmate()) {
          // Player had mate in 1 but didn't play it
          const decisionFen = moves[i - 1].fen;
          const mateSan = prev.bestLine.length > 0 ? uciToSan(decisionFen, prev.bestLine[0]) : null;
          if (mateSan) {
            missedMatesInOne.push({
              moveNumber: curr.moveNumber,
              color: curr.color,
              playedSan: curr.san,
              mateSan,
            });
          }
        }
      } catch { /* invalid FEN — skip */ }
    }
  }
```

- [ ] **Step 3: Return missedMatesInOne from evaluateGame**

Change the return statement of `evaluateGame` from:

```ts
  return { positions, drops };
```

to:

```ts
  return { positions, drops, missedMatesInOne };
```

- [ ] **Step 4: Pass missedMatesInOne through generateAnalysis**

Update the `generateAnalysis` function signature to accept the new data. Change:

```ts
function generateAnalysis(
  pgn: string, moves: MoveDetail[],
  evals: { positions: PositionEval[]; drops: EvalDrop[] },
  username: string, color: "white" | "black", rating: number,
  opponentName: string, result: string
): { analysis: AnalysisResult; fixes: number } {
```

to:

```ts
function generateAnalysis(
  pgn: string, moves: MoveDetail[],
  evals: { positions: PositionEval[]; drops: EvalDrop[]; missedMatesInOne: Array<{ moveNumber: number; color: "w" | "b"; playedSan: string; mateSan: string }> },
  username: string, color: "white" | "black", rating: number,
  opponentName: string, result: string
): { analysis: AnalysisResult; fixes: number } {
```

Then in the return statement at the end of `generateAnalysis` (~line 448), add `missedMatesInOne` to the analysis object. Change:

```ts
  return {
    analysis: {
      opening: { name: openingName, assessment: openingAssessment, comment: openingComment },
      criticalMoments,
      positionalThemes: themes,
      endgame: { reached: endgameReached, comment: endgameComment },
      summary: { overallAssessment, focusArea },
    },
    fixes,
  };
```

to:

```ts
  const playerChar = color === "white" ? "w" : "b";
  const playerMissedMates = evals.missedMatesInOne.filter(m => m.color === playerChar as ("w" | "b"));

  return {
    analysis: {
      opening: { name: openingName, assessment: openingAssessment, comment: openingComment },
      criticalMoments,
      positionalThemes: themes,
      endgame: { reached: endgameReached, comment: endgameComment },
      summary: { overallAssessment, focusArea },
      missedMatesInOne: playerMissedMates.length > 0 ? playerMissedMates : undefined,
    },
    fixes,
  };
```

Note: there is already a `const playerChar` variable in the `main` loop (~line 547). The one in `generateAnalysis` is separate because `generateAnalysis` is its own function scope — no conflict. However, to avoid confusion, rename the one in `generateAnalysis` to `playerColorChar`:

```ts
  const playerColorChar = color === "white" ? "w" : "b";
  const playerMissedMates = evals.missedMatesInOne.filter(m => m.color === playerColorChar as ("w" | "b"));
```

- [ ] **Step 5: Update the log line in main to show missed mates**

In the `main` function, after the `log(\`    OK ...\`)` line (~line 550), update the log to include missed mates count. Change:

```ts
        log(`    OK ${moves.length} moves, ${blunders}B ${mistakes}M${fixes > 0 ? `, ${fixes} suggestion fixes` : ""} — ${analysis.opening.name}`);
```

to:

```ts
        const missedMateCount = analysis.missedMatesInOne?.length ?? 0;
        log(`    OK ${moves.length} moves, ${blunders}B ${mistakes}M${missedMateCount > 0 ? ` ${missedMateCount}MM1` : ""}${fixes > 0 ? `, ${fixes} suggestion fixes` : ""} — ${analysis.opening.name}`);
```

- [ ] **Step 6: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add scripts/batch-analyze.ts
git commit -m "feat: detect missed mate-in-1 opportunities during batch analysis"
```

---

### Task 5: Update meta-analyze API route for composition

The meta API route currently returns `meta:{username}:latest` as-is. Augment it to compose `missedMatesInOne` entries at request time by joining games with their analyses.

**Files:**
- Modify: `src/app/api/meta-analyze/route.ts`

- [ ] **Step 1: Add imports**

At the top of `src/app/api/meta-analyze/route.ts`, update the imports:

```ts
import { isAllowedUser, getPlayerColor, getPlayerOutcome } from "@/lib/chess-com";
import { getRedis, analysisCacheKey } from "@/lib/analysis-cache";
import { MetaAnalysisResult, ChessComGame, MissedMateInOneEntry, AnalysisResult, TimeClass } from "@/lib/types";
```

- [ ] **Step 2: Add composeMissedMates helper**

After the imports and before the `GET` handler, add:

```ts
async function composeMissedMates(
  redis: NonNullable<ReturnType<typeof getRedis>>,
  username: string
): Promise<MissedMateInOneEntry[]> {
  // Load cached archives list
  const archives = await redis.get<string[]>(`archives:${username.toLowerCase()}`);
  if (!archives || archives.length === 0) return [];

  // Take last 3 months (matches batch-analyze window)
  const recentArchives = archives.slice(-3);

  // Load games from each month
  const gameKeys = recentArchives.map((url) => {
    const parts = url.split("/");
    const year = parts[parts.length - 2];
    const month = parts[parts.length - 1];
    return `games:${username.toLowerCase()}:${year}/${month}`;
  });

  const gameLists = await Promise.all(
    gameKeys.map((key) => redis.get<ChessComGame[]>(key))
  );

  const allGames = gameLists.flat().filter((g): g is ChessComGame => g !== null && g !== undefined);

  // Filter to losses and draws
  const lostOrDrawn = allGames.filter((game) => {
    const outcome = getPlayerOutcome(game, username);
    return outcome === "loss" || outcome === "draw";
  });

  if (lostOrDrawn.length === 0) return [];

  // Look up analyses in batch
  const analysisKeys = lostOrDrawn.map((game) => analysisCacheKey(game.pgn));
  const analyses = await redis.mget<(AnalysisResult | null)[]>(...analysisKeys);

  // Compose entries
  const entries: MissedMateInOneEntry[] = [];

  for (let i = 0; i < lostOrDrawn.length; i++) {
    const game = lostOrDrawn[i];
    const analysis = analyses[i];

    if (!analysis?.missedMatesInOne || analysis.missedMatesInOne.length === 0) {
      continue;
    }

    const color = getPlayerColor(game, username);
    const isWhite = color === "white";
    const opponent = isWhite ? game.black.username : game.white.username;
    const outcome = getPlayerOutcome(game, username);
    const date = new Date(game.end_time * 1000).toISOString().slice(0, 10);

    // Sort by move number, take earliest
    const sorted = [...analysis.missedMatesInOne].sort(
      (a, b) => a.moveNumber - b.moveNumber
    );

    entries.push({
      gameUrl: game.url,
      opponent,
      date,
      timeClass: game.time_class as TimeClass,
      result: outcome as "loss" | "draw",
      missCount: analysis.missedMatesInOne.length,
      firstMiss: sorted[0],
    });
  }

  // Sort by date descending (most recent first)
  entries.sort((a, b) => b.date.localeCompare(a.date));

  return entries;
}
```

- [ ] **Step 3: Augment the GET handler**

Replace the existing `GET` handler body. The full function becomes:

```ts
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const username = searchParams.get("username");

  if (!username) {
    return Response.json({ error: "Username is required" }, { status: 400 });
  }

  if (!isAllowedUser(username)) {
    return Response.json({ error: "Player not available" }, { status: 403 });
  }

  try {
    const redis = getRedis();
    if (!redis) {
      return Response.json(
        { error: "Cache not available" },
        { status: 503 }
      );
    }

    // Load base meta analysis (LLM-generated)
    const key = `meta:${username.toLowerCase()}:latest`;
    const result = await redis.get<MetaAnalysisResult>(key);

    if (!result) {
      return Response.json(
        { error: "No coaching report available yet. Run the backfill script to generate one." },
        { status: 404 }
      );
    }

    // Compose missed-mate-in-1 entries from per-game analyses
    const missedMatesInOne = await composeMissedMates(redis, username);

    return Response.json({
      ...result,
      missedMatesInOne: missedMatesInOne.length > 0 ? missedMatesInOne : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json(
      { error: `Failed to load meta analysis: ${message}` },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 4: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/app/api/meta-analyze/route.ts
git commit -m "feat: compose missed-mate-in-1 entries at request time in meta API"
```

---

### Task 6: Add frontend section and MissedMateCard

Add the "Doh..You Had Mate in 1" section to the meta analysis view, immediately after Weaknesses.

**Files:**
- Modify: `src/components/meta-analysis-view.tsx`

- [ ] **Step 1: Add "use client" and imports**

At the top of `src/components/meta-analysis-view.tsx`, add the client directive and imports. Replace the existing first line:

```ts
import { MetaAnalysisResult, MetaTheme } from "@/lib/types";
```

with:

```ts
"use client";

import { useRouter } from "next/navigation";
import { MetaAnalysisResult, MetaTheme, MissedMateInOneEntry, ChessComGame } from "@/lib/types";
```

- [ ] **Step 2: Add the MissedMateCard component**

After the existing `ThemeCard` component (ends ~line 47), add:

```tsx
function MissedMateCard({
  entry,
  username,
}: {
  entry: MissedMateInOneEntry;
  username: string;
}) {
  const router = useRouter();

  const displayDate = new Date(entry.date + "T00:00:00").toLocaleDateString(
    "en-US",
    { month: "short", day: "numeric" }
  );

  const moveNotation =
    entry.firstMiss.color === "w"
      ? `${entry.firstMiss.moveNumber}. ${entry.firstMiss.mateSan}`
      : `${entry.firstMiss.moveNumber}... ${entry.firstMiss.mateSan}`;

  async function handleClick() {
    try {
      const res = await fetch(
        `/api/games/${encodeURIComponent(username)}`
      );
      if (!res.ok) return;
      const data = await res.json();
      const game = data.games.find(
        (g: ChessComGame) => g.url === entry.gameUrl
      );
      if (!game) return;
      sessionStorage.setItem("selectedGame", JSON.stringify(game));
      router.push(
        `/analysis/${encodeURIComponent(username)}?game=${encodeURIComponent(entry.gameUrl)}`
      );
    } catch {
      /* silently fail */
    }
  }

  return (
    <button
      onClick={handleClick}
      className="w-full rounded-xl bg-surface-card p-4 border-l-4 border-accent-red text-left transition hover:bg-surface-card/80"
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-semibold">
          {entry.timeClass} vs {entry.opponent}
        </span>
        <span className="text-xs text-gray-500">
          {displayDate} &middot; {entry.result}
        </span>
      </div>
      <p className="text-sm text-gray-300">
        missed {moveNotation} (you played {entry.firstMiss.playedSan})
      </p>
      {entry.missCount > 1 && (
        <p className="text-xs text-gray-500 text-right mt-1">
          &times; {entry.missCount} misses
        </p>
      )}
    </button>
  );
}
```

- [ ] **Step 3: Insert the section into MetaAnalysisView**

In the `MetaAnalysisView` component, find the closing `</div>` of the Weaknesses section (~line 95):

```tsx
      {/* Weaknesses */}
      {data.weaknesses.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold uppercase text-gray-400 mb-3">
            Areas for Improvement
          </h2>
          <div className="space-y-3">
            {data.weaknesses.map((theme, i) => (
              <ThemeCard
                key={i}
                theme={theme}
                accentBorder="border-accent-orange"
              />
            ))}
          </div>
        </div>
      )}
```

Immediately after that closing `)}`, insert:

```tsx
      {/* Missed Mate in 1 */}
      {data.missedMatesInOne && data.missedMatesInOne.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold uppercase text-gray-400 mb-3">
            Doh..You Had Mate in 1
          </h2>
          <div className="space-y-2">
            {data.missedMatesInOne.map((entry) => (
              <MissedMateCard
                key={entry.gameUrl}
                entry={entry}
                username={data.playerUsername}
              />
            ))}
          </div>
        </div>
      )}
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: Build succeeds with no type errors

- [ ] **Step 5: Commit**

```bash
git add src/components/meta-analysis-view.tsx
git commit -m "feat: add 'Doh..You Had Mate in 1' section to meta analysis page"
```

---

### Task 7: Backfill and end-to-end verification

Re-run batch analysis with `--force-days 90` so existing games get the new `missedMatesInOne` field, then verify the feature works end-to-end.

**Files:** None modified (runtime verification only)

- [ ] **Step 1: Re-run batch analysis**

Run:
```bash
npx dotenv-cli -e .env.local -- npx tsx scripts/batch-analyze.ts --force-days 90
```

Expected: All games re-analyzed. Look for `MM1` in the log output — any game where the user missed mate in 1 will show e.g. `1MM1`. Games without missed mates show no `MM1` tag.

- [ ] **Step 2: Start dev server and verify**

Run:
```bash
npm run dev
```

Then visit:
- `http://localhost:3000/meta/castledoon` — check if "Doh..You Had Mate in 1" section appears (it will only appear if any castledoon games have missed mate-in-1 in losses/draws)
- `http://localhost:3000/meta/exstrax` — same check

**If section appears:** click one of the cards and verify it navigates to the analysis page for that game.

**If section does NOT appear for either user:** this is correct if neither user actually missed a mate in 1 in a lost/drawn game in the last 3 months. To verify the code works, check the batch-analyze output for any `MM1` entries and cross-reference with the game outcomes — if all games with missed mates were wins, the section correctly hides.

- [ ] **Step 3: Verify no build regressions**

Run: `npm run build`
Expected: Build succeeds
