# Chess Coach Web App — Design Spec

## Context

A mobile-first web app hosted on Vercel that analyzes Chess.com games and provides AI-powered coaching feedback. Any Chess.com user can enter their username and get personalized game analysis. The app uses Claude (Anthropic API) to review PGN data and deliver natural-language coaching in an encouraging mentor tone.

## Tech Stack

- **Framework**: Next.js 14+ (App Router)
- **Styling**: Tailwind CSS (mobile-first)
- **Deployment**: Vercel
- **LLM**: Anthropic Claude API (Sonnet for analysis)
- **Data source**: Chess.com Public API (no auth required)
- **Database**: None — all data fetched live, analysis cached in localStorage

## App Structure

### Pages

1. **Home / Search** (`/`)
   - Username input field
   - On submit: fetch player profile + stats from Chess.com API
   - Display player card: avatar, username, ratings by game type
   - "Analyze Games" button → navigates to game list

2. **Game List** (`/games/[username]`)
   - Fetches recent games from Chess.com monthly archives
   - Displays all game types with filter tabs (All, Bullet, Blitz, Rapid, Daily) — Rapid selected by default
   - Each game row shows: opponent name, result (W/L/D with color), date, time control, rating change
   - Tap a game → navigates to analysis view

3. **Game Analysis** (`/analysis/[username]?game=[url-encoded-game-url]`)
   - Game identified by its Chess.com game URL (unique per game)
   - Sends game PGN to Claude API via Next.js route handler
   - Displays structured coaching feedback (see Analysis Output below)
   - Loading state: skeleton UI with "Coach is reviewing your game..." message

### Future Pages (v2+)

- **Dashboard** (`/dashboard/[username]`) — rating trends, accuracy over time, performance by time of day
- **Openings** (`/openings/[username]`) — win rates by opening, repertoire suggestions

## API Routes (Next.js Route Handlers)

### `GET /api/player/[username]`
- Proxies two Chess.com endpoints:
  - `https://api.chess.com/pub/player/{username}` — profile
  - `https://api.chess.com/pub/player/{username}/stats` — ratings and records
- Returns combined player data
- Includes `User-Agent` header per Chess.com guidelines

### `GET /api/games/[username]`
- Fetches `https://api.chess.com/pub/player/{username}/games/archives` to get archive list
- Fetches the most recent 1-2 monthly archives
- Returns games array with: PGN, time_class, players, result, date, ratings
- Query param: `?type=rapid|blitz|bullet|daily|all` (default: `all`)

### `POST /api/analyze`
- Request body: `{ pgn, username, rating, timeControl, result }`
- Sends structured prompt + PGN to Claude API
- Returns structured JSON analysis
- API key stored as `ANTHROPIC_API_KEY` Vercel environment variable

## Analysis Prompt Design

### Input to Claude
- Full PGN of the game
- Player's username (to identify which side to coach)
- Player's current rating (to calibrate feedback level)
- Game result and time control

### System Prompt Behavior
- Encouraging mentor tone: lead with strengths, frame improvements as opportunities
- Calibrate complexity of suggestions to the player's rating level
- Be specific — reference exact move numbers and positions

### Output Structure (JSON)
Claude returns structured JSON with these sections:

```json
{
  "opening": {
    "name": "Queen's Gambit Declined",
    "assessment": "good|inaccurate|dubious",
    "comment": "Solid choice. You developed pieces naturally..."
  },
  "criticalMoments": [
    {
      "moveNumber": 14,
      "move": "Nxe5",
      "type": "blunder|mistake|excellent|missed_tactic",
      "comment": "This loses a piece. Better was Bd3...",
      "suggestion": "Bd3"
    }
  ],
  "positionalThemes": "Discussion of pawn structure, piece activity, king safety...",
  "endgame": {
    "reached": true,
    "comment": "Good technique converting the rook endgame..."
  },
  "summary": {
    "overallAssessment": "2-3 sentence coaching summary",
    "focusArea": "One concrete thing to work on"
  }
}
```

## Mobile UX

- **Dark theme** by default (matches Chess.com aesthetic)
- **Touch-friendly**: large tap targets (min 44px), no hover-dependent interactions
- **Bottom navigation**: thumb-friendly on phone
- **Filter tabs**: game type filters at top of game list
- **Loading states**: skeleton UI during API calls
- **Responsive layout**: single-column on iPhone, two-column on iPad landscape
- **localStorage caching**: previously analyzed games don't re-call Claude API

## Data Flow

```
1. User enters Chess.com username on home page
2. App calls /api/player/[username] → Chess.com API → player card displayed
3. User taps "Analyze Games" → navigates to /games/[username]
4. App calls /api/games/[username] → Chess.com API → game list displayed
5. User taps a game → navigates to /analysis/[username]/[gameId]
6. App calls POST /api/analyze with PGN → Claude API → coaching displayed
7. Analysis result cached in localStorage for future visits
```

## Cost Estimate

- ~2-4K input tokens per game (PGN + system prompt)
- ~1-2K output tokens per analysis
- ~$0.01-0.02 per game at Claude Sonnet pricing
- No database costs, no additional infrastructure

## Environment Variables

- `ANTHROPIC_API_KEY` — Claude API key (Vercel env var, not committed)
