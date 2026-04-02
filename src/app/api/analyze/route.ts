import { NextRequest } from "next/server";
import { analyzeGame } from "@/lib/claude";

export async function POST(request: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY not configured" },
      { status: 500 }
    );
  }

  try {
    const body = await request.json();
    const { pgn, username, color, rating } = body;

    if (!pgn || !username || !color) {
      return Response.json(
        { error: "Missing required fields: pgn, username, color" },
        { status: 400 }
      );
    }

    const analysis = await analyzeGame(
      pgn,
      username,
      color,
      rating || 1000
    );

    return Response.json(analysis);
  } catch (error) {
    console.error("Analysis error:", error);
    return Response.json(
      { error: "Failed to analyze game. Please try again." },
      { status: 500 }
    );
  }
}
