# Chess Coach

A mobile-first chess coaching app for Chess.com games. Runs Stockfish WASM
in the browser for objective evaluations, then asks Claude for coaching
commentary grounded in those evals.

## How it works

1. **Games** are fetched from the Chess.com public API and cached in
   Upstash Redis (past months forever, current month for 5 minutes).
2. **Engine analysis** runs client-side in a Web Worker
   (`public/stockfish.wasm.js`, depth 16). All scores are normalized to
   white-POV at parse time (`src/lib/engine-core.ts`).
3. **Coaching** — `/api/analyze` recomputes eval drops server-side, sends
   PGN + evals to Claude, validates the JSON response with zod, verifies
   every suggested move is legal, and caches the result in Redis for 90 days.
4. **Meta coaching** (`/meta/[username]`) is generated offline by
   `scripts/backfill-meta.ts` and served read-only.

Access is limited to the users in `ALLOWED_USERS` (`src/lib/chess-com.ts`).

## Setup

```bash
npm install
```

Create `.env.local`:

```
ANTHROPIC_API_KEY=sk-ant-...
KV_REST_API_URL=https://...upstash.io
KV_REST_API_TOKEN=...
```

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server (use `npm run dev -- -H 0.0.0.0` for LAN/mobile testing) |
| `npm run build` / `npm start` | Production build / serve |
| `npm test` | Run the vitest suite |
| `npx dotenv-cli -e .env.local -- npx tsx scripts/batch-analyze.ts` | Engine-analyze all uncached games ($0 API cost), then refresh meta analysis |
| `npx dotenv-cli -e .env.local -- npx tsx scripts/batch-analyze.ts --force-days N` | Re-analyze games from the last N days even if cached |
| `npx dotenv-cli -e .env.local -- npx tsx scripts/backfill-meta.ts --force` | Regenerate the meta coaching report (uses Claude) |

## Architecture notes

- `src/lib/engine-core.ts` — single source of truth for UCI parsing,
  white-POV normalization, eval-drop detection, and missed-mate-in-1
  detection. Used by the browser path, the API route, and the batch script.
- Analyses in Redis carry `source: "claude" | "batch"` and
  `analysisVersion` so the two writers are distinguishable.
- Caches: localStorage (`analysis-v2:` 7d, `engine-eval-v2:` 30d),
  Redis (`analysis:<pgn-hash>` 90d, game archives).
