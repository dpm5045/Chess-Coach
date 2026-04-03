/**
 * Clears cached meta analyses so they regenerate with updated prompt/data.
 * Usage: npx dotenv-cli -e .env.local -- npx tsx scripts/clear-meta-cache.ts
 */

import { Redis } from "@upstash/redis";

function getRedis(): Redis {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error("Missing KV_REST_API_URL or KV_REST_API_TOKEN");
  return new Redis({ url, token });
}

async function main() {
  const redis = getRedis();

  // Scan for all meta: keys
  let cursor = 0;
  let deleted = 0;
  do {
    const [nextCursor, keys] = await redis.scan(cursor, { match: "meta:*", count: 100 });
    cursor = typeof nextCursor === "string" ? parseInt(nextCursor, 10) : nextCursor;
    for (const key of keys) {
      await redis.del(key);
      console.log(`  Deleted ${key}`);
      deleted++;
    }
  } while (cursor !== 0);

  console.log(`\nCleared ${deleted} cached meta analyses.`);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
