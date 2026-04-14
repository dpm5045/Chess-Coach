/**
 * One-shot backfill: add battleAllusion to existing cached analyses in Redis.
 *
 * Usage:
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/backfill-battle-allusions.ts [--dry-run]
 *
 * The script is idempotent: analyses that already have battleAllusion are skipped.
 * Because this runs outside a browser context, it talks to Chess.com directly
 * to list archives/games (same pattern the meta-API fix uses) rather than
 * relying on the 5-minute-TTL Redis archive caches.
 */

import { Redis } from "@upstash/redis";
import { createHash } from "crypto";
import {
  classifyBattle,
  buildFeaturesFromAnalysisResult,
} from "../src/lib/battle-allusion";
import type { AnalysisResult } from "../src/lib/types";

const USERS = ["castledoon", "exstrax"];
const MONTHS = 3;
const ANALYSIS_TTL = 90 * 24 * 60 * 60;
const CHESS_COM = "https://api.chess.com/pub";
const HEADERS = {
  "User-Agent": "ChessCoach/1.0 (backfill)",
  Accept: "application/json",
};

const DRY_RUN = process.argv.includes("--dry-run");

interface ChessComGame {
  url: string;
  pgn: string;
  end_time: number;
  white: { username: string; result: string };
  black: { username: string; result: string };
}

function analysisCacheKey(pgn: string): string {
  const moves = pgn.replace(/\[.*?\]\s*/g, "").replace(/\s+/g, " ").trim();
  const hash = createHash("sha256").update(moves).digest("hex").slice(0, 16);
  return `analysis:${hash}`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return res.json() as Promise<T>;
}

function getPlayerOutcome(
  game: ChessComGame,
  username: string
): "win" | "loss" | "draw" {
  const isWhite = game.white.username.toLowerCase() === username.toLowerCase();
  const result = (isWhite ? game.white : game.black).result;
  if (result === "win") return "win";
  if (
    ["stalemate", "insufficient", "repetition", "agreed", "50move", "timevsinsufficient"].includes(result)
  ) {
    return "draw";
  }
  return "loss";
}

async function main() {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    console.error("Missing Redis env vars KV_REST_API_URL / KV_REST_API_TOKEN");
    process.exit(1);
  }
  const redis = new Redis({ url, token });

  let totalProcessed = 0;
  let totalAdded = 0;
  let totalSkipped = 0;
  let totalMissing = 0;

  for (const username of USERS) {
    console.log(`\n=== ${username} ===`);

    const { archives } = await fetchJson<{ archives: string[] }>(
      `${CHESS_COM}/player/${username}/games/archives`
    );
    const recent = archives.slice(-MONTHS);

    const allGames: ChessComGame[] = [];
    for (const archiveUrl of recent) {
      const { games } = await fetchJson<{ games: ChessComGame[] }>(archiveUrl);
      for (const g of games) if (g.pgn) allGames.push(g);
    }
    allGames.sort((a, b) => b.end_time - a.end_time);
    console.log(`  Loaded ${allGames.length} games from Chess.com`);

    for (let i = 0; i < allGames.length; i++) {
      const game = allGames[i];
      const key = analysisCacheKey(game.pgn);
      const analysis = await redis.get<AnalysisResult>(key);
      totalProcessed++;

      if (!analysis) {
        totalMissing++;
        continue;
      }
      if (analysis.summary.battleAllusion) {
        totalSkipped++;
        continue;
      }

      const gameResult = getPlayerOutcome(game, username);
      const features = buildFeaturesFromAnalysisResult(
        analysis,
        game.pgn,
        gameResult
      );
      const battleAllusion = classifyBattle(features);

      const opponent =
        game.white.username.toLowerCase() === username.toLowerCase()
          ? game.black.username
          : game.white.username;
      const date = new Date(game.end_time * 1000).toISOString().slice(0, 10);

      console.log(
        `  [${i + 1}/${allGames.length}] ${username} vs ${opponent} (${date}): ${battleAllusion.battleName}${DRY_RUN ? " [dry-run]" : ""}`
      );

      if (!DRY_RUN) {
        analysis.summary.battleAllusion = battleAllusion;
        await redis.set(key, analysis, { ex: ANALYSIS_TTL });
      }
      totalAdded++;
    }
  }

  console.log(
    `\nDone. Processed ${totalProcessed} game records: ${totalAdded} battles added${DRY_RUN ? " (dry-run)" : ""}, ${totalSkipped} already present, ${totalMissing} missing analyses.`
  );

  process.exit(0);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
