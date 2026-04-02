import { NextRequest } from "next/server";
import { isAllowedUser } from "@/lib/chess-com";
import { getAllGames } from "@/lib/game-cache";

const MAX_MONTHS = 3;
const MAX_GAMES = 100;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  const { username } = await params;

  if (!isAllowedUser(username)) {
    return Response.json({ error: "Player not available" }, { status: 403 });
  }

  const searchParams = request.nextUrl.searchParams;
  const months = Math.min(
    parseInt(searchParams.get("months") || String(MAX_MONTHS), 10),
    12
  );

  try {
    const games = await getAllGames(username, months);
    return Response.json({ games: games.slice(0, MAX_GAMES) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("404")) {
      return Response.json(
        { error: `Player "${username}" not found` },
        { status: 404 }
      );
    }
    return Response.json(
      { error: "Failed to fetch games" },
      { status: 500 }
    );
  }
}
