# Redis Game & Analysis Backfill

**Date:** 2026-04-02
**Status:** Approved

## Goal

Pre-populate Redis with all historical Chess.com game data and Claude coaching analysis for both app users (CastleDoon, exstrax), eliminating repeated Chess.com API calls and enabling instant analysis access for all historical games.

## Scale

- **CastleDoon:** 2 monthly archives, 41 games
- **exstrax:** 6 monthly archives, 222 games
- **Total:** 263 games

## Approach: In-Session Analysis + CLI Script

Analysis is performed by Claude Code within the Max plan conversation (zero API cost). A CLI script handles Chess.com fetching and Redis writes.

## Architecture

### Redis Key Schema

| Key Pattern | Value | TTL |
|---|---|---|
| `games:{username}` | `ChessComGame[]` — full game array for user | None (permanent) |
| `analysis:{sha256hash}` | `AnalysisResult` — coaching analysis | 90 days (matches existing) |

The `analysis:` key format already exists in `src/lib/analysis-cache.ts` and is used by the app's analyze route. The backfill writes to the same keys so the app picks them up transparently.

### New Files

| File | Purpose |
|---|---|
| `scripts/backfill-games.ts` | Fetch all games from Chess.com, store in Redis |
| `scripts/backfill-analysis.ts` | Write pre-computed analysis results to Redis |
| `src/lib/game-cache.ts` | `getCachedGames()` / `setCachedGames()` helpers |

### Modified Files

| File | Change |
|---|---|
| `src/lib/analysis-cache.ts` | Export `getRedis()` for reuse by game-cache and scripts |
| `src/app/api/games/[username]/route.ts` | Check Redis for cached games before hitting Chess.com API |

## Workflow

### Phase 1: Fetch & Store Games

1. Run `scripts/backfill-games.ts`
2. Script fetches ALL archives for both users (no month limit)
3. Downloads every archive's games, filters to those with PGN
4. Writes full game arrays to Redis under `games:{username}`
5. Outputs all games as JSON files for analysis input

### Phase 2: Analyze Games (In-Session)

1. Claude Code reads game PGNs from the JSON output
2. Claude Code analyzes each game producing `AnalysisResult` JSON
3. Subagents run in parallel to process batches concurrently
4. Results collected into a JSON file per user

### Phase 3: Write Analysis to Redis

1. Run `scripts/backfill-analysis.ts` with the analysis JSON files
2. Script writes each result to Redis using the same `analysis:{hash}` key format
3. Skips any games that already have cached analysis

### Phase 4: Update Games API Route

1. Modify `games/[username]/route.ts` to check `games:{username}` in Redis first
2. Fall back to Chess.com API on cache miss
3. On cache miss, write fetched games to Redis for future requests

## Data Flow

```
Chess.com API → backfill-games.ts → Redis (games:{username})
                                   → games.json (for analysis input)

games.json → Claude Code (Max plan) → analysis-results.json

analysis-results.json → backfill-analysis.ts → Redis (analysis:{hash})

App request → games route → Redis (cache hit) → response
                          → Chess.com API (cache miss) → Redis (store) → response

App request → analyze route → Redis (cache hit from backfill) → response
```

## Key Decisions

- **No API cost for analysis:** All Claude analysis happens in the Max plan conversation, not via Anthropic API calls
- **Same cache keys:** Backfill writes to the same Redis keys the app already reads, so no app changes needed for analysis
- **Permanent game storage:** Game data doesn't expire (historical games don't change)
- **90-day analysis TTL:** Matches existing `analysis-cache.ts` behavior
- **Resumable:** Scripts check for existing cache entries before writing
