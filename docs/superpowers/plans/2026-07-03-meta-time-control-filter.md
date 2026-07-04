# Meta-Analysis Time-Control Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rapid | Blitz | All tabs on the meta coaching page, where each tab is a separate Claude-generated report built only from games of that time control (spec: `docs/superpowers/specs/2026-07-03-meta-time-control-filter-design.md`).

**Architecture:** `scripts/backfill-meta.ts` loops users × filters and writes per-filter Redis keys (`meta:{user}:{filter}:latest`); `/api/meta-analyze` takes a validated `filter` param with legacy-key fallback and scopes the missed-mates list; the meta page holds a `MetaFilter` state (default `"rapid"`) with per-tab response caching. Game selection is a pure, tested helper in `src/lib/meta-utils.ts`.

**Tech Stack:** Next.js 16 App Router, Upstash Redis, vitest, existing `@anthropic-ai/sdk` usage in the backfill script.

## Global Constraints

- Filters are exactly `"all" | "rapid" | "blitz"` (type `MetaFilter`); bullet/daily games get no tab but remain part of `all`.
- Default tab: `rapid`. Skip generation when a filter has `< 10` games.
- Redis keys: `meta:{user}:{filter}:{hash}` (14-day TTL) and `meta:{user}:{filter}:latest` (no TTL); `filter === "all"` also writes legacy `meta:{user}:latest`.
- Do not modify `src/components/game-filter-tabs.tsx`.
- After every task: `npx tsc --noEmit` and `npx vitest run` must pass before committing.
- Commit messages end with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: `MetaFilter` type + `selectGamesForFilter` helper (+ optional `timeControlInsights`)

**Files:**
- Modify: `src/lib/types.ts` (add `MetaFilter`/`META_FILTERS`; make `timeControlInsights` optional)
- Modify: `src/lib/schemas.ts` (make `timeControlInsights` optional)
- Create: `src/lib/meta-utils.ts`
- Test: `tests/meta-utils.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (used by Tasks 2–4):
  - `type MetaFilter = "all" | "rapid" | "blitz"` and `const META_FILTERS: MetaFilter[]` (from `@/lib/types`)
  - `selectGamesForFilter<T extends { time_class: string; end_time: number }>(games: T[], filter: MetaFilter, max?: number): T[]` (from `@/lib/meta-utils`, default `max = 50`, sorted most-recent-first)

- [ ] **Step 1: Add the type and constant to `src/lib/types.ts`**

Append at the end of the file (after `ANALYSIS_VERSION`):

```ts
// Meta-analysis time-control filters. "all" includes bullet/daily too.
export type MetaFilter = "all" | "rapid" | "blitz";
export const META_FILTERS: MetaFilter[] = ["all", "rapid", "blitz"];
```

In the `MetaAnalysisResult` interface, change `timeControlInsights` to optional:

```ts
  timeControlInsights?: {
    breakdown: string;
    comparison: string;
    recommendation: string;
  };
```

In `src/lib/schemas.ts`, change the `timeControlInsights` entry of `MetaAnalysisResultSchema` to:

```ts
  timeControlInsights: z
    .object({
      breakdown: z.string(),
      comparison: z.string(),
      recommendation: z.string(),
    })
    .optional(),
```

- [ ] **Step 2: Write the failing tests**

Create `tests/meta-utils.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { selectGamesForFilter } from "@/lib/meta-utils";

const game = (time_class: string, end_time: number) => ({ time_class, end_time });

describe("selectGamesForFilter", () => {
  const games = [
    game("rapid", 100),
    game("blitz", 400),
    game("rapid", 300),
    game("bullet", 500),
    game("daily", 50),
    game("blitz", 200),
  ];

  it("returns only games of the requested time class, most recent first", () => {
    expect(selectGamesForFilter(games, "rapid")).toEqual([
      game("rapid", 300),
      game("rapid", 100),
    ]);
  });

  it("passes every time class through for 'all', sorted by recency", () => {
    const all = selectGamesForFilter(games, "all");
    expect(all.map((g) => g.end_time)).toEqual([500, 400, 300, 200, 100, 50]);
  });

  it("respects the max parameter", () => {
    expect(selectGamesForFilter(games, "all", 2)).toEqual([
      game("bullet", 500),
      game("blitz", 400),
    ]);
  });

  it("does not mutate the input array", () => {
    const copy = [...games];
    selectGamesForFilter(games, "all");
    expect(games).toEqual(copy);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/meta-utils.test.ts`
Expected: FAIL — cannot resolve `@/lib/meta-utils`.

- [ ] **Step 4: Implement `src/lib/meta-utils.ts`**

```ts
import { MetaFilter } from "./types";

/**
 * Select the games a meta-analysis report is built from: the `max` most
 * recent games matching the filter ("all" passes every time class).
 */
export function selectGamesForFilter<
  T extends { time_class: string; end_time: number }
>(games: T[], filter: MetaFilter, max = 50): T[] {
  return games
    .filter((g) => filter === "all" || g.time_class === filter)
    .sort((a, b) => b.end_time - a.end_time)
    .slice(0, max);
}
```

(`filter()` already copies the array, so the in-place `sort` never touches the caller's input.)

- [ ] **Step 5: Verify**

Run: `npx vitest run` — expect all tests PASS (28 = 24 existing + 4 new).
Run: `npx tsc --noEmit` — expect no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/lib/schemas.ts src/lib/meta-utils.ts tests/meta-utils.test.ts
git commit -m "feat(meta): MetaFilter type and tested game-selection helper"
```

---

### Task 2: Per-filter report generation in `scripts/backfill-meta.ts`

**Files:**
- Modify: `scripts/backfill-meta.ts`

**Interfaces:**
- Consumes: `selectGamesForFilter` from `../src/lib/meta-utils`; `MetaFilter`, `META_FILTERS` from `../src/lib/types`.
- Produces: Redis keys `meta:{user}:{filter}:{hash}` (14d TTL), `meta:{user}:{filter}:latest`, legacy `meta:{user}:latest` (all-filter only) — read by Task 3. Local snapshots `scripts/data/{user}-meta-{filter}.json`.

- [ ] **Step 1: Add imports and update `metaCacheKey`**

Add to the imports at the top of `scripts/backfill-meta.ts`:

```ts
import { selectGamesForFilter } from "../src/lib/meta-utils";
import { META_FILTERS, type MetaFilter } from "../src/lib/types";
```

Replace the existing `metaCacheKey` function:

```ts
function metaCacheKey(username: string, gameUuids: string[], filter: MetaFilter): string {
  const sorted = [...gameUuids].sort().join(",");
  const hash = createHash("sha256").update(`${sorted}|${filter}`).digest("hex").slice(0, 16);
  return `meta:${username.toLowerCase()}:${filter}:${hash}`;
}
```

Add a constant near `MAX_GAMES`:

```ts
const MIN_GAMES_FOR_REPORT = 10;
```

- [ ] **Step 2: Restructure `main()` to loop filters**

Replace the body of the per-user section of `main()` — everything from `const games = allGames` down to the `console.log(\`  Saved to ${outPath}\`);` line — with a filter loop. The fetch of `allGames` and the `{username}-games.json` snapshot write stay where they are (once per user, before the loop). The new code:

```ts
    for (const filter of META_FILTERS) {
      const games = selectGamesForFilter(allGames, filter, MAX_GAMES);
      const label = filter === "all" ? "all time controls" : filter;

      if (games.length < MIN_GAMES_FOR_REPORT) {
        console.log(`  [${filter}] Only ${games.length} games — skipping (need ${MIN_GAMES_FOR_REPORT})`);
        continue;
      }

      console.log(`  [${filter}] Using ${games.length} most recent games (of ${allGames.length} fetched from last ${MONTHS_TO_FETCH} months)`);

      const uuids = games.map((g) => g.uuid);
      const key = metaCacheKey(username, uuids, filter);

      // Check if already cached
      const existing = await redis.get(key);
      if (existing && !FORCE) {
        console.log(`  [${filter}] Already cached at ${key} — skipping`);
        continue;
      }

      // Build game summary with two-tier approach
      const sections: string[] = [];
      let cachedCount = 0;

      for (const game of games) {
        const color = getPlayerColor(game as never, username);
        const outcome = getPlayerOutcome(game as never, username);
        const opp = color === "white" ? game.black : game.white;
        const playerRating = game[color].rating;
        const date = formatDate(game.end_time);

        const header = `Game vs ${opp.username} (${opp.rating}) on ${date} | ${color} | ${game.time_class} ${game.time_control} | ${outcome} | Rating: ${playerRating}`;

        // Try to find cached per-game analysis in Redis
        const analysisKey = analysisCacheKey(game.pgn);
        const cachedAnalysis = await redis.get<AnalysisResult>(analysisKey);

        if (cachedAnalysis) {
          cachedCount++;
          sections.push(`${header}\n  ${summarizeAnalysis(cachedAnalysis)}`);
        } else {
          const moves = stripPgnHeaders(game.pgn);
          sections.push(`${header}\n  Moves: ${moves}`);
        }
      }

      console.log(`  [${filter}] ${cachedCount}/${games.length} games had cached analyses`);

      const latestColor = getPlayerColor(games[0] as never, username);
      const currentRating = games[0][latestColor].rating;
      const gamesSummary = sections.join("\n\n");
      const filterNote =
        filter === "all" ? "" : ` All games below are ${filter} games.`;

      console.log(`  [${filter}] Calling Claude for meta analysis (rating ~${currentRating})...`);

      const message = await client.messages.create({
        // Keep in sync with src/lib/claude.ts (claude-sonnet-4-20250514 was retired 2026-06-15)
        model: "claude-opus-4-8",
        max_tokens: 4096,
        system: META_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `Analyze the ${label} game history for ${username} (current rating ~${currentRating}, ${games.length} games below).${filterNote} Identify recurring patterns and provide a coaching plan.\n\n${gamesSummary}`,
          },
        ],
      });

      const responseText = message.content[0].type === "text" ? message.content[0].text : "";
      const jsonStr = extractJson(responseText);
      const result = JSON.parse(jsonStr);

      // Write to Redis with 14-day TTL (hash-based key for dedup)
      await redis.set(key, result, { ex: 14 * 24 * 60 * 60 });
      console.log(`  [${filter}] Cached at ${key}`);

      // Stable per-filter key for the web app to read
      const latestKey = `meta:${username.toLowerCase()}:${filter}:latest`;
      await redis.set(latestKey, result);
      console.log(`  [${filter}] Updated ${latestKey}`);

      // Legacy key kept in sync so older clients still work
      if (filter === "all") {
        await redis.set(`meta:${username.toLowerCase()}:latest`, result);
      }

      // Also save locally for reference
      const outPath = path.join(dataDir, `${username}-meta-${filter}.json`);
      fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
      console.log(`  [${filter}] Saved to ${outPath}`);
    }
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` — expect no errors.
Run: `npx vitest run` — expect PASS (script changes shouldn't affect tests).

Do **not** run the script yet — generation happens in Task 5 so we only pay for Opus calls once, after the API/UI can consume them.

- [ ] **Step 4: Commit**

```bash
git add scripts/backfill-meta.ts
git commit -m "feat(backfill-meta): generate per-time-control coaching reports"
```

---

### Task 3: `filter` param on `/api/meta-analyze`

**Files:**
- Modify: `src/app/api/meta-analyze/route.ts`

**Interfaces:**
- Consumes: `MetaFilter`, `META_FILTERS` from `@/lib/types`; Redis keys written by Task 2.
- Produces: `GET /api/meta-analyze?username=X&filter=rapid|blitz|all` (default `all`; invalid → 400; missing report → 404 with `error` message). Missed-mates entries filtered to the requested time class. Consumed by Task 4.

- [ ] **Step 1: Update imports and `composeMissedMates`**

In `src/app/api/meta-analyze/route.ts`, extend the types import:

```ts
import { MetaAnalysisResult, MissedMateInOneEntry, AnalysisResult, TimeClass, MetaFilter, META_FILTERS } from "@/lib/types";
```

Change the `composeMissedMates` signature and the losses/draws filter:

```ts
async function composeMissedMates(
  redis: NonNullable<ReturnType<typeof getRedis>>,
  username: string,
  filter: MetaFilter
): Promise<MissedMateInOneEntry[]> {
```

and inside it, replace the `lostOrDrawn` filter:

```ts
  // Filter to losses and draws in the requested time class
  const lostOrDrawn = allGames.filter((game) => {
    if (filter !== "all" && game.time_class !== filter) return false;
    const outcome = getPlayerOutcome(game, username);
    return outcome === "loss" || outcome === "draw";
  });
```

- [ ] **Step 2: Parse/validate the filter and use per-filter keys in `GET`**

Replace the section of `GET` from `const key = ...` through the missed-mates call with:

```ts
    const filterParam = searchParams.get("filter") ?? "all";
    if (!META_FILTERS.includes(filterParam as MetaFilter)) {
      return Response.json(
        { error: `Invalid filter "${filterParam}" — use one of: ${META_FILTERS.join(", ")}` },
        { status: 400 }
      );
    }
    const filter = filterParam as MetaFilter;

    // Load base meta analysis (LLM-generated) for the requested filter
    const key = `meta:${username.toLowerCase()}:${filter}:latest`;
    let result = await redis.get<MetaAnalysisResult>(key);

    // Legacy fallback: pre-filter deployments only wrote meta:{user}:latest
    if (!result && filter === "all") {
      result = await redis.get<MetaAnalysisResult>(`meta:${username.toLowerCase()}:latest`);
    }

    if (!result) {
      return Response.json(
        { error: `No ${filter === "all" ? "" : filter + " "}coaching report available yet. Run the backfill script (or the player has fewer than 10 ${filter === "all" ? "" : filter + " "}games).` },
        { status: 404 }
      );
    }

    // Compose missed-mate-in-1 entries from per-game analyses
    const missedMatesInOne = await composeMissedMates(redis, username, filter);
```

(The filter parse must sit **before** the `redis` null-check? No — keep it right after the `isAllowedUser` check, before `getRedis()`, so an invalid filter returns 400 even without Redis configured. Place the `filterParam` block immediately after the allowlist check and leave the `getRedis()`/503 block where it is; the `const key = ...` section then only contains the lookup code.)

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` — no errors. Run: `npx vitest run` — PASS.

Manual check (dev server + `.env.local`):

```bash
curl -s "http://localhost:3000/api/meta-analyze?username=castledoon&filter=bogus" | head -c 120   # expect 400 error json
curl -s "http://localhost:3000/api/meta-analyze?username=castledoon&filter=rapid" | head -c 120   # expect 404 until Task 5 generates reports
curl -s "http://localhost:3000/api/meta-analyze?username=castledoon" -o /dev/null -w "%{http_code}\n"  # expect 200 via legacy fallback
```

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/meta-analyze/route.ts"
git commit -m "feat(api): time-control filter param on meta-analyze with legacy fallback"
```

---

### Task 4: Filter tabs on the meta page

**Files:**
- Modify: `src/app/meta/[username]/page.tsx` (full replacement below)

**Interfaces:**
- Consumes: `MetaFilter` from `@/lib/types`; Task 3's API contract (200 report / 404 `{error}` / 400).
- Produces: user-facing tabs; nothing downstream.

- [ ] **Step 1: Replace `src/app/meta/[username]/page.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { MetaAnalysisResult, MetaFilter } from "@/lib/types";
import { MetaAnalysisView } from "@/components/meta-analysis-view";
import { MetaAnalysisSkeleton } from "@/components/loading-skeleton";

const FILTER_TABS: { label: string; value: MetaFilter }[] = [
  { label: "Rapid", value: "rapid" },
  { label: "Blitz", value: "blitz" },
  { label: "All", value: "all" },
];

export default function MetaAnalysisPage() {
  const params = useParams<{ username: string }>();
  const router = useRouter();
  const username = decodeURIComponent(params.username);

  const [filter, setFilter] = useState<MetaFilter>("rapid");
  const [results, setResults] = useState<Partial<Record<MetaFilter, MetaAnalysisResult>>>({});
  const [emptyMessages, setEmptyMessages] = useState<Partial<Record<MetaFilter, string>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const result = results[filter] ?? null;
  const emptyMessage = emptyMessages[filter] ?? null;

  useEffect(() => {
    // Already have this tab's report (or its empty state) — nothing to fetch
    if (results[filter] || emptyMessages[filter]) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    async function loadCachedAnalysis() {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(
          `/api/meta-analyze?username=${encodeURIComponent(username)}&filter=${filter}`
        );

        const data = await res.json();
        if (cancelled) return;

        if (res.status === 404) {
          setEmptyMessages((prev) => ({ ...prev, [filter]: data.error }));
        } else if (!res.ok) {
          throw new Error(data.error || "Failed to load coaching report");
        } else {
          setResults((prev) => ({ ...prev, [filter]: data }));
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Something went wrong");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadCachedAnalysis();
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, filter]);

  return (
    <div className="mx-auto max-w-lg md:max-w-2xl px-4 pt-6 pb-8">
      <button
        onClick={() => router.push("/")}
        className="mb-4 text-sm text-gray-400 transition hover:text-gray-200"
      >
        &larr; Back
      </button>

      <h1 className="mb-1 text-2xl font-bold">{username}&apos;s Coaching Report</h1>
      {result && (
        <p className="mb-4 text-sm text-gray-400">
          Based on {result.gamesAnalyzed} {filter === "all" ? "" : `${filter} `}games ({result.timeRange})
        </p>
      )}

      <div className="mb-6 flex gap-2 overflow-x-auto pb-2">
        {FILTER_TABS.map(({ label, value }) => (
          <button
            key={value}
            onClick={() => setFilter(value)}
            className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              filter === value
                ? "bg-accent-blue text-white"
                : "bg-surface-card text-gray-400 hover:text-gray-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading && (
        <div>
          <p className="mb-4 text-center text-gray-400">
            Loading coaching report&hellip;
          </p>
          <MetaAnalysisSkeleton />
        </div>
      )}

      {error && !loading && (
        <div className="mb-4 rounded-lg bg-red-900/30 px-4 py-3 text-accent-red">
          <p>{error}</p>
        </div>
      )}

      {emptyMessage && !loading && !error && (
        <div className="rounded-xl bg-surface-card p-6 text-center text-gray-400">
          <p>{emptyMessage}</p>
        </div>
      )}

      {result && !loading && <MetaAnalysisView data={result} />}
    </div>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` and `npx vitest run` — no errors / PASS.
Run: `npm run build` — expect success.

Manual (dev server): open `/meta/castledoon`. Rapid tab shows the 404 empty state (reports not generated yet), All tab shows the existing report via legacy fallback, tab switching doesn't refetch a tab you've already visited (check the network panel or server log).

- [ ] **Step 3: Commit**

```bash
git add "src/app/meta/[username]/page.tsx"
git commit -m "feat(ui): Rapid/Blitz/All tabs on meta page, defaulting to Rapid"
```

---

### Task 5: Generate reports, verify end-to-end, push

**Files:** none (operational).

- [ ] **Step 1: Generate all per-filter reports** (~6 Opus calls, a few minutes)

```bash
npx dotenv-cli -e .env.local -- npx tsx scripts/backfill-meta.ts --force
```

Expected: per user, three `[filter]` blocks each ending in `Updated meta:{user}:{filter}:latest` (or a skip line when < 10 games of that type).

- [ ] **Step 2: End-to-end check** (dev server running)

```bash
curl -s "http://localhost:3000/api/meta-analyze?username=castledoon&filter=rapid" -o /tmp/rapid.json -w "%{http_code}\n"     # 200
curl -s "http://localhost:3000/api/meta-analyze?username=castledoon&filter=blitz" -o /tmp/blitz.json -w "%{http_code}\n"     # 200
node -e "const r=require('/tmp/rapid.json'); console.log('rapid missedMates timeClasses:', [...new Set((r.missedMatesInOne||[]).map(e=>e.timeClass))])"
```

Expected: the rapid report's missed-mates list contains only `rapid` (or is empty). In the browser, all three tabs render distinct reports.

- [ ] **Step 3: Push**

```bash
git push origin main
```

(Start ssh-agent first per the usual routine on this machine.) Vercel auto-deploys `main`; the production site reads the same Redis, so the new reports are live as soon as the deploy finishes.

---

## Self-Review Notes

- **Spec coverage:** types/helper → Task 1; generation with `< 10` skip, prompt note, keys, legacy sync, local snapshots → Task 2; API param, validation, fallback, 404 copy, missed-mates scoping → Task 3; tabs, default rapid, per-tab cache, subtitle, empty state → Task 4; rollout → Task 5. `GameFilterTabs` untouched per spec.
- **Type consistency:** `MetaFilter` / `META_FILTERS` defined once in `types.ts`; `selectGamesForFilter(games, filter, max)` argument order consistent between Tasks 1 and 2; API query param name `filter` matches the UI fetch in Task 4.
- **Placeholder scan:** clean — every code step contains the full code.
