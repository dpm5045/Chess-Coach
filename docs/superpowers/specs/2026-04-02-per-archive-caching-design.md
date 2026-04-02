# Per-Archive Game Caching with 5-min TTL

**Date:** 2026-04-02
**Status:** Approved

## Goal

Replace the single `games:{username}` Redis key with per-archive keys so that only the current month is re-fetched (every 5 minutes). Past months are cached permanently, reducing Chess.com API calls from N to 2 per refresh.

## Redis Key Schema

| Key Pattern | Value | TTL |
|---|---|---|
| `archives:{username}` | `string[]` — list of archive URLs | 5 minutes |
| `games:{username}:{year}/{month}` | `ChessComGame[]` — games for that month | Permanent (past months) or 5 minutes (current month) |

The old `games:{username}` key is no longer used.

## Changes

### `src/lib/game-cache.ts` (rewrite)

- `gamesArchiveKey(username, year, month)` — returns `games:{username}:{year}/{month}`
- `archivesKey(username)` — returns `archives:{username}`
- `isCurrentMonth(year, month)` — returns true if the year/month matches today
- `getCachedArchiveList(username)` — read archive URL list from Redis
- `setCachedArchiveList(username, archives)` — write with 5-min TTL
- `getCachedArchiveGames(username, year, month)` — read one month's games
- `setCachedArchiveGames(username, year, month, games)` — write with 5-min TTL if current month, no TTL if past
- `getAllGames(username, months)` — main entry point:
  1. Get archive list (from Redis or Chess.com)
  2. Slice to requested month count
  3. For each archive, check Redis; on miss, fetch from Chess.com and cache
  4. Combine, filter (must have PGN), sort by end_time desc, return

### `src/app/api/games/[username]/route.ts`

- Replace current logic with a call to `getAllGames(username, months)`
- Apply `MAX_GAMES` limit on the result
- Remove direct Chess.com API calls from the route

### `scripts/backfill-games.ts`

- Write per-archive keys (`games:{username}:{year}/{month}`) instead of single key
- Delete the old `games:{username}` key if it exists

### `src/lib/analysis-cache.ts`

- No changes (already exports `getRedis()`)

## Data Flow

```
App request for games
  → getAllGames(username, months)
    → getCachedArchiveList(username)
      → Redis hit? Use it
      → Redis miss? Fetch from Chess.com, cache with 5-min TTL
    → For each archive in range:
      → getCachedArchiveGames(username, year, month)
        → Redis hit? Use it
        → Redis miss? Fetch from Chess.com, cache:
          → Past month: permanent
          → Current month: 5-min TTL
    → Combine all months, filter, sort, return
```

## API Call Budget

| Scenario | Chess.com API Calls |
|---|---|
| All cached (within 5 min) | 0 |
| Cache expired (typical refresh) | 2 (archive list + current month) |
| Cold start (no cache at all) | 1 + N (archive list + N month archives) |
| After backfill | 0 until current month expires |
