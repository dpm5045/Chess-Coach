/**
 * One-time script to populate meta:<username>:latest Redis keys
 * from existing local JSON files (scripts/data/<username>-meta.json).
 *
 * Usage: npx tsx scripts/seed-meta-latest.ts
 */
import { Redis } from "@upstash/redis";
import * as fs from "fs";
import * as path from "path";

const USERS = ["castledoon", "exstrax"];

function getRedis(): Redis {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    throw new Error("Missing KV_REST_API_URL or KV_REST_API_TOKEN");
  }
  return new Redis({ url, token });
}

async function main() {
  const redis = getRedis();
  const dataDir = path.join(process.cwd(), "scripts", "data");

  for (const username of USERS) {
    const filePath = path.join(dataDir, `${username}-meta.json`);
    if (!fs.existsSync(filePath)) {
      console.log(`No file at ${filePath} — skipping`);
      continue;
    }

    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const key = `meta:${username.toLowerCase()}:latest`;
    await redis.set(key, data);
    console.log(`Set ${key} from ${filePath}`);
  }

  console.log("Done!");
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
