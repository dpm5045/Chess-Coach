import { NextRequest } from "next/server";
import { fetchPlayer, fetchStats, isAllowedUser } from "@/lib/chess-com";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  const { username } = await params;

  if (!isAllowedUser(username)) {
    return Response.json({ error: "Player not available" }, { status: 403 });
  }

  try {
    const [profile, stats] = await Promise.all([
      fetchPlayer(username),
      fetchStats(username),
    ]);

    return Response.json({ profile, stats });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("404")) {
      return Response.json(
        { error: `Player "${username}" not found on Chess.com` },
        { status: 404 }
      );
    }
    return Response.json(
      { error: "Failed to fetch player data" },
      { status: 500 }
    );
  }
}
