import { Redis } from "@upstash/redis";
import { createHash } from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import { Chess } from "chess.js";

const CHESS_COM_API = "https://api.chess.com/pub";
const HEADERS = {
  "User-Agent": "ChessCoach/1.0 (github.com/chess-coach)",
  Accept: "application/json",
};
const USERS = ["castledoon", "exstrax"];
const MONTHS_TO_FETCH = 3;
const ANALYSIS_TTL = 90 * 24 * 60 * 60; // 90 days

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
  if (!url || !token) {
    throw new Error("Missing KV_REST_API_URL or KV_REST_API_TOKEN");
  }
  return new Redis({ url, token });
}

function analysisCacheKey(pgn: string): string {
  const moves = pgn
    .replace(/\[.*?\]\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
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
  return (
    parseInt(year, 10) === now.getFullYear() &&
    parseInt(month, 10) === now.getMonth() + 1
  );
}

function getAllMoves(pgn: string): { moveNumber: number; color: string; san: string; fen: string }[] {
  const chess = new Chess();
  chess.loadPgn(pgn);
  const history = chess.history({ verbose: true });
  const moves: { moveNumber: number; color: string; san: string; fen: string }[] = [];
  for (const h of history) {
    moves.push({
      moveNumber: Math.ceil(moves.length / 2) + (h.color === "w" ? 1 : 0) === 0 ? 1 : Math.floor(moves.length / 2) + 1,
      color: h.color,
      san: h.san,
      fen: h.after,
    });
  }
  // Fix move numbers
  let num = 1;
  for (let i = 0; i < moves.length; i++) {
    if (moves[i].color === "w") num = Math.floor(i / 2) + 1;
    moves[i].moveNumber = Math.floor(i / 2) + 1;
  }
  return moves;
}

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

Identify 3-5 critical moments. Calibrate your advice to the player's rating level — don't suggest grandmaster-level ideas to a beginner.

IMPORTANT: You will also receive FEN positions at key points in the game. Use them to verify your analysis — only suggest moves that are legal in the given position. The "move" field MUST exactly match the SAN notation from the PGN. The "suggestion" field MUST be a legal move in standard algebraic notation for that position.`;

async function analyzeGame(
  client: Anthropic,
  pgn: string,
  username: string,
  color: "white" | "black",
  rating: number
): Promise<unknown> {
  const moves = getAllMoves(pgn);
  const fenList = moves
    .map(
      (m) =>
        `${m.moveNumber}${m.color === "w" ? "." : "..."} ${m.san} → FEN: ${m.fen}`
    )
    .join("\n");

  const userPrompt = `Analyze this game for ${username} (playing ${color}, rated ${rating}).

PGN:
${pgn}

Position after each move:
${fenList}`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  const responseText =
    message.content[0].type === "text" ? message.content[0].text : "";
  const fenceMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const jsonStr = fenceMatch ? fenceMatch[1] : responseText.trim();

  return JSON.parse(jsonStr);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const redis = getRedis();
  const client = new Anthropic();

  for (const username of USERS) {
    console.log(`\n=== ${username} ===`);

    // 1. Fetch archives and refresh game cache
    const { archives } = await fetchJson<{ archives: string[] }>(
      `${CHESS_COM_API}/player/${username}/games/archives`
    );
    await redis.set(`archives:${username}`, archives, { ex: 5 * 60 });

    const recentArchives = archives.slice(-MONTHS_TO_FETCH);
    const allGames: Game[] = [];

    for (const archiveUrl of recentArchives) {
      const parts = archiveUrl.split("/");
      const year = parts[parts.length - 2];
      const month = parts[parts.length - 1];

      const { games } = await fetchJson<{ games: Game[] }>(archiveUrl);
      const withPgn = games.filter((g) => g.pgn);
      allGames.push(...withPgn);

      // Update Redis cache
      const key = `games:${username}:${year}/${month}`;
      const ttl = isCurrentMonth(year, month) ? { ex: 5 * 60 } : {};
      await redis.set(key, games, ttl);
      console.log(`  Cached ${year}/${month}: ${withPgn.length} games`);
    }

    // Sort newest first
    allGames.sort((a, b) => b.end_time - a.end_time);

    // 2. Group by time class
    const byClass: Record<string, Game[]> = {};
    for (const g of allGames) {
      byClass[g.time_class] = byClass[g.time_class] || [];
      byClass[g.time_class].push(g);
    }
    console.log(
      `  Total: ${allGames.length} games — ${Object.entries(byClass)
        .map(([tc, gs]) => `${tc}: ${gs.length}`)
        .join(", ")}`
    );

    // 3. Check which games need analysis
    const uncached: Game[] = [];
    for (const game of allGames) {
      const key = analysisCacheKey(game.pgn);
      const existing = await redis.get(key);
      if (!existing) {
        uncached.push(game);
      }
    }

    console.log(`  Already analyzed: ${allGames.length - uncached.length}`);
    console.log(
      `  Need analysis: ${uncached.length} — ${Object.entries(
        uncached.reduce((acc, g) => {
          acc[g.time_class] = (acc[g.time_class] || 0) + 1;
          return acc;
        }, {} as Record<string, number>)
      )
        .map(([tc, n]) => `${tc}: ${n}`)
        .join(", ") || "none"}`
    );

    // 4. Analyze uncached games
    for (let i = 0; i < uncached.length; i++) {
      const game = uncached[i];
      const isWhite = game.white.username.toLowerCase() === username.toLowerCase();
      const color = isWhite ? "white" as const : "black" as const;
      const rating = isWhite ? game.white.rating : game.black.rating;
      const opponent = isWhite ? game.black.username : game.white.username;
      const date = new Date(game.end_time * 1000).toLocaleDateString();

      console.log(
        `  [${i + 1}/${uncached.length}] Analyzing ${game.time_class} vs ${opponent} (${date})...`
      );

      try {
        const analysis = await analyzeGame(client, game.pgn, username, color, rating);
        const key = analysisCacheKey(game.pgn);
        await redis.set(key, analysis, { ex: ANALYSIS_TTL });
        console.log(`    ✓ Cached`);
      } catch (err) {
        console.error(`    ✗ Failed: ${err instanceof Error ? err.message : err}`);
      }

      // Rate limit: wait between API calls
      if (i < uncached.length - 1) {
        await delay(1500);
      }
    }
  }

  console.log("\nDone!");
}

main().catch((err) => {
  console.error("Batch analysis failed:", err);
  process.exit(1);
});
