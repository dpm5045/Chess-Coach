# Chess Coach Web App — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a mobile-first web app that analyzes Chess.com games and provides AI coaching via Claude API.

**Architecture:** Next.js 14+ App Router deployed on Vercel. Three pages (Home, Game List, Analysis) backed by three API routes that proxy Chess.com public API and Claude. No database — all data fetched live, analysis cached in localStorage.

**Tech Stack:** Next.js, TypeScript, Tailwind CSS, @anthropic-ai/sdk, Vercel

**Spec:** `docs/superpowers/specs/2026-04-01-chess-coach-design.md`

---

## File Structure

```
src/
  app/
    layout.tsx                        # Root layout: dark theme, fonts, bottom nav
    page.tsx                          # Home: username input + player card
    globals.css                       # Tailwind directives + dark theme vars
    games/
      [username]/
        page.tsx                      # Game list with filter tabs
    analysis/
      [username]/
        page.tsx                      # Claude analysis view
    api/
      player/
        [username]/
          route.ts                    # GET: Chess.com profile + stats
      games/
        [username]/
          route.ts                    # GET: recent game archives
      analyze/
        route.ts                      # POST: PGN → Claude → coaching JSON
  lib/
    types.ts                          # All TypeScript types
    chess-com.ts                      # Chess.com API client
    claude.ts                         # Claude prompt + API call
    utils.ts                          # Result helpers, date formatting
  components/
    player-card.tsx                   # Player profile display
    game-list-item.tsx                # Single game row
    game-filter-tabs.tsx              # Time class filter tabs
    analysis-view.tsx                 # Renders coaching cards
    bottom-nav.tsx                    # Mobile bottom navigation
    loading-skeleton.tsx              # Skeleton placeholders
  hooks/
    use-cached-analysis.ts            # localStorage cache for analysis
```

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`, `next.config.ts`, `tailwind.config.ts`, `src/app/layout.tsx`, `src/app/globals.css`, `src/app/page.tsx`, `src/lib/types.ts`, `.env.local`, `.gitignore`

- [ ] **Step 1: Initialize Next.js project**

Run:
```bash
cd C:/Users/dpm50/Documents/Claude-Code/Chess
npx create-next-app@latest . --typescript --tailwind --app --src-dir --no-eslint --import-alias "@/*" --use-npm
```
Expected: Project scaffolded with `src/app/` structure.

- [ ] **Step 2: Install Anthropic SDK**

Run:
```bash
cd C:/Users/dpm50/Documents/Claude-Code/Chess
npm install @anthropic-ai/sdk
```

- [ ] **Step 3: Create environment file**

Create `.env.local`:
```
ANTHROPIC_API_KEY=your-key-here
```

- [ ] **Step 4: Define TypeScript types**

Create `src/lib/types.ts`:

```typescript
// Chess.com API types

export interface ChessComPlayer {
  player_id: number;
  username: string;
  url: string;
  avatar?: string;
  name?: string;
  title?: string;
  country: string;
  last_online: number;
  joined: number;
  status: string;
  league?: string;
  followers?: number;
  is_streamer?: boolean;
}

export interface RatingRecord {
  last?: { rating: number; date: number; rd: number };
  best?: { rating: number; date: number; rd?: number };
  wins: number;
  losses: number;
  draws: number;
  games: number;
}

export interface ChessComStats {
  chess_rapid?: RatingRecord;
  chess_blitz?: RatingRecord;
  chess_bullet?: RatingRecord;
  chess_daily?: RatingRecord;
}

export type GameResult =
  | "win"
  | "resigned"
  | "checkmated"
  | "timeout"
  | "stalemate"
  | "insufficient"
  | "repetition"
  | "agreed"
  | "abandoned"
  | "timevsinsufficient"
  | "50move"
  | (string & {});

export interface PlayerResult {
  username: string;
  rating: number;
  result: GameResult;
  "@id": string;
  uuid: string;
}

export interface ChessComGame {
  url: string;
  pgn: string;
  uuid: string;
  time_class: TimeClass;
  time_control: string;
  rated: boolean;
  rules: string;
  white: PlayerResult;
  black: PlayerResult;
  end_time: number;
  initial_setup?: string;
  fen?: string;
}

export type TimeClass = "bullet" | "blitz" | "rapid" | "daily";

export interface PlayerProfile {
  profile: ChessComPlayer;
  stats: ChessComStats;
}

// Analysis types

export interface AnalysisResult {
  opening: {
    name: string;
    assessment: "good" | "inaccurate" | "dubious";
    comment: string;
  };
  criticalMoments: CriticalMoment[];
  positionalThemes: string;
  endgame: {
    reached: boolean;
    comment: string;
  };
  summary: {
    overallAssessment: string;
    focusArea: string;
  };
}

export interface CriticalMoment {
  moveNumber: number;
  move: string;
  type: "blunder" | "mistake" | "excellent" | "missed_tactic";
  comment: string;
  suggestion?: string;
}
```

- [ ] **Step 5: Configure dark theme in Tailwind**

Replace the contents of `tailwind.config.ts`:

```typescript
import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "#0f1419",
          card: "#1a1f2e",
          elevated: "#242b3d",
        },
        accent: {
          green: "#4CAF50",
          red: "#f44336",
          yellow: "#FFD700",
          orange: "#FF9800",
          blue: "#2196F3",
        },
      },
    },
  },
  plugins: [],
};
export default config;
```

- [ ] **Step 6: Set up global CSS**

Replace `src/app/globals.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  background-color: #0f1419;
  color: #e0e0e0;
}
```

- [ ] **Step 7: Set up root layout**

Replace `src/app/layout.tsx`:

```tsx
import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chess Coach",
  description: "AI-powered coaching for your Chess.com games",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-surface text-gray-200 antialiased">
        <main className="pb-20">{children}</main>
      </body>
    </html>
  );
}
```

- [ ] **Step 8: Create placeholder home page**

Replace `src/app/page.tsx`:

```tsx
export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <h1 className="text-2xl font-bold">♟ Chess Coach</h1>
    </div>
  );
}
```

- [ ] **Step 9: Verify build**

Run:
```bash
cd C:/Users/dpm50/Documents/Claude-Code/Chess
npm run build
```
Expected: Build succeeds with no errors.

- [ ] **Step 10: Initialize git and commit**

Run:
```bash
cd C:/Users/dpm50/Documents/Claude-Code/Chess
git init
git add -A
git commit -m "feat: initialize Next.js project with types and dark theme"
```

---

### Task 2: Chess.com API Client + Player Route

**Files:**
- Create: `src/lib/chess-com.ts`, `src/app/api/player/[username]/route.ts`

- [ ] **Step 1: Create Chess.com API client**

Create `src/lib/chess-com.ts`:

```typescript
import { ChessComPlayer, ChessComStats, ChessComGame } from "./types";

const CHESS_COM_API = "https://api.chess.com/pub";
const HEADERS = {
  "User-Agent": "ChessCoach/1.0 (github.com/chess-coach)",
  Accept: "application/json",
};

async function chessComFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${CHESS_COM_API}${path}`, { headers: HEADERS });
  if (!res.ok) {
    throw new Error(`Chess.com API error: ${res.status} for ${path}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchPlayer(username: string): Promise<ChessComPlayer> {
  return chessComFetch<ChessComPlayer>(`/player/${username.toLowerCase()}`);
}

export async function fetchStats(username: string): Promise<ChessComStats> {
  return chessComFetch<ChessComStats>(`/player/${username.toLowerCase()}/stats`);
}

export async function fetchArchives(username: string): Promise<string[]> {
  const data = await chessComFetch<{ archives: string[] }>(
    `/player/${username.toLowerCase()}/games/archives`
  );
  return data.archives;
}

export async function fetchGamesFromArchive(
  archiveUrl: string
): Promise<ChessComGame[]> {
  const res = await fetch(archiveUrl, { headers: HEADERS });
  if (!res.ok) {
    throw new Error(`Chess.com archive error: ${res.status}`);
  }
  const data = (await res.json()) as { games: ChessComGame[] };
  return data.games;
}
```

- [ ] **Step 2: Create player API route**

Create `src/app/api/player/[username]/route.ts`:

```typescript
import { NextRequest } from "next/server";
import { fetchPlayer, fetchStats } from "@/lib/chess-com";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  const { username } = await params;

  try {
    const [profile, stats] = await Promise.all([
      fetchPlayer(username),
      fetchStats(username),
    ]);

    return Response.json({ profile, stats });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("404")) {
      return Response.json(
        { error: `Player "${username}" not found on Chess.com` },
        { status: 404 }
      );
    }
    return Response.json(
      { error: "Failed to fetch player data" },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 3: Verify route works**

Run:
```bash
cd C:/Users/dpm50/Documents/Claude-Code/Chess
npm run dev &
sleep 3
curl http://localhost:3000/api/player/MasterPlanDaniel
```
Expected: JSON response with `profile` and `stats` fields.

- [ ] **Step 4: Commit**

```bash
git add src/lib/chess-com.ts src/app/api/player/\[username\]/route.ts
git commit -m "feat: add Chess.com API client and player profile route"
```

---

### Task 3: Games Route

**Files:**
- Create: `src/app/api/games/[username]/route.ts`

- [ ] **Step 1: Create games API route**

Create `src/app/api/games/[username]/route.ts`:

```typescript
import { NextRequest } from "next/server";
import { fetchArchives, fetchGamesFromArchive } from "@/lib/chess-com";
import { ChessComGame } from "@/lib/types";

const MAX_MONTHS = 3;
const MAX_GAMES = 100;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  const { username } = await params;
  const searchParams = request.nextUrl.searchParams;
  const months = Math.min(
    parseInt(searchParams.get("months") || String(MAX_MONTHS), 10),
    12
  );

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

- [ ] **Step 2: Verify route works**

Run:
```bash
curl "http://localhost:3000/api/games/MasterPlanDaniel"
```
Expected: JSON with `games` array containing recent games with `pgn`, `time_class`, `white`, `black` fields.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/games/\[username\]/route.ts
git commit -m "feat: add games route with recent-archives pagination"
```

---

### Task 4: Utility Functions

**Files:**
- Create: `src/lib/utils.ts`

- [ ] **Step 1: Create utility functions**

Create `src/lib/utils.ts`:

```typescript
import { ChessComGame, GameResult } from "./types";

const WIN_RESULTS: GameResult[] = ["win"];
const DRAW_RESULTS: GameResult[] = [
  "stalemate",
  "insufficient",
  "repetition",
  "agreed",
  "50move",
  "timevsinsufficient",
];

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
): "win" | "loss" | "draw" {
  const color = getPlayerColor(game, username);
  const result = game[color].result;
  if (WIN_RESULTS.includes(result)) return "win";
  if (DRAW_RESULTS.includes(result)) return "draw";
  return "loss";
}

export function getOpponent(
  game: ChessComGame,
  username: string
): { username: string; rating: number } {
  const color = getPlayerColor(game, username);
  const opp = color === "white" ? game.black : game.white;
  return { username: opp.username, rating: opp.rating };
}

export function getRatingChange(
  game: ChessComGame,
  username: string
): string {
  const outcome = getPlayerOutcome(game, username);
  if (outcome === "win") return "+";
  if (outcome === "loss") return "-";
  return "=";
}

export function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatTimeControl(tc: string): string {
  const parts = tc.split("+");
  const base = parseInt(parts[0], 10);
  const increment = parts[1] ? parseInt(parts[1], 10) : 0;

  if (base < 60) return `${base}s${increment ? `+${increment}` : ""}`;
  const minutes = Math.floor(base / 60);
  return `${minutes}${increment ? `+${increment}` : ""}`;
}

export function outcomeColor(outcome: "win" | "loss" | "draw"): string {
  switch (outcome) {
    case "win":
      return "text-accent-green";
    case "loss":
      return "text-accent-red";
    case "draw":
      return "text-accent-yellow";
  }
}

export function outcomeLabel(outcome: "win" | "loss" | "draw"): string {
  switch (outcome) {
    case "win":
      return "WIN";
    case "loss":
      return "LOSS";
    case "draw":
      return "DRAW";
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/utils.ts
git commit -m "feat: add game utility functions"
```

---

### Task 5: Home Page — Username Input + Player Card

**Files:**
- Create: `src/components/player-card.tsx`, `src/components/loading-skeleton.tsx`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Create loading skeleton component**

Create `src/components/loading-skeleton.tsx`:

```tsx
export function PlayerCardSkeleton() {
  return (
    <div className="animate-pulse rounded-xl bg-surface-card p-4">
      <div className="flex items-center gap-4">
        <div className="h-16 w-16 rounded-full bg-surface-elevated" />
        <div className="flex-1 space-y-2">
          <div className="h-5 w-32 rounded bg-surface-elevated" />
          <div className="h-4 w-24 rounded bg-surface-elevated" />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-12 rounded bg-surface-elevated" />
        ))}
      </div>
    </div>
  );
}

export function GameListSkeleton() {
  return (
    <div className="animate-pulse space-y-2">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="h-16 rounded-lg bg-surface-card" />
      ))}
    </div>
  );
}

export function AnalysisSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-24 rounded-xl bg-surface-card" />
      <div className="h-32 rounded-xl bg-surface-card" />
      <div className="h-20 rounded-xl bg-surface-card" />
      <div className="h-28 rounded-xl bg-surface-card" />
    </div>
  );
}
```

- [ ] **Step 2: Create player card component**

Create `src/components/player-card.tsx`:

```tsx
import { PlayerProfile, RatingRecord, TimeClass } from "@/lib/types";

const TIME_CLASS_LABELS: Record<string, string> = {
  chess_rapid: "Rapid",
  chess_blitz: "Blitz",
  chess_bullet: "Bullet",
  chess_daily: "Daily",
};

function RatingStat({ label, record }: { label: string; record: RatingRecord }) {
  return (
    <div className="rounded-lg bg-surface-elevated px-3 py-2">
      <div className="text-xs text-gray-400">{label}</div>
      <div className="text-lg font-bold">{record.last?.rating ?? "—"}</div>
      <div className="text-xs text-gray-500">
        <span className="text-accent-green">{record.wins}W</span>{" "}
        <span className="text-accent-red">{record.losses}L</span>{" "}
        <span className="text-gray-400">{record.draws}D</span>
      </div>
    </div>
  );
}

export function PlayerCard({ data }: { data: PlayerProfile }) {
  const { profile, stats } = data;

  const ratingEntries = Object.entries(TIME_CLASS_LABELS)
    .filter(([key]) => stats[key as keyof typeof stats])
    .map(([key, label]) => ({
      label,
      record: stats[key as keyof typeof stats] as RatingRecord,
    }));

  return (
    <div className="rounded-xl bg-surface-card p-4">
      <div className="flex items-center gap-4">
        {profile.avatar ? (
          <img
            src={profile.avatar}
            alt={profile.username}
            className="h-16 w-16 rounded-full"
          />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-elevated text-2xl">
            ♟
          </div>
        )}
        <div>
          <div className="flex items-center gap-2">
            {profile.title && (
              <span className="rounded bg-accent-yellow px-1.5 py-0.5 text-xs font-bold text-black">
                {profile.title}
              </span>
            )}
            <span className="text-lg font-bold">{profile.username}</span>
          </div>
          <div className="text-sm text-gray-400">
            {profile.league && `${profile.league} League • `}
            {profile.status}
          </div>
        </div>
      </div>

      {ratingEntries.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          {ratingEntries.map(({ label, record }) => (
            <RatingStat key={label} label={label} record={record} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Build home page with search**

Replace `src/app/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PlayerProfile } from "@/lib/types";
import { PlayerCard } from "@/components/player-card";
import { PlayerCardSkeleton } from "@/components/loading-skeleton";

export default function Home() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [playerData, setPlayerData] = useState<PlayerProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim()) return;

    setLoading(true);
    setError(null);
    setPlayerData(null);

    try {
      const res = await fetch(`/api/player/${encodeURIComponent(username.trim())}`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Player not found");
      }
      const data: PlayerProfile = await res.json();
      setPlayerData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 pt-12">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold">♟ Chess Coach</h1>
        <p className="mt-2 text-gray-400">
          AI-powered analysis for your Chess.com games
        </p>
      </div>

      <form onSubmit={handleSearch} className="mb-6">
        <div className="flex gap-2">
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Chess.com username"
            className="flex-1 rounded-lg bg-surface-card px-4 py-3 text-gray-200 placeholder-gray-500 outline-none ring-1 ring-gray-700 focus:ring-accent-blue"
          />
          <button
            type="submit"
            disabled={loading || !username.trim()}
            className="rounded-lg bg-accent-blue px-6 py-3 font-semibold text-white disabled:opacity-50"
          >
            {loading ? "..." : "Search"}
          </button>
        </div>
      </form>

      {error && (
        <div className="mb-4 rounded-lg bg-red-900/30 px-4 py-3 text-accent-red">
          {error}
        </div>
      )}

      {loading && <PlayerCardSkeleton />}

      {playerData && (
        <div className="space-y-4">
          <PlayerCard data={playerData} />
          <button
            onClick={() =>
              router.push(`/games/${encodeURIComponent(playerData.profile.username)}`)
            }
            className="w-full rounded-lg bg-accent-green py-3 text-lg font-semibold text-white"
          >
            View Games
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Verify home page works**

Run:
```bash
cd C:/Users/dpm50/Documents/Claude-Code/Chess
npm run dev
```
Open browser, enter "MasterPlanDaniel", verify player card appears with ratings.

- [ ] **Step 5: Commit**

```bash
git add src/app/page.tsx src/components/player-card.tsx src/components/loading-skeleton.tsx
git commit -m "feat: add home page with username search and player card"
```

---

### Task 6: Game List Page

**Files:**
- Create: `src/components/game-filter-tabs.tsx`, `src/components/game-list-item.tsx`, `src/app/games/[username]/page.tsx`

- [ ] **Step 1: Create filter tabs component**

Create `src/components/game-filter-tabs.tsx`:

```tsx
import { TimeClass } from "@/lib/types";

type FilterOption = TimeClass | "all";

const FILTERS: { label: string; value: FilterOption }[] = [
  { label: "All", value: "all" },
  { label: "Rapid", value: "rapid" },
  { label: "Blitz", value: "blitz" },
  { label: "Bullet", value: "bullet" },
  { label: "Daily", value: "daily" },
];

export function GameFilterTabs({
  selected,
  onSelect,
}: {
  selected: FilterOption;
  onSelect: (filter: FilterOption) => void;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-2">
      {FILTERS.map(({ label, value }) => (
        <button
          key={value}
          onClick={() => onSelect(value)}
          className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors ${
            selected === value
              ? "bg-accent-blue text-white"
              : "bg-surface-card text-gray-400 hover:text-gray-200"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create game list item component**

Create `src/components/game-list-item.tsx`:

```tsx
import { ChessComGame } from "@/lib/types";
import {
  getOpponent,
  getPlayerOutcome,
  getPlayerColor,
  formatDate,
  formatTimeControl,
  outcomeColor,
  outcomeLabel,
} from "@/lib/utils";

export function GameListItem({
  game,
  username,
  onClick,
}: {
  game: ChessComGame;
  username: string;
  onClick: () => void;
}) {
  const opponent = getOpponent(game, username);
  const outcome = getPlayerOutcome(game, username);
  const color = getPlayerColor(game, username);

  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-lg bg-surface-card px-4 py-3 text-left transition-colors active:bg-surface-elevated"
    >
      <div className="flex items-center gap-3">
        <div
          className={`h-3 w-3 rounded-full ${
            color === "white"
              ? "border border-gray-400 bg-white"
              : "bg-gray-800 border border-gray-600"
          }`}
        />
        <div>
          <div className="font-medium">
            vs {opponent.username}{" "}
            <span className="text-sm text-gray-500">({opponent.rating})</span>
          </div>
          <div className="text-xs text-gray-500">
            {formatDate(game.end_time)} · {formatTimeControl(game.time_control)}
          </div>
        </div>
      </div>
      <div className={`text-right font-bold ${outcomeColor(outcome)}`}>
        {outcomeLabel(outcome)}
      </div>
    </button>
  );
}
```

- [ ] **Step 3: Create game list page**

Create `src/app/games/[username]/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ChessComGame, TimeClass } from "@/lib/types";
import { GameFilterTabs } from "@/components/game-filter-tabs";
import { GameListItem } from "@/components/game-list-item";
import { GameListSkeleton } from "@/components/loading-skeleton";

type FilterOption = TimeClass | "all";

export default function GamesPage() {
  const params = useParams<{ username: string }>();
  const router = useRouter();
  const username = decodeURIComponent(params.username);

  const [games, setGames] = useState<ChessComGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterOption>("rapid");

  useEffect(() => {
    async function loadGames() {
      try {
        const res = await fetch(`/api/games/${encodeURIComponent(username)}`);
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to load games");
        }
        const data = await res.json();
        setGames(data.games);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setLoading(false);
      }
    }
    loadGames();
  }, [username]);

  const filteredGames =
    filter === "all"
      ? games
      : games.filter((g) => g.time_class === filter);

  function handleGameClick(game: ChessComGame) {
    sessionStorage.setItem("selectedGame", JSON.stringify(game));
    router.push(
      `/analysis/${encodeURIComponent(username)}?game=${encodeURIComponent(game.url)}`
    );
  }

  return (
    <div className="mx-auto max-w-lg px-4 pt-6">
      <button
        onClick={() => router.push("/")}
        className="mb-4 text-sm text-gray-400"
      >
        ← Back to search
      </button>

      <h1 className="mb-1 text-xl font-bold">{username}</h1>
      <p className="mb-4 text-sm text-gray-400">
        {games.length} games loaded
      </p>

      <GameFilterTabs selected={filter} onSelect={setFilter} />

      <div className="mt-4 space-y-2">
        {loading && <GameListSkeleton />}

        {error && (
          <div className="rounded-lg bg-red-900/30 px-4 py-3 text-accent-red">
            {error}
          </div>
        )}

        {!loading && !error && filteredGames.length === 0 && (
          <div className="py-8 text-center text-gray-500">
            No {filter === "all" ? "" : filter} games found in the last 3 months.
          </div>
        )}

        {filteredGames.map((game) => (
          <GameListItem
            key={game.uuid}
            game={game}
            username={username}
            onClick={() => handleGameClick(game)}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify game list works**

Open browser to `http://localhost:3000`. Search "MasterPlanDaniel", click "View Games". Verify game list appears with filter tabs.

- [ ] **Step 5: Commit**

```bash
git add src/components/game-filter-tabs.tsx src/components/game-list-item.tsx src/app/games/\[username\]/page.tsx
git commit -m "feat: add game list page with filter tabs"
```

---

### Task 7: Claude Analysis Route

**Files:**
- Create: `src/lib/claude.ts`, `src/app/api/analyze/route.ts`

- [ ] **Step 1: Create Claude analysis module**

Create `src/lib/claude.ts`:

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { AnalysisResult } from "./types";

const client = new Anthropic();

const SYSTEM_PROMPT = `You are an encouraging chess coach analyzing a student's game. Your tone is warm and supportive — always lead with what the player did well before discussing mistakes. Frame improvements as opportunities, not failures. Be specific: reference exact move numbers and positions.

You will receive a PGN of a chess game and information about which player you are coaching. Analyze the game and respond with ONLY valid JSON (no markdown, no code fences, no text outside the JSON) matching this exact schema:

{
  "opening": {
    "name": "string - name of the opening played",
    "assessment": "good" | "inaccurate" | "dubious",
    "comment": "string - 1-2 sentences about the opening"
  },
  "criticalMoments": [
    {
      "moveNumber": number,
      "move": "string - the move in algebraic notation",
      "type": "blunder" | "mistake" | "excellent" | "missed_tactic",
      "comment": "string - explain why this move matters",
      "suggestion": "string - better move if applicable, or empty string"
    }
  ],
  "positionalThemes": "string - 2-3 sentences about pawn structure, piece activity, king safety",
  "endgame": {
    "reached": boolean,
    "comment": "string - endgame assessment if reached, or empty string"
  },
  "summary": {
    "overallAssessment": "string - 2-3 sentence overall coaching summary",
    "focusArea": "string - one specific thing to work on"
  }
}

Identify 3-5 critical moments. Calibrate your advice to the player's rating level — don't suggest grandmaster-level ideas to a beginner.`;

function buildUserPrompt(
  pgn: string,
  username: string,
  color: "white" | "black",
  rating: number
): string {
  return `Analyze this game for ${username} (playing ${color}, rated ${rating}).

PGN:
${pgn}`;
}

function extractJson(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) return fenceMatch[1];
  return text.trim();
}

export async function analyzeGame(
  pgn: string,
  username: string,
  color: "white" | "black",
  rating: number
): Promise<AnalysisResult> {
  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: buildUserPrompt(pgn, username, color, rating),
      },
    ],
  });

  const responseText =
    message.content[0].type === "text" ? message.content[0].text : "";
  const jsonStr = extractJson(responseText);
  return JSON.parse(jsonStr) as AnalysisResult;
}
```

- [ ] **Step 2: Create analyze API route**

Create `src/app/api/analyze/route.ts`:

```typescript
import { NextRequest } from "next/server";
import { analyzeGame } from "@/lib/claude";

export async function POST(request: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY not configured" },
      { status: 500 }
    );
  }

  try {
    const body = await request.json();
    const { pgn, username, color, rating } = body;

    if (!pgn || !username || !color) {
      return Response.json(
        { error: "Missing required fields: pgn, username, color" },
        { status: 400 }
      );
    }

    const analysis = await analyzeGame(
      pgn,
      username,
      color,
      rating || 1000
    );

    return Response.json(analysis);
  } catch (error) {
    console.error("Analysis error:", error);
    return Response.json(
      { error: "Failed to analyze game. Please try again." },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 3: Verify analyze route works**

Run (replace the PGN with a real one from a previous test, or use a minimal example):
```bash
curl -X POST http://localhost:3000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"pgn":"[Event \"Live Chess\"]\n[White \"MasterPlanDaniel\"]\n[Black \"opponent\"]\n[Result \"1-0\"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. Ng5 d5 5. exd5 Nxd5 6. Nxf7 Kxf7 7. Qf3+ 1-0","username":"MasterPlanDaniel","color":"white","rating":319}'
```
Expected: JSON response matching the AnalysisResult schema.

- [ ] **Step 4: Commit**

```bash
git add src/lib/claude.ts src/app/api/analyze/route.ts
git commit -m "feat: add Claude analysis API route with coaching prompt"
```

---

### Task 8: Analysis Page with Caching

**Files:**
- Create: `src/hooks/use-cached-analysis.ts`, `src/components/analysis-view.tsx`, `src/app/analysis/[username]/page.tsx`

- [ ] **Step 1: Create analysis cache hook**

Create `src/hooks/use-cached-analysis.ts`:

```typescript
import { useState, useEffect } from "react";
import { AnalysisResult } from "@/lib/types";

const CACHE_PREFIX = "analysis:";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface CacheEntry {
  result: AnalysisResult;
  timestamp: number;
}

export function useCachedAnalysis(gameUrl: string) {
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cacheKey = `${CACHE_PREFIX}${gameUrl}`;

  useEffect(() => {
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const entry: CacheEntry = JSON.parse(cached);
        if (Date.now() - entry.timestamp < CACHE_TTL_MS) {
          setAnalysis(entry.result);
        } else {
          localStorage.removeItem(cacheKey);
        }
      }
    } catch {
      // Ignore cache read errors
    }
  }, [cacheKey]);

  async function fetchAnalysis(
    pgn: string,
    username: string,
    color: "white" | "black",
    rating: number
  ) {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pgn, username, color, rating }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Analysis failed");
      }

      const result: AnalysisResult = await res.json();
      setAnalysis(result);

      try {
        const entry: CacheEntry = { result, timestamp: Date.now() };
        localStorage.setItem(cacheKey, JSON.stringify(entry));
      } catch {
        // Ignore cache write errors (quota exceeded, etc.)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return { analysis, loading, error, fetchAnalysis };
}
```

- [ ] **Step 2: Create analysis view component**

Create `src/components/analysis-view.tsx`:

```tsx
import { AnalysisResult, CriticalMoment } from "@/lib/types";

function AssessmentBadge({ assessment }: { assessment: string }) {
  const colors: Record<string, string> = {
    good: "bg-accent-green/20 text-accent-green",
    inaccurate: "bg-accent-orange/20 text-accent-orange",
    dubious: "bg-accent-red/20 text-accent-red",
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
        colors[assessment] || "bg-gray-700 text-gray-300"
      }`}
    >
      {assessment}
    </span>
  );
}

function MomentTypeBadge({ type }: { type: CriticalMoment["type"] }) {
  const config: Record<string, { bg: string; icon: string }> = {
    blunder: { bg: "bg-accent-red/20 text-accent-red", icon: "⚠" },
    mistake: { bg: "bg-accent-orange/20 text-accent-orange", icon: "?" },
    excellent: { bg: "bg-accent-green/20 text-accent-green", icon: "✓" },
    missed_tactic: { bg: "bg-accent-yellow/20 text-accent-yellow", icon: "💡" },
  };
  const { bg, icon } = config[type] || config.mistake;
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${bg}`}>
      {icon} {type.replace("_", " ")}
    </span>
  );
}

export function AnalysisView({ analysis }: { analysis: AnalysisResult }) {
  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="rounded-xl bg-surface-card p-4">
        <h3 className="mb-2 text-sm font-semibold text-gray-400">SUMMARY</h3>
        <p className="text-gray-200">{analysis.summary.overallAssessment}</p>
        <div className="mt-3 rounded-lg bg-accent-blue/10 px-3 py-2">
          <span className="text-xs font-semibold text-accent-blue">
            FOCUS AREA
          </span>
          <p className="mt-1 text-sm text-gray-200">
            {analysis.summary.focusArea}
          </p>
        </div>
      </div>

      {/* Opening */}
      <div className="rounded-xl bg-surface-card p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-400">OPENING</h3>
          <AssessmentBadge assessment={analysis.opening.assessment} />
        </div>
        <p className="font-medium">{analysis.opening.name}</p>
        <p className="mt-1 text-sm text-gray-400">{analysis.opening.comment}</p>
      </div>

      {/* Critical Moments */}
      <div className="rounded-xl bg-surface-card p-4">
        <h3 className="mb-3 text-sm font-semibold text-gray-400">
          CRITICAL MOMENTS
        </h3>
        <div className="space-y-3">
          {analysis.criticalMoments.map((moment, i) => (
            <div
              key={i}
              className="rounded-lg bg-surface-elevated px-3 py-3"
            >
              <div className="mb-1 flex items-center justify-between">
                <span className="font-mono text-sm font-bold">
                  Move {moment.moveNumber}: {moment.move}
                </span>
                <MomentTypeBadge type={moment.type} />
              </div>
              <p className="text-sm text-gray-300">{moment.comment}</p>
              {moment.suggestion && (
                <p className="mt-1 text-sm text-accent-green">
                  Better: {moment.suggestion}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Positional Themes */}
      <div className="rounded-xl bg-surface-card p-4">
        <h3 className="mb-2 text-sm font-semibold text-gray-400">
          POSITIONAL THEMES
        </h3>
        <p className="text-sm text-gray-300">{analysis.positionalThemes}</p>
      </div>

      {/* Endgame */}
      {analysis.endgame.reached && (
        <div className="rounded-xl bg-surface-card p-4">
          <h3 className="mb-2 text-sm font-semibold text-gray-400">ENDGAME</h3>
          <p className="text-sm text-gray-300">{analysis.endgame.comment}</p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create analysis page**

Create `src/app/analysis/[username]/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { ChessComGame } from "@/lib/types";
import { getPlayerColor, getPlayerOutcome, getOpponent, formatDate, outcomeColor, outcomeLabel } from "@/lib/utils";
import { useCachedAnalysis } from "@/hooks/use-cached-analysis";
import { AnalysisView } from "@/components/analysis-view";
import { AnalysisSkeleton } from "@/components/loading-skeleton";

export default function AnalysisPage() {
  const params = useParams<{ username: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const username = decodeURIComponent(params.username);
  const gameUrl = searchParams.get("game") || "";

  const [game, setGame] = useState<ChessComGame | null>(null);
  const { analysis, loading, error, fetchAnalysis } =
    useCachedAnalysis(gameUrl);

  useEffect(() => {
    const stored = sessionStorage.getItem("selectedGame");
    if (stored) {
      try {
        const parsed: ChessComGame = JSON.parse(stored);
        if (parsed.url === gameUrl) {
          setGame(parsed);
          return;
        }
      } catch {
        // Ignore parse errors
      }
    }
    // No game in session storage — can't analyze without PGN
    setGame(null);
  }, [gameUrl]);

  useEffect(() => {
    if (game && !analysis && !loading) {
      const color = getPlayerColor(game, username);
      const rating = game[color].rating;
      fetchAnalysis(game.pgn, username, color, rating);
    }
  }, [game, analysis, loading]);

  if (!gameUrl) {
    return (
      <div className="mx-auto max-w-lg px-4 pt-12 text-center">
        <p className="text-gray-400">No game selected.</p>
        <button
          onClick={() => router.push("/")}
          className="mt-4 text-accent-blue"
        >
          Go to search
        </button>
      </div>
    );
  }

  if (!game) {
    return (
      <div className="mx-auto max-w-lg px-4 pt-12 text-center">
        <p className="text-gray-400">
          Game data not available. Please select a game from the list.
        </p>
        <button
          onClick={() => router.push(`/games/${encodeURIComponent(username)}`)}
          className="mt-4 text-accent-blue"
        >
          View games
        </button>
      </div>
    );
  }

  const outcome = getPlayerOutcome(game, username);
  const opponent = getOpponent(game, username);
  const color = getPlayerColor(game, username);

  return (
    <div className="mx-auto max-w-lg px-4 pt-6">
      <button
        onClick={() => router.push(`/games/${encodeURIComponent(username)}`)}
        className="mb-4 text-sm text-gray-400"
      >
        ← Back to games
      </button>

      {/* Game header */}
      <div className="mb-6 rounded-xl bg-surface-card p-4">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm text-gray-400">
              Playing {color} vs
            </span>
            <div className="text-lg font-bold">
              {opponent.username}{" "}
              <span className="text-sm text-gray-500">
                ({opponent.rating})
              </span>
            </div>
          </div>
          <div className={`text-xl font-bold ${outcomeColor(outcome)}`}>
            {outcomeLabel(outcome)}
          </div>
        </div>
        <div className="mt-1 text-xs text-gray-500">
          {formatDate(game.end_time)} · {game.time_class} · {game.time_control}
        </div>
      </div>

      {/* Analysis */}
      {loading && (
        <div>
          <div className="mb-4 text-center text-gray-400">
            <div className="mb-2 text-2xl">🤔</div>
            Coach is reviewing your game...
          </div>
          <AnalysisSkeleton />
        </div>
      )}

      {error && (
        <div className="rounded-lg bg-red-900/30 px-4 py-3 text-accent-red">
          {error}
          <button
            onClick={() => {
              const c = getPlayerColor(game, username);
              fetchAnalysis(game.pgn, username, c, game[c].rating);
            }}
            className="mt-2 block text-sm text-accent-blue"
          >
            Try again
          </button>
        </div>
      )}

      {analysis && <AnalysisView analysis={analysis} />}
    </div>
  );
}
```

- [ ] **Step 4: Verify end-to-end flow**

Open browser. Search username → view games → tap a game → verify analysis loads and renders coaching cards.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/use-cached-analysis.ts src/components/analysis-view.tsx src/app/analysis/\[username\]/page.tsx
git commit -m "feat: add analysis page with Claude coaching and localStorage cache"
```

---

### Task 9: Bottom Navigation + Mobile Polish

**Files:**
- Create: `src/components/bottom-nav.tsx`
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Create bottom navigation**

Create `src/components/bottom-nav.tsx`:

```tsx
"use client";

import { usePathname, useRouter } from "next/navigation";

const NAV_ITEMS = [
  {
    label: "Search",
    path: "/",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
    ),
  },
  {
    label: "Games",
    pathPrefix: "/games",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
      </svg>
    ),
  },
  {
    label: "Analysis",
    pathPrefix: "/analysis",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
      </svg>
    ),
  },
];

export function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();

  function isActive(item: (typeof NAV_ITEMS)[number]) {
    if ("path" in item && item.path) return pathname === item.path;
    if ("pathPrefix" in item && item.pathPrefix)
      return pathname.startsWith(item.pathPrefix);
    return false;
  }

  function handleClick(item: (typeof NAV_ITEMS)[number]) {
    if ("path" in item && item.path) {
      router.push(item.path);
    }
    // For Games/Analysis, stay on current page if already on that section
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-gray-800 bg-surface">
      <div className="mx-auto flex max-w-lg items-center justify-around py-2">
        {NAV_ITEMS.map((item) => {
          const active = isActive(item);
          return (
            <button
              key={item.label}
              onClick={() => handleClick(item)}
              className={`flex flex-col items-center gap-0.5 px-4 py-1 ${
                active ? "text-accent-blue" : "text-gray-500"
              }`}
            >
              {item.icon}
              <span className="text-xs">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
```

- [ ] **Step 2: Add bottom nav to layout**

Replace `src/app/layout.tsx`:

```tsx
import type { Metadata, Viewport } from "next";
import { BottomNav } from "@/components/bottom-nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chess Coach",
  description: "AI-powered coaching for your Chess.com games",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-surface text-gray-200 antialiased">
        <main className="pb-20">{children}</main>
        <BottomNav />
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Verify mobile layout**

Open browser dev tools → toggle device toolbar → select iPhone 14 or similar. Navigate through all pages and verify:
- Bottom nav shows and highlights correct tab
- Touch targets are large enough
- No horizontal scroll on narrow viewports
- Filter tabs scroll horizontally

- [ ] **Step 4: Commit**

```bash
git add src/components/bottom-nav.tsx src/app/layout.tsx
git commit -m "feat: add bottom navigation and mobile layout"
```

---

### Task 10: Error Handling + Final Polish

**Files:**
- Modify: multiple files for edge cases

- [ ] **Step 1: Add error boundary**

Create `src/app/error.tsx`:

```tsx
"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-4 text-center">
      <div className="text-4xl">😵</div>
      <h2 className="text-xl font-bold">Something went wrong</h2>
      <p className="text-gray-400">{error.message}</p>
      <button
        onClick={reset}
        className="rounded-lg bg-accent-blue px-6 py-2 font-semibold text-white"
      >
        Try again
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Add not-found page**

Create `src/app/not-found.tsx`:

```tsx
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-4 text-center">
      <div className="text-4xl">♟</div>
      <h2 className="text-xl font-bold">Page not found</h2>
      <Link href="/" className="text-accent-blue">
        Go home
      </Link>
    </div>
  );
}
```

- [ ] **Step 3: Verify full build passes**

Run:
```bash
cd C:/Users/dpm50/Documents/Claude-Code/Chess
npm run build
```
Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/error.tsx src/app/not-found.tsx
git commit -m "feat: add error boundary and 404 page"
```

---

### Task 11: Deployment

**Files:**
- No new files required (Vercel auto-detects Next.js)

- [ ] **Step 1: Verify environment variable is set**

The `ANTHROPIC_API_KEY` must be set in Vercel project settings under Environment Variables. Do not commit it.

- [ ] **Step 2: Deploy**

Either connect the GitHub repo to Vercel, or run:
```bash
npx vercel --prod
```

- [ ] **Step 3: Smoke test**

On the deployed URL:
1. Enter "MasterPlanDaniel" on the home page
2. Verify player card shows with ratings
3. Click "View Games" → verify game list loads
4. Tap a rapid game → verify analysis loads with coaching feedback
5. Go back and tap the same game → verify it loads instantly from cache

---

## Verification Plan

After all tasks are complete, run this end-to-end check:

1. `npm run build` — no errors
2. `npm run dev` — app starts on localhost:3000
3. Search for "MasterPlanDaniel" — player card appears with rapid rating
4. Click "View Games" — game list loads, filter tabs work (Rapid default, can switch to All/Blitz/etc.)
5. Tap a game — analysis page shows game header, then coaching loads from Claude
6. Coaching shows: opening assessment, critical moments, positional themes, summary with focus area
7. Navigate back, tap same game — loads instantly from localStorage cache
8. Test on mobile viewport (375px) — bottom nav works, no overflow, touch targets adequate
