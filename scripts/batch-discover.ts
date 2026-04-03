import { Redis } from "@upstash/redis";
import { createHash } from "crypto";

const CHESS_COM_API = "https://api.chess.com/pub";
const HEADERS = {
  "User-Agent": "ChessCoach/1.0 (github.com/chess-coach)",
  Accept: "application/json",
};
const USERS = ["castledoon", "exstrax"];
const DAYS_BACK = 30;

interface PlayerResult {
  username: string;
  rating: number;
  result: string;
}

interface Game {
  url: string;
  pgn: string;
  uuid: string;
  time_class: string;
  white: PlayerResult;
  black: PlayerResult;
  end_time: number;
}

function getRedis(): Redis {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error("Missing KV_REST_API_URL or KV_REST_API_TOKEN");
  return new Redis({ url, token });
}

function analysisCacheKey(pgn: string): string {
  const moves = pgn.replace(/\[.*?\]\s*/g, "").replace(/\s+/g, " ").trim();
  const hash = createHash("sha256").update(moves).digest("hex").slice(0, 16);
  return `analysis:${hash}`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Chess.com API error: ${res.status} for ${url}`);
  return res.json() as Promise<T>;
}

function isCurrentMonth(year: string, month: string): boolean {
  const now = new Date();
  return parseInt(year, 10) === now.getFullYear() && parseInt(month, 10) === now.getMonth() + 1;
}

async function main() {
  const mode = process.argv[2]; // "discover" or "store"
  const redis = getRedis();
  const cutoff = Date.now() / 1000 - DAYS_BACK * 24 * 60 * 60;

  if (mode === "store") {
    // Read JSON from stdin: { cacheKey, analysis }
    const input = await new Promise<string>((resolve) => {
      let data = "";
      process.stdin.on("data", (chunk) => (data += chunk));
      process.stdin.on("end", () => resolve(data));
    });
    const { cacheKey, analysis } = JSON.parse(input);
    await redis.set(cacheKey, analysis, { ex: 90 * 24 * 60 * 60 });
    console.log(`Stored analysis for ${cacheKey}`);
    return;
  }

  // Discovery mode
  for (const username of USERS) {
    console.log(`\n=== ${username} ===`);

    const { archives } = await fetchJson<{ archives: string[] }>(
      `${CHESS_COM_API}/player/${username}/games/archives`
    );
    await redis.set(`archives:${username}`, archives, { ex: 5 * 60 });

    // Fetch last 2 months of archives to cover 30 days
    const recentArchives = archives.slice(-2);
    const allGames: Game[] = [];

    for (const archiveUrl of recentArchives) {
      const parts = archiveUrl.split("/");
      const year = parts[parts.length - 2];
      const month = parts[parts.length - 1];

      const { games } = await fetchJson<{ games: Game[] }>(archiveUrl);
      const withPgn = games.filter((g) => g.pgn);
      allGames.push(...withPgn);

      const key = `games:${username}:${year}/${month}`;
      const ttl = isCurrentMonth(year, month) ? { ex: 5 * 60 } : {};
      await redis.set(key, games, ttl);
      console.log(`  Cached ${year}/${month}: ${withPgn.length} games`);
    }

    // Filter to last 30 days
    const recent = allGames.filter((g) => g.end_time >= cutoff);
    recent.sort((a, b) => b.end_time - a.end_time);

    console.log(`  Games in last 30 days: ${recent.length}`);

    const uncached: { game: Game; cacheKey: string }[] = [];
    for (const game of recent) {
      const key = analysisCacheKey(game.pgn);
      const existing = await redis.get(key);
      if (!existing) uncached.push({ game, cacheKey: key });
    }

    console.log(`  Already analyzed: ${recent.length - uncached.length}`);
    console.log(`  Need analysis: ${uncached.length}`);

    // Output uncached games as JSON for analysis
    for (const { game, cacheKey } of uncached) {
      const isWhite = game.white.username.toLowerCase() === username.toLowerCase();
      const color = isWhite ? "white" : "black";
      const rating = isWhite ? game.white.rating : game.black.rating;
      const opponent = isWhite ? game.black.username : game.white.username;
      const date = new Date(game.end_time * 1000).toISOString().slice(0, 10);

      console.log(`\n---GAME_START---`);
      console.log(JSON.stringify({
        cacheKey,
        username,
        color,
        rating,
        opponent,
        date,
        timeClass: game.time_class,
        result: isWhite ? game.white.result : game.black.result,
        pgn: game.pgn,
      }));
      console.log(`---GAME_END---`);
    }
  }
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
