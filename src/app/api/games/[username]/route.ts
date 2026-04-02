import { NextRequest } from "next/server";
import {
  fetchArchives,
  fetchGamesFromArchive,
  isAllowedUser,
} from "@/lib/chess-com";
import { getCachedGames, setCachedGames } from "@/lib/game-cache";
import { ChessComGame } from "@/lib/types";

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

  // Check Redis cache first
  const cached = await getCachedGames(username);
  if (cached) {
    // Apply the same month/game limits the client expects
    const cutoff = Date.now() / 1000 - months * 30 * 24 * 60 * 60;
    const filtered = cached
      .filter((g) => g.end_time >= cutoff)
      .slice(0, MAX_GAMES);
    return Response.json({ games: filtered });
  }

  try {
    const archives = await fetchArchives(username);

    if (archives.length === 0) {
      return Response.json({ games: [] });
    }

    const recentArchives = archives.slice(-months);

    const archiveResults = await Promise.all(
      recentArchives.map((url) => fetchGamesFromArchive(url))
    );

    const allGames: ChessComGame[] = archiveResults
      .flat()
      .filter((game) => game.pgn)
      .sort((a, b) => b.end_time - a.end_time)
      .slice(0, MAX_GAMES);

    // Cache miss — store in Redis for next time (fire-and-forget)
    setCachedGames(username, allGames);

    return Response.json({ games: allGames });
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
