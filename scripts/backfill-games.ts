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

function isCurrentMonth(year: string, month: string): boolean {
  const now = new Date();
  return (
    parseInt(year, 10) === now.getFullYear() &&
    parseInt(month, 10) === now.getMonth() + 1
  );
}

async function main() {
  const redis = getRedis();

  // Ensure output directory exists
  const outDir = path.join(process.cwd(), "scripts", "data");
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  for (const username of USERS) {
    console.log(`\n--- Fetching games for ${username} ---`);

    const { archives } = await fetchJson<{ archives: string[] }>(
      `${CHESS_COM_API}/player/${username}/games/archives`
    );
    console.log(`Found ${archives.length} monthly archives`);

    // Cache archive list (5-min TTL)
    await redis.set(`archives:${username}`, archives, { ex: 5 * 60 });

    const allGames: unknown[] = [];

    for (const archiveUrl of archives) {
      const parts = archiveUrl.split("/");
      const year = parts[parts.length - 2];
      const month = parts[parts.length - 1];

      const { games } = await fetchJson<{ games: unknown[] }>(archiveUrl);
      const withPgn = games.filter(
        (g: unknown) => (g as { pgn?: string }).pgn
      );
      allGames.push(...withPgn);
      console.log(`  ${year}/${month}: ${withPgn.length} games`);

      // Write per-archive key
      const key = `games:${username}:${year}/${month}`;
      const ttl = isCurrentMonth(year, month) ? { ex: 5 * 60 } : {};
      await redis.set(key, games, ttl);
    }

    // Delete old single-key format if it exists
    await redis.del(`games:${username}`);

    // Sort by end_time descending (newest first)
    allGames.sort(
      (a: unknown, b: unknown) =>
        ((b as { end_time: number }).end_time ?? 0) -
        ((a as { end_time: number }).end_time ?? 0)
    );

    console.log(`Total: ${allGames.length} games with PGN`);

    // Write JSON file for analysis input
    const filePath = path.join(outDir, `${username}-games.json`);
    fs.writeFileSync(filePath, JSON.stringify(allGames, null, 2));
    console.log(`Wrote ${filePath}`);
  }

  console.log("\nDone! Game data stored in Redis (per-archive) and JSON files.");
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
