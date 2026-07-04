# Meta-Analysis Time-Control Filter — Design

**Date:** 2026-07-03
**Status:** Approved

## Goal

Let the user view their coaching report scoped to a single time control. Primary use case: CastleDoon's quality play is rapid; blitz games currently dilute the coaching report's assessment. The meta page gets three tabs — **Rapid | Blitz | All** — defaulting to **Rapid**, where each tab is a genuinely separate Claude-generated report built only from games of that time control.

## Decisions made

- **Approach:** Per-filter reports generated offline by the batch pipeline (not client-side filtering, not lazy on-demand generation). Chosen because the coaching *text* must be scoped, and it keeps `/api/meta-analyze` read-only.
- **Default tab:** Rapid.
- **Filters:** `all`, `rapid`, `blitz` only. Bullet and daily games get no tab but remain part of `all`.
- **Cost accepted:** meta refresh goes from 2 to up to 6 Opus 4.8 calls per run (~$1), triggered only by batch-analyze / manual backfill runs.

## Data model

- New type in `src/lib/types.ts`:
  ```ts
  export type MetaFilter = "all" | "rapid" | "blitz";
  export const META_FILTERS: MetaFilter[] = ["all", "rapid", "blitz"];
  ```
- `MetaAnalysisResult.timeControlInsights` becomes **optional** (`?`). The view already guards for absence, the backfill prompt never produces it, and single-time-control reports can't have cross-format comparison. The zod `MetaAnalysisResultSchema` in `src/lib/schemas.ts` marks it `.optional()` to match.

## Generation (`scripts/backfill-meta.ts`)

- Game selection becomes a pure helper (exported for testing, lives in `src/lib/meta-utils.ts`):
  ```ts
  selectGamesForFilter<T extends { time_class: string; end_time: number }>(
    games: T[], filter: MetaFilter, max = 50
  ): T[]
  ```
  Returns the `max` most recent games where `filter === "all"` or `time_class === filter` (input already sorted or sorted inside — sorted inside, descending `end_time`).
- The script loops `USERS × META_FILTERS`:
  - `< 10` matching games → log and skip (no Redis write for that filter).
  - Rapid/blitz prompts append: `All games below are ${filter} games.` so Claude doesn't hunt for cross-format patterns.
  - Cache writes:
    - `meta:{user}:{filter}:{hash}` (14-day TTL, dedup key; hash of sorted game UUIDs + filter)
    - `meta:{user}:{filter}:latest` (stable key, no TTL)
    - For `filter === "all"` only: also write legacy `meta:{user}:latest` (backward compatibility during rollout).
  - Local JSON snapshots become `scripts/data/{user}-meta-{filter}.json`.

## API (`src/app/api/meta-analyze/route.ts`)

- New query param: `filter`, default `"all"`. Values outside `META_FILTERS` → 400.
- Report lookup: `meta:{user}:{filter}:latest`; if `filter === "all"` and missing, fall back to legacy `meta:{user}:latest`.
- Missing report → 404 with message: `No ${filter} coaching report yet. Run the backfill script (or the player has fewer than 10 ${filter} games).`
- `composeMissedMates` gains a `filter` argument: when not `"all"`, entries are filtered to `entry.timeClass === filter` before returning.

## UI (`src/app/meta/[username]/page.tsx`)

- Filter state: `useState<MetaFilter>("rapid")`.
- Tabs rendered above the report: **Rapid | Blitz | All**, pill styling copied from `GameFilterTabs` (a local 3-option component or inline buttons — do not modify `GameFilterTabs`, whose option set is the games-page's concern).
- Fetch `/api/meta-analyze?username=X&filter=Y` on tab change; keep a `Record<MetaFilter, MetaAnalysisResult>` cache in state so revisiting a tab is instant.
- Subtitle shows scope: `Based on {gamesAnalyzed} {filter === "all" ? "" : filter} games ({timeRange})`.
- A 404 for a tab renders the API's message as a friendly empty state, not an error banner.

## Testing

- `tests/meta-utils.test.ts`: `selectGamesForFilter` — filters by time class, sorts by recency, respects `max`, `all` passes everything.
- Extend `tests/schemas.test.ts` only if a zod param schema is introduced for the filter; otherwise route-level validation is a simple allowlist check verified manually.
- Manual: dev server — each tab loads its report, missed-mates list matches the tab's time class, 404 empty state renders for a filter with no report.

## Rollout

1. Merge and deploy (Vercel auto-deploys from `main`).
2. Run `npx dotenv-cli -e .env.local -- npx tsx scripts/backfill-meta.ts --force` once to generate all per-filter reports (~6 Opus calls).
3. Subsequent `batch-analyze` runs refresh all filters automatically (it already invokes backfill-meta).

## Out of scope

- Bullet/daily tabs.
- Filtering the per-game analysis pages (already per-game).
- Changing the games-page `GameFilterTabs`.
- Regenerating reports on demand from the API route.
