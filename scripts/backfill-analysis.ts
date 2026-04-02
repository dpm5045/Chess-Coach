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
