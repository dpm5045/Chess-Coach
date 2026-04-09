import { isAllowedUser, getPlayerColor, getPlayerOutcome } from "@/lib/chess-com";
import { getRedis, analysisCacheKey } from "@/lib/analysis-cache";
import { getAllGames } from "@/lib/game-cache";
import { MetaAnalysisResult, MissedMateInOneEntry, AnalysisResult, TimeClass } from "@/lib/types";

async function composeMissedMates(
  redis: NonNullable<ReturnType<typeof getRedis>>,
  username: string
): Promise<MissedMateInOneEntry[]> {
  // Use the shared self-healing game cache. It checks Redis first and
  // refetches from Chess.com on miss, so we don't silently break when the
  // short-lived archives/current-month keys expire.
  let allGames;
  try {
    allGames = await getAllGames(username, 3);
  } catch {
    return [];
  }

  if (allGames.length === 0) return [];

  // Filter to losses and draws
  const lostOrDrawn = allGames.filter((game) => {
    const outcome = getPlayerOutcome(game, username);
    return outcome === "loss" || outcome === "draw";
  });

  if (lostOrDrawn.length === 0) return [];

  // Look up analyses in batch
  const analysisKeys = lostOrDrawn.map((game) => analysisCacheKey(game.pgn));
  const analyses = await redis.mget<(AnalysisResult | null)[]>(...analysisKeys);

  // Compose entries
  const entries: MissedMateInOneEntry[] = [];

  for (let i = 0; i < lostOrDrawn.length; i++) {
    const game = lostOrDrawn[i];
    const analysis = analyses[i];

    if (!analysis?.missedMatesInOne || analysis.missedMatesInOne.length === 0) {
      continue;
    }

    const color = getPlayerColor(game, username);
    const isWhite = color === "white";
    const opponent = isWhite ? game.black.username : game.white.username;
    const outcome = getPlayerOutcome(game, username);
    const date = new Date(game.end_time * 1000).toISOString().slice(0, 10);

    // Sort by move number, take earliest
    const sorted = [...analysis.missedMatesInOne].sort(
      (a, b) => a.moveNumber - b.moveNumber
    );

    entries.push({
      gameUrl: game.url,
      opponent,
      date,
      timeClass: game.time_class as TimeClass,
      result: outcome as "loss" | "draw",
      missCount: analysis.missedMatesInOne.length,
      firstMiss: sorted[0],
    });
  }

  // Sort by date descending (most recent first)
  entries.sort((a, b) => b.date.localeCompare(a.date));

  return entries;
}

/**
 * Read-only endpoint — returns cached meta analysis from Redis.
 * To update, run: npx tsx scripts/backfill-meta.ts
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const username = searchParams.get("username");

  if (!username) {
    return Response.json({ error: "Username is required" }, { status: 400 });
  }

  if (!isAllowedUser(username)) {
    return Response.json({ error: "Player not available" }, { status: 403 });
  }

  try {
    const redis = getRedis();
    if (!redis) {
      return Response.json(
        { error: "Cache not available" },
        { status: 503 }
      );
    }

    // Load base meta analysis (LLM-generated)
    const key = `meta:${username.toLowerCase()}:latest`;
    const result = await redis.get<MetaAnalysisResult>(key);

    if (!result) {
      return Response.json(
        { error: "No coaching report available yet. Run the backfill script to generate one." },
        { status: 404 }
      );
    }

    // Compose missed-mate-in-1 entries from per-game analyses
    const missedMatesInOne = await composeMissedMates(redis, username);

    return Response.json({
      ...result,
      missedMatesInOne: missedMatesInOne.length > 0 ? missedMatesInOne : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json(
      { error: `Failed to load meta analysis: ${message}` },
      { status: 500 }
    );
  }
}
