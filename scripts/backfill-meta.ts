import { Redis } from "@upstash/redis";
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import Anthropic from "@anthropic-ai/sdk";

const USERS = ["castledoon", "exstrax"];
const MAX_GAMES = 50;

interface PlayerResult {
  username: string;
  rating: number;
  result: string;
  "@id": string;
  uuid: string;
}

interface ChessComGame {
  url: string;
  pgn: string;
  uuid: string;
  time_class: string;
  time_control: string;
  rated: boolean;
  rules: string;
  white: PlayerResult;
  black: PlayerResult;
  end_time: number;
}

interface AnalysisResult {
  opening: { name: string; assessment: string; comment: string };
  criticalMoments: Array<{ type: string }>;
  positionalThemes: string;
  endgame: { reached: boolean; comment: string };
  summary: { overallAssessment: string; focusArea: string };
}

function getRedis(): Redis {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    throw new Error("Missing KV_REST_API_URL or KV_REST_API_TOKEN");
  }
  return new Redis({ url, token });
}

function analysisCacheKey(pgn: string): string {
  const moves = pgn.replace(/\[.*?\]\s*/g, "").replace(/\s+/g, " ").trim();
  const hash = createHash("sha256").update(moves).digest("hex").slice(0, 16);
  return `analysis:${hash}`;
}

function metaCacheKey(username: string, gameUuids: string[]): string {
  const sorted = [...gameUuids].sort().join(",");
  const hash = createHash("sha256").update(sorted).digest("hex").slice(0, 16);
  return `meta:${username.toLowerCase()}:${hash}`;
}

function getPlayerColor(game: ChessComGame, username: string): "white" | "black" {
  return game.white.username.toLowerCase() === username.toLowerCase() ? "white" : "black";
}

function getPlayerOutcome(game: ChessComGame, username: string): string {
  const color = getPlayerColor(game, username);
  const result = game[color].result;
  if (result === "win") return "win";
  if (["stalemate", "insufficient", "repetition", "agreed", "50move", "timevsinsufficient"].includes(result)) return "draw";
  return "loss";
}

function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function summarizeAnalysis(analysis: AnalysisResult): string {
  const moments = analysis.criticalMoments;
  const blunders = moments.filter((m) => m.type === "blunder").length;
  const mistakes = moments.filter((m) => m.type === "mistake").length;
  const excellent = moments.filter((m) => m.type === "excellent").length;

  return [
    `Opening: ${analysis.opening.name} (${analysis.opening.assessment})`,
    `Critical moments: ${blunders} blunders, ${mistakes} mistakes, ${excellent} excellent moves`,
    `Themes: ${analysis.positionalThemes}`,
    `Endgame: ${analysis.endgame.reached ? analysis.endgame.comment : "not reached"}`,
    `Focus area: ${analysis.summary.focusArea}`,
  ].join("\n  ");
}

function stripPgnHeaders(pgn: string): string {
  return pgn.replace(/\[.*?\]\s*/g, "").replace(/\{[^}]*\}/g, "").replace(/\s+/g, " ").trim();
}

const META_SYSTEM_PROMPT = `You are a long-term chess coach reviewing a student's body of work across many games. Your tone is warm and supportive — celebrate their strengths before addressing weaknesses. Frame improvements as the next step in their journey, not as failures.

You will receive summaries or move lists from multiple games for one player. Identify recurring patterns across games — not one-off events. Look for consistent themes in openings, tactics, positional play, time management, and endgames.

Respond with ONLY valid JSON (no markdown, no code fences, no text outside the JSON) matching this exact schema:

{
  "playerUsername": "string",
  "gamesAnalyzed": number,
  "timeRange": "string - e.g. Jan 2026 – Mar 2026",
  "overallProfile": "string - 3-4 sentence player profile summarizing their style and level",
  "ratingTrend": "string - observation about their rating trajectory and what it suggests",
  "strengths": [
    {
      "title": "string - short name for this strength",
      "sentiment": "strength",
      "frequency": "consistent" | "occasional" | "rare",
      "description": "string - 2-3 sentences explaining this pattern",
      "examples": ["string - specific game reference, e.g. 'Game vs opponent (date): description'"],
      "actionItem": "string - how to build on this strength"
    }
  ],
  "weaknesses": [
    {
      "title": "string - short name for this weakness",
      "sentiment": "weakness",
      "frequency": "consistent" | "occasional" | "rare",
      "description": "string - 2-3 sentences explaining this pattern",
      "examples": ["string - specific game reference"],
      "actionItem": "string - specific drill or focus to improve"
    }
  ],
  "openingRepertoire": {
    "asWhite": "string - summary of their white opening tendencies",
    "asBlack": "string - summary of their black opening tendencies",
    "recommendation": "string - coaching advice on their opening choices"
  },
  "endgameTendency": "string - overall endgame pattern observation",
  "coachingPlan": ["string - ordered improvement priorities, 3-5 items"]
}

Include 2-4 strengths and 2-4 weaknesses. Each must reference specific games as examples. Calibrate advice to the player's rating level.`;

function extractJson(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) return fenceMatch[1];
  return text.trim();
}

async function main() {
  const redis = getRedis();
  const client = new Anthropic();
  const dataDir = path.join(process.cwd(), "scripts", "data");

  for (const username of USERS) {
    console.log(`\n=== Processing ${username} ===`);

    // Load games from local data file
    const gamesPath = path.join(dataDir, `${username}-games.json`);
    if (!fs.existsSync(gamesPath)) {
      console.log(`No games file at ${gamesPath} — skipping`);
      continue;
    }

    const allGames: ChessComGame[] = JSON.parse(fs.readFileSync(gamesPath, "utf-8"));
    const games = allGames
      .filter((g) => g.pgn)
      .sort((a, b) => b.end_time - a.end_time)
      .slice(0, MAX_GAMES);

    console.log(`  ${games.length} games (of ${allGames.length} total)`);

    const uuids = games.map((g) => g.uuid);
    const key = metaCacheKey(username, uuids);

    // Check if already cached
    const existing = await redis.get(key);
    if (existing) {
      console.log(`  Already cached at ${key} — skipping`);
      continue;
    }

    // Build game summary with two-tier approach
    const sections: string[] = [];
    let cachedCount = 0;

    for (const game of games) {
      const color = getPlayerColor(game, username);
      const outcome = getPlayerOutcome(game, username);
      const opp = color === "white" ? game.black : game.white;
      const playerRating = game[color].rating;
      const date = formatDate(game.end_time);

      const header = `Game vs ${opp.username} (${opp.rating}) on ${date} | ${color} | ${game.time_class} ${game.time_control} | ${outcome} | Rating: ${playerRating}`;

      // Try to find cached per-game analysis in Redis
      const analysisKey = analysisCacheKey(game.pgn);
      const cachedAnalysis = await redis.get<AnalysisResult>(analysisKey);

      if (cachedAnalysis) {
        cachedCount++;
        sections.push(`${header}\n  ${summarizeAnalysis(cachedAnalysis)}`);
      } else {
        const moves = stripPgnHeaders(game.pgn);
        sections.push(`${header}\n  Moves: ${moves}`);
      }
    }

    console.log(`  ${cachedCount}/${games.length} games had cached analyses`);

    const latestColor = getPlayerColor(games[0], username);
    const currentRating = games[0][latestColor].rating;
    const gamesSummary = sections.join("\n\n");

    console.log(`  Calling Claude for meta analysis (rating ~${currentRating})...`);

    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: META_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Analyze the game history for ${username} (current rating ~${currentRating}, ${games.length} games below). Identify recurring patterns and provide a coaching plan.\n\n${gamesSummary}`,
        },
      ],
    });

    const responseText = message.content[0].type === "text" ? message.content[0].text : "";
    const jsonStr = extractJson(responseText);
    const result = JSON.parse(jsonStr);

    // Write to Redis with 14-day TTL (hash-based key for dedup)
    await redis.set(key, result, { ex: 14 * 24 * 60 * 60 });
    console.log(`  Cached at ${key}`);

    // Also write to stable "latest" key for the web app to read
    const latestKey = `meta:${username.toLowerCase()}:latest`;
    await redis.set(latestKey, result);
    console.log(`  Updated ${latestKey}`);

    // Also save locally for reference
    const outPath = path.join(dataDir, `${username}-meta.json`);
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
    console.log(`  Saved to ${outPath}`);
  }

  console.log("\nDone!");
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
