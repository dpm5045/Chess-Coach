import { NextRequest } from "next/server";
import { analyzeGame } from "@/lib/claude";
import { isAllowedUser } from "@/lib/chess-com";
import { getCachedAnalysis, setCachedAnalysis } from "@/lib/analysis-cache";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { pgn, username, color, rating, cacheOnly, engineEvals } = body;

    if (!pgn || !username || !color) {
      return Response.json(
        { error: "Missing required fields: pgn, username, color" },
        { status: 400 }
      );
    }

    // Check server-side cache first to avoid redundant Claude API calls
    const cached = await getCachedAnalysis(pgn);
    if (cached) {
      return Response.json(cached);
    }

    // If cache-only mode, don't call Claude — just report the miss
    if (cacheOnly) {
      return new Response(null, { status: 204 });
    }

    if (!isAllowedUser(username)) {
      return Response.json({ error: "Player not available" }, { status: 403 });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return Response.json(
        { error: "ANTHROPIC_API_KEY not configured" },
        { status: 500 }
      );
    }

    const analysis = await analyzeGame(pgn, username, color, rating || 1000, engineEvals);

    // Store in cache for future requests (fire-and-forget)
    setCachedAnalysis(pgn, analysis);

    return Response.json(analysis);
  } catch (error) {
    console.error("Analysis error:", error);
    return Response.json(
      { error: "Failed to analyze game. Please try again." },
      { status: 500 }
    );
  }
}
