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
