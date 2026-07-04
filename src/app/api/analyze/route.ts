import { NextRequest } from "next/server";
import { analyzeGame } from "@/lib/claude";
import { isAllowedUser } from "@/lib/chess-com";
import { getCachedAnalysis, setCachedAnalysis } from "@/lib/analysis-cache";
import { AnalyzeRequestSchema } from "@/lib/schemas";
import { findEvalDrops } from "@/lib/engine-core";
import { getAllMoves } from "@/lib/chess-utils";
import { allowRequest } from "@/lib/rate-limit";
import { ANALYSIS_VERSION, EngineAnalysis } from "@/lib/types";

export async function POST(request: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = AnalyzeRequestSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: "Invalid request" }, { status: 400 });
    }
    const { pgn, username, color, rating, cacheOnly, engineEvals } = parsed.data;

    // Allowlist check comes before any cache read — the cache is shared.
    if (!isAllowedUser(username)) {
      return Response.json({ error: "Player not available" }, { status: 403 });
    }

    const cached = await getCachedAnalysis(pgn);
    if (cached) {
      return Response.json(cached);
    }

    // If cache-only mode, don't call Claude — just report the miss
    if (cacheOnly) {
      return new Response(null, { status: 204 });
    }

    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    if (!allowRequest(`analyze:${ip}`, 10, 60_000)) {
      return Response.json({ error: "Too many requests" }, { status: 429 });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return Response.json(
        { error: "ANTHROPIC_API_KEY not configured" },
        { status: 500 }
      );
    }

    // Never trust client-derived analysis data: verify the submitted positions
    // actually correspond to this PGN, and recompute the eval drops here.
    let serverEvals: EngineAnalysis | undefined;
    if (engineEvals) {
      const moves = getAllMoves(pgn);
      const aligned =
        engineEvals.positions.length === moves.length &&
        engineEvals.positions.every((p, i) => p.san === moves[i].san);
      if (!aligned) {
        return Response.json(
          { error: "engineEvals do not match the submitted PGN" },
          { status: 400 }
        );
      }
      serverEvals = {
        positions: engineEvals.positions,
        drops: findEvalDrops(engineEvals.positions, moves),
      };
    }

    const analysis = await analyzeGame(pgn, username, color, rating || 1000, serverEvals);
    const tagged = { ...analysis, source: "claude" as const, analysisVersion: ANALYSIS_VERSION };

    // Store in cache for future requests (fire-and-forget)
    setCachedAnalysis(pgn, tagged);

    return Response.json(tagged);
  } catch (error) {
    console.error("Analysis error:", error);
    return Response.json(
      { error: "Failed to analyze game. Please try again." },
      { status: 500 }
    );
  }
}
