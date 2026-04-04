import { isAllowedUser } from "@/lib/chess-com";
import { getRedis } from "@/lib/analysis-cache";
import { MetaAnalysisResult } from "@/lib/types";

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

    // Look up the stable meta key for this user
    const key = `meta:${username.toLowerCase()}:latest`;
    const result = await redis.get<MetaAnalysisResult>(key);

    if (!result) {
      return Response.json(
        { error: "No coaching report available yet. Run the backfill script to generate one." },
        { status: 404 }
      );
    }

    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json(
      { error: `Failed to load meta analysis: ${message}` },
      { status: 500 }
    );
  }
}
