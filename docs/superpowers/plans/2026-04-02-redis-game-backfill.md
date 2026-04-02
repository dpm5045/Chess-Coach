# Redis Game & Analysis Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pre-populate Redis with all historical Chess.com game data and coaching analysis for CastleDoon and exstrax, then update the games API route to serve from cache.

**Architecture:** A shared Redis client module (`analysis-cache.ts`) is extended with game caching helpers in a new `game-cache.ts`. Two standalone scripts handle the backfill: one fetches games from Chess.com and stores them in Redis + JSON files, the other writes pre-computed analysis results to Redis. The games API route is updated to read from Redis first.

**Tech Stack:** `@upstash/redis` (already installed), `npx tsx` for running scripts, Chess.com public API

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/lib/analysis-cache.ts` | Modify | Export `getRedis()` for reuse |
| `src/lib/game-cache.ts` | Create | `getCachedGames()` / `setCachedGames()` Redis helpers |
| `scripts/backfill-games.ts` | Create | Fetch all Chess.com games, store in Redis + write JSON |
| `scripts/backfill-analysis.ts` | Create | Read analysis JSON files, write to Redis |
| `src/app/api/games/[username]/route.ts` | Modify | Check Redis cache before hitting Chess.com |

---

### Task 1: Export `getRedis()` from analysis-cache.ts

**Files:**
- Modify: `src/lib/analysis-cache.ts:9-14`

- [ ] **Step 1: Add `export` to `getRedis()`**

In `src/lib/analysis-cache.ts`, change line 9 from:

```typescript
function getRedis(): Redis | null {
```

to:

```typescript
export function getRedis(): Redis | null {
```

No other changes needed — the function body stays the same.

- [ ] **Step 2: Verify the app still builds**

Run: `npx next build`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/analysis-cache.ts
git commit -m "refactor: export getRedis() for reuse by game cache and scripts"
```

---

### Task 2: Create game-cache.ts

**Files:**
- Create: `src/lib/game-cache.ts`

- [ ] **Step 1: Create the game cache module**

Create `src/lib/game-cache.ts`:

```typescript
import { getRedis } from "./analysis-cache";
import { ChessComGame } from "./types";

function gamesKey(username: string): string {
  return `games:${username.toLowerCase()}`;
}

/**
 * Read cached games for a user from Redis.
 * Returns null if Redis is not configured or key doesn't exist.
 */
export async function getCachedGames(
  username: string
): Promise<ChessComGame[] | null> {
  try {
    const redis = getRedis();
    if (!redis) return null;
    const games = await redis.get<ChessComGame[]>(gamesKey(username));
    return games ?? null;
  } catch {
    return null;
  }
}

/**
 * Write a user's full game list to Redis (no TTL — historical games don't change).
 */
export async function setCachedGames(
  username: string,
  games: ChessComGame[]
): Promise<void> {
  try {
    const redis = getRedis();
    if (!redis) return;
    await redis.set(gamesKey(username), games);
  } catch {
    // Redis not configured or unavailable — skip silently
  }
}
```

- [ ] **Step 2: Verify the app still builds**

Run: `npx next build`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/game-cache.ts
git commit -m "feat: add game-cache.ts with Redis read/write helpers"
```

---

### Task 3: Create backfill-games.ts script

**Files:**
- Create: `scripts/backfill-games.ts`

This script fetches ALL archives for both users, stores games in Redis, and writes JSON files for analysis input.

- [ ] **Step 1: Install tsx for running TypeScript scripts**

Run: `npm install --save-dev tsx`

- [ ] **Step 2: Create the backfill-games script**

Create `scripts/backfill-games.ts`:

```typescript
import { Redis } from "@upstash/redis";
import * as fs from "fs";
import * as path from "path";

const CHESS_COM_API = "https://api.chess.com/pub";
const HEADERS = {
  "User-Agent": "ChessCoach/1.0 (github.com/chess-coach)",
  Accept: "application/json",
};
const USERS = ["castledoon", "exstrax"];

function getRedis(): Redis {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    throw new Error(
      "Missing KV_REST_API_URL or KV_REST_API_TOKEN in environment"
    );
  }
  return new Redis({ url, token });
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    throw new Error(`Chess.com API error: ${res.status} for ${url}`);
  }
  return res.json() as Promise<T>;
}

async function fetchAllGames(username: string) {
  console.log(`\n--- Fetching games for ${username} ---`);

  const { archives } = await fetchJson<{ archives: string[] }>(
    `${CHESS_COM_API}/player/${username}/games/archives`
  );
  console.log(`Found ${archives.length} monthly archives`);

  const allGames: unknown[] = [];

  for (const archiveUrl of archives) {
    const { games } = await fetchJson<{ games: unknown[] }>(archiveUrl);
    const withPgn = games.filter(
      (g: unknown) => (g as { pgn?: string }).pgn
    );
    allGames.push(...withPgn);
    const month = archiveUrl.split("/").slice(-2).join("/");
    console.log(`  ${month}: ${withPgn.length} games`);
  }

  // Sort by end_time descending (newest first)
  allGames.sort(
    (a: unknown, b: unknown) =>
      ((b as { end_time: number }).end_time ?? 0) -
      ((a as { end_time: number }).end_time ?? 0)
  );

  console.log(`Total: ${allGames.length} games with PGN`);
  return allGames;
}

async function main() {
  const redis = getRedis();

  // Ensure output directory exists
  const outDir = path.join(process.cwd(), "scripts", "data");
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  for (const username of USERS) {
    const games = await fetchAllGames(username);

    // Store in Redis
    const key = `games:${username}`;
    await redis.set(key, games);
    console.log(`Wrote ${games.length} games to Redis key "${key}"`);

    // Write JSON file for analysis input
    const filePath = path.join(outDir, `${username}-games.json`);
    fs.writeFileSync(filePath, JSON.stringify(games, null, 2));
    console.log(`Wrote ${filePath}`);
  }

  console.log("\nDone! Game data stored in Redis and JSON files.");
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
```

- [ ] **Step 3: Load environment variables and run the script**

The script needs `KV_REST_API_URL` and `KV_REST_API_TOKEN` from `.env.local`. Run with:

```bash
npx dotenv -e .env.local -- npx tsx scripts/backfill-games.ts
```

If `dotenv-cli` is not installed, install it first:

```bash
npm install --save-dev dotenv-cli
```

Then re-run. Expected output:

```
--- Fetching games for castledoon ---
Found 2 monthly archives
  2026/03: X games
  2026/04: X games
Total: 41 games with PGN
Wrote 41 games to Redis key "games:castledoon"
Wrote scripts/data/castledoon-games.json

--- Fetching games for exstrax ---
Found 6 monthly archives
...
Total: 222 games with PGN
Wrote 222 games to Redis key "games:exstrax"
Wrote scripts/data/exstrax-games.json

Done! Game data stored in Redis and JSON files.
```

- [ ] **Step 4: Add `scripts/data/` to `.gitignore`**

Append to `.gitignore`:

```
# Backfill data (generated, large)
scripts/data/
```

- [ ] **Step 5: Commit**

```bash
git add scripts/backfill-games.ts .gitignore package.json package-lock.json
git commit -m "feat: add backfill-games script to fetch and cache all Chess.com games"
```

---

### Task 4: Create backfill-analysis.ts script

**Files:**
- Create: `scripts/backfill-analysis.ts`

This script reads pre-computed analysis JSON files (produced by Claude Code in-session) and writes each result to Redis using the same key format as `analysis-cache.ts`.

- [ ] **Step 1: Create the backfill-analysis script**

Create `scripts/backfill-analysis.ts`:

```typescript
import { Redis } from "@upstash/redis";
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";

const USERS = ["castledoon", "exstrax"];

function getRedis(): Redis {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    throw new Error(
      "Missing KV_REST_API_URL or KV_REST_API_TOKEN in environment"
    );
  }
  return new Redis({ url, token });
}

/**
 * Must match the cacheKey() function in src/lib/analysis-cache.ts
 * so the app finds these entries when checking the cache.
 */
function cacheKey(pgn: string): string {
  const moves = pgn
    .replace(/\[.*?\]\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const hash = createHash("sha256").update(moves).digest("hex").slice(0, 16);
  return `analysis:${hash}`;
}

interface GameWithAnalysis {
  pgn: string;
  analysis: unknown;
}

async function main() {
  const redis = getRedis();
  const TTL = 90 * 24 * 60 * 60; // 90 days, matches analysis-cache.ts
  const dataDir = path.join(process.cwd(), "scripts", "data");

  let totalWritten = 0;
  let totalSkipped = 0;

  for (const username of USERS) {
    const filePath = path.join(dataDir, `${username}-analysis.json`);
    if (!fs.existsSync(filePath)) {
      console.log(`No analysis file for ${username} at ${filePath} — skipping`);
      continue;
    }

    const entries: GameWithAnalysis[] = JSON.parse(
      fs.readFileSync(filePath, "utf-8")
    );
    console.log(`\n--- Writing analysis for ${username}: ${entries.length} games ---`);

    for (let i = 0; i < entries.length; i++) {
      const { pgn, analysis } = entries[i];
      const key = cacheKey(pgn);

      // Check if already cached
      const existing = await redis.get(key);
      if (existing) {
        totalSkipped++;
        continue;
      }

      await redis.set(key, analysis, { ex: TTL });
      totalWritten++;

      if ((i + 1) % 10 === 0) {
        console.log(`  [${i + 1}/${entries.length}] written...`);
      }
    }
  }

  console.log(`\nDone! Wrote ${totalWritten} analyses, skipped ${totalSkipped} (already cached).`);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Commit**

```bash
git add scripts/backfill-analysis.ts
git commit -m "feat: add backfill-analysis script to write pre-computed analysis to Redis"
```

---

### Task 5: Update games API route to check Redis first

**Files:**
- Modify: `src/app/api/games/[username]/route.ts`

- [ ] **Step 1: Update the route to check Redis before Chess.com**

Replace the entire contents of `src/app/api/games/[username]/route.ts` with:

```typescript
import { NextRequest } from "next/server";
import {
  fetchArchives,
  fetchGamesFromArchive,
  isAllowedUser,
} from "@/lib/chess-com";
import { getCachedGames, setCachedGames } from "@/lib/game-cache";
import { ChessComGame } from "@/lib/types";

const MAX_MONTHS = 3;
const MAX_GAMES = 100;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  const { username } = await params;

  if (!isAllowedUser(username)) {
    return Response.json({ error: "Player not available" }, { status: 403 });
  }

  const searchParams = request.nextUrl.searchParams;
  const months = Math.min(
    parseInt(searchParams.get("months") || String(MAX_MONTHS), 10),
    12
  );

  // Check Redis cache first
  const cached = await getCachedGames(username);
  if (cached) {
    // Apply the same month/game limits the client expects
    const cutoff = Date.now() / 1000 - months * 30 * 24 * 60 * 60;
    const filtered = cached
      .filter((g) => g.end_time >= cutoff)
      .slice(0, MAX_GAMES);
    return Response.json({ games: filtered });
  }

  try {
    const archives = await fetchArchives(username);

    if (archives.length === 0) {
      return Response.json({ games: [] });
    }

    const recentArchives = archives.slice(-months);

    const archiveResults = await Promise.all(
      recentArchives.map((url) => fetchGamesFromArchive(url))
    );

    const allGames: ChessComGame[] = archiveResults
      .flat()
      .filter((game) => game.pgn)
      .sort((a, b) => b.end_time - a.end_time)
      .slice(0, MAX_GAMES);

    // Cache miss — store in Redis for next time (fire-and-forget)
    setCachedGames(username, allGames);

    return Response.json({ games: allGames });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("404")) {
      return Response.json(
        { error: `Player "${username}" not found` },
        { status: 404 }
      );
    }
    return Response.json(
      { error: "Failed to fetch games" },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Verify the app still builds**

Run: `npx next build`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/games/[username]/route.ts
git commit -m "feat: check Redis cache before hitting Chess.com API for games"
```

---

### Task 6: Run the full backfill

This task is executed manually in the Claude Code session, not by a script.

- [ ] **Step 1: Run backfill-games.ts to fetch all games and store in Redis**

```bash
npx dotenv -e .env.local -- npx tsx scripts/backfill-games.ts
```

Verify: JSON files created at `scripts/data/castledoon-games.json` and `scripts/data/exstrax-games.json`.

- [ ] **Step 2: Claude Code analyzes all games in-session**

Claude Code reads each game's PGN from the JSON files, analyzes them (using subagents in parallel for speed), and produces analysis JSON files at:
- `scripts/data/castledoon-analysis.json`
- `scripts/data/exstrax-analysis.json`

Each file is an array of `{ pgn: string, analysis: AnalysisResult }` objects.

- [ ] **Step 3: Run backfill-analysis.ts to write analysis results to Redis**

```bash
npx dotenv -e .env.local -- npx tsx scripts/backfill-analysis.ts
```

Expected: All 263 analysis results written to Redis.

- [ ] **Step 4: Verify by starting the app and browsing a game**

```bash
npm run dev
```

Navigate to a game for either user — it should load the analysis instantly from Redis without calling the Claude API.
