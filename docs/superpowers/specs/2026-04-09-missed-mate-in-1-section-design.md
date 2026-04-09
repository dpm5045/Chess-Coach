# "Doh..You Had Mate in 1" — Meta Analysis Section Design

**Date:** 2026-04-09
**Status:** Approved — ready for implementation plan
**Scope:** Single feature — add a new section to the meta analysis page surfacing games the user lost or drew despite having a mate-in-1 opportunity they missed.

---

## Purpose

Surface the most painful kind of missed-win moment — games where the user had a forced mate in one move but played something else and went on to lose or draw. The goal is a memorable, emotionally-hitting ("doh!") section that drives home the importance of checking for mate threats on every move, and links directly to the game analysis so the user can review the moment.

## Non-goals

- Not detecting missed mate in 2+ (that's a different, broader feature).
- Not surfacing missed mates in **won** games — the loss/draw filter is what makes the section memorable.
- Not regenerating the LLM-written meta analysis content — this section is deterministic and composed at request time, independent of the LLM.
- Not adding a new analysis depth or engine configuration — Stockfish at depth 14 already reliably detects mate in 1.

## User-visible behavior

A new section titled **"Doh..You Had Mate in 1"** appears on the meta analysis page at `/meta/{username}`, immediately after the "Areas for Improvement" (Weaknesses) section. Each entry is a clickable card showing:

- Line 1: `{timeClass} vs {opponent}` on the left, `{date} · {result}` on the right (muted)
- Line 2: `missed {moveNumber}{.|...}{mateSan} (you played {playedSan})`
- Line 3 (only when `missCount > 1`): `× {missCount} misses`

Clicking a card loads the game into the analysis page (`/analysis/{username}?game=...`), matching the exact navigation pattern used from the games list today.

The section is hidden entirely when the user has zero missed mate-in-1 opportunities in their analyzed games. There is no empty-state message — the section's mere presence carries meaning.

Games are sorted by `end_time` descending (most recent first).

## Data flow overview

```
batch-analyze.ts  →  writes analysis:{pgnHash} with missedMatesInOne[] field
                     (runs periodically; no API cost)

/api/meta-analyze  →  reads meta:{username}:latest (LLM-generated base)
                      reads archives:{username} + games:{username}:{yyyy/mm}
                      mget analysis:{pgnHash} for each loss/draw
                      composes missedMatesInOne entries
                      returns augmented MetaAnalysisResult

meta-analysis-view →  renders new section if missedMatesInOne is non-empty
```

The LLM-generated meta analysis (`backfill-meta.ts`) is **not** modified. The missed-mate data is composed at request time by joining the per-game analyses (which batch-analyze already stores) with the cached game metadata.

## Detection (batch-analyze.ts)

### Rule

For each `i` in `positions` where `positions[i].color === playerColor`:

- Let `prev = positions[i-1]` (the position *before* the player's move — the decision point).
- If `prev.mate === 1` (the mover had forced mate in one), and
- The move actually played (`positions[i].san`) did **not** deliver checkmate:

...then this is a missed-mate-in-1 moment.

**Determining "did not deliver checkmate":** use `chess.js` on the resulting FEN from `moves[i].fen` — `new Chess(fen).isCheckmate()` returns `false`. This is more reliable than inspecting `positions[i].mate`, since `mate === 0` is the checkmate sentinel used by `getTerminalEval` but the engine can also return other values for the resulting position.

### Sign convention

Stockfish's `score mate N` is reported from the side-to-move's perspective: positive = mover will deliver mate in N, negative = mover will be mated in N. So `prev.mate === +1` unambiguously means "the player who was about to move had mate in 1 available."

### Getting the mate SAN

- Take `prev.bestLine[0]` (the engine's top-move UCI).
- Convert to SAN with `uciToSan(decisionFen, ...)` where `decisionFen = moves[i-1].fen`.
- If `bestLine` is empty or UCI→SAN fails (returns `null`), skip this entry (do not crash).

### Output

`evaluateGame` returns a new field on its result:

```ts
{ positions, drops, missedMatesInOne: MissedMateInOne[] }
```

`generateAnalysis` then copies this into the returned `AnalysisResult.missedMatesInOne` (filtered to the user's color, which in practice is already the filter since we checked `positions[i].color === playerColor` during detection).

### Edge cases

- **Terminal positions** (`getTerminalEval`): returns `mate: null` for stalemate/draw, `mate: 0` for checkmate. Neither triggers the `prev.mate === 1` check — correctly excluded.
- **Game ending in mate** (the player did eventually deliver mate, but on a later move): the earlier missed mate-in-1 is still recorded. This is desired — the user missed an instant-win opportunity even if they won later. However, those games will be filtered out by the loss/draw filter at render time, so they won't appear in the section anyway.
- **Multiple misses per game:** all collected; one entry per game at display time, showing the earliest (by move number) plus the count.
- **UCI→SAN conversion failure:** skip the entry rather than crash. In practice this should never happen for a move the engine itself produced, but defensive.

## Data model

### New types (src/lib/types.ts)

```ts
// Records a single missed-mate-in-1 moment within one game
export interface MissedMateInOne {
  moveNumber: number;
  color: "w" | "b";
  playedSan: string;   // what the user played
  mateSan: string;     // the mate move they should have played
}

// One row in the meta page's "Doh..You Had Mate in 1" section
export interface MissedMateInOneEntry {
  gameUrl: string;            // chess.com URL — used as the analysis route param
  opponent: string;
  date: string;               // ISO yyyy-mm-dd
  timeClass: TimeClass;
  result: "loss" | "draw";
  missCount: number;          // total misses in this game (>= 1)
  firstMiss: MissedMateInOne; // earliest by move number
}
```

### Extended types

```ts
// AnalysisResult — new optional field, backward-compatible with existing cache entries
export interface AnalysisResult {
  // ...existing fields unchanged...
  missedMatesInOne?: MissedMateInOne[];
}

// MetaAnalysisResult — new optional field, composed at request time
export interface MetaAnalysisResult {
  // ...existing fields unchanged...
  missedMatesInOne?: MissedMateInOneEntry[];
}
```

Both fields are optional so old cached data (pre-this-feature) does not need migration. `batch-analyze.ts`'s local `AnalysisResult` interface gets the same new field.

## Backend composition (/api/meta-analyze)

Current flow: load `meta:{username}:latest` from Redis, return as-is.

New flow:

1. Load `meta:{username}:latest` — if missing, return 404 as today.
2. Load `archives:{username}` (already cached by batch-analyze with 5-minute TTL). If missing, skip step 3 and continue with `missedMatesInOne = []`.
3. Take the last 3 archive URLs (matching the batch-analyze window). For each, derive the `games:{username}:{yyyy/mm}` key and `redis.mget(...)` all three lists in a single call.
4. Flatten, filter to games where `getPlayerOutcome(game, username)` returns `"loss"` or `"draw"`.
5. Compute `analysisCacheKey(game.pgn)` for each surviving game, then `redis.mget(...)` all analysis entries in one call.
6. For each `(game, analysis)` pair where `analysis?.missedMatesInOne?.length > 0`:
   - Sort `missedMatesInOne` by `moveNumber` to find `firstMiss`.
   - Compose a `MissedMateInOneEntry`.
7. Sort entries by `end_time` descending.
8. Attach to the response: `{ ...baseMetaResult, missedMatesInOne: entries }`.

**Graceful degradation:** at each step, a missing cache entry yields `missedMatesInOne: []` rather than an error. The section simply hides on the frontend.

**Result classification (`getPlayerOutcome`):** currently lives as a private helper inside `scripts/backfill-meta.ts`. Lift it into a shared module — `src/lib/chess-com.ts` is the natural home (already has `isAllowedUser`). Both the meta API route and `backfill-meta.ts` import it from there.

### Performance

- Worst case: ~100 games cached per user, ~50% losses/draws. That's ~50 analysis entries to look up via a single `mget` + a few `get`s for archives/games metadata. On Upstash this is a single round trip — expected <100ms overhead on top of the existing meta fetch.
- The composition is pure-read, no writes, no new TTLs to manage.

## Frontend (src/components/meta-analysis-view.tsx)

Add a new section component between "Areas for Improvement" and "Opening Repertoire":

```tsx
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

### `MissedMateCard` component

Lives in the same file (matches the existing `ThemeCard` pattern — colocated, small, single-purpose). Visual: rounded card, `border-accent-red` left accent to signal "ouch." The entire card is a button.

Layout (mobile-first):

```
┌─────────────────────────────────────────────┐
│ rapid vs OoohItsIbi       Apr 9 · loss      │  ← flex row, justify-between
│ missed 34. Qh7# (you played Qh5)            │  ← text-sm
│                                 × 2 misses  │  ← only if missCount > 1
└─────────────────────────────────────────────┘
```

- Line 1: `{timeClass} vs {opponent}` (left), `{date} · {result}` (right, muted) — flex row, justify-between
- Line 2: `missed {moveNumber}{.|...}{mateSan} (you played {playedSan})` — the dot notation follows the existing convention (`.` for white, `...` for black)
- Line 3: `× {missCount} misses` — right-aligned, only rendered when `missCount > 1`

### Click handler (option A — mirrors the games list flow)

```ts
async function handleClick(gameUrl: string) {
  const res = await fetch(`/api/games/${encodeURIComponent(username)}`);
  if (!res.ok) return;
  const { games } = await res.json();
  const game = games.find((g: ChessComGame) => g.url === gameUrl);
  if (!game) return;
  sessionStorage.setItem("selectedGame", JSON.stringify(game));
  router.push(
    `/analysis/${encodeURIComponent(username)}?game=${encodeURIComponent(gameUrl)}`
  );
}
```

Fetches the user's games, finds the matching one by URL, stashes in sessionStorage, then navigates — exactly matching the existing games-list pattern. No refactor to the analysis page required.

Since `MetaAnalysisView` is currently a server-safe presentational component taking only `data`, the click handler needs `useRouter` and `ChessComGame` — this means the component (or at least `MissedMateCard`) needs `"use client"`. The parent `meta/[username]/page.tsx` is already a client component, so adding `"use client"` to `meta-analysis-view.tsx` is a no-op for the broader app.

### Date formatting

Display format: `Apr 9` (short month, numeric day) using `Intl.DateTimeFormat` with `{ month: "short", day: "numeric" }`. If the year differs from the current year, fall back to `{ month: "short", day: "numeric", year: "numeric" }` — matching the format `backfill-meta.ts#formatDate` already uses for consistency.

## Files affected

- **Modified:**
  - `src/lib/types.ts` — new `MissedMateInOne`, `MissedMateInOneEntry` types; `AnalysisResult.missedMatesInOne?`; `MetaAnalysisResult.missedMatesInOne?`
  - `scripts/batch-analyze.ts` — local `AnalysisResult` interface mirrors the types change; `evaluateGame` returns `missedMatesInOne`; `generateAnalysis` copies it through
  - `src/lib/chess-com.ts` — add exported `getPlayerOutcome(game, username)` helper (lifted from `backfill-meta.ts`)
  - `scripts/backfill-meta.ts` — import `getPlayerOutcome` from `chess-com.ts` instead of defining locally
  - `src/app/api/meta-analyze/route.ts` — compose `missedMatesInOne` at request time via the flow above
  - `src/components/meta-analysis-view.tsx` — new `MissedMateCard` component, new section, `"use client"` directive
- **No new files**

## Testing

- **Detection unit test:** given a small PGN with a known missed mate in 1 (e.g., a contrived position or an actual castledoon game we've seen), the detection should produce exactly one `MissedMateInOne` with the correct `moveNumber`, `playedSan`, and `mateSan`.
- **Detection negative case:** a PGN where the player *did* deliver mate when mate in 1 was available — zero entries.
- **Composition test:** mock Redis, verify the meta route joins games + analyses correctly, filters to loss/draw, sorts by date desc, handles missing cache entries gracefully.
- **Frontend:** manual smoke test on the meta page — section renders, hides when empty, click navigates correctly on both mobile (iPhone) and iPad viewports.

Automated tests: the codebase does not currently have a test harness set up. Manual verification via running `batch-analyze.ts` over the existing cached games and visually inspecting the meta page is acceptable for this feature.

## Rollout

1. Ship code changes.
2. Run `npx dotenv-cli -e .env.local -- npx tsx scripts/batch-analyze.ts --force-days 90` to re-detect missed mates across existing cached games.
3. Visit `/meta/castledoon` and `/meta/exstrax` to verify the section renders.

No LLM meta backfill rerun needed — the composition happens at request time.

## Open questions

None — all design decisions locked in during the brainstorming session:

- Data approach: composed at request time (A) — confirmed
- Entry content: "with the miss called out" — confirmed
- Linking: mirrors games-list sessionStorage pattern (A) — confirmed
- Placement: after Weaknesses — confirmed
- Empty state: hide entirely — confirmed
- Multi-miss handling: one entry per game, showing count — confirmed
- Scope: 3-month window — confirmed
