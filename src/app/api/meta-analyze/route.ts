import { isAllowedUser } from "@/lib/chess-com";
import { getAllGames } from "@/lib/game-cache";
import { getCachedAnalysis } from "@/lib/analysis-cache";
import { getCachedMetaAnalysis, setCachedMetaAnalysis } from "@/lib/meta-cache";
import { analyzePlayerMeta } from "@/lib/claude";
import { ChessComGame, AnalysisResult } from "@/lib/types";
import { getPlayerColor, getPlayerOutcome, getOpponent, formatDate } from "@/lib/utils";

const MAX_GAMES = 50;

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
  return pgn
    .replace(/\[.*?\]\s*/g, "")
    .replace(/\{[^}]*\}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function buildGamesSummary(
  games: ChessComGame[],
  username: string
): Promise<string> {
  const sections: string[] = [];

  for (const game of games) {
    const color = getPlayerColor(game, username);
    const outcome = getPlayerOutcome(game, username);
    const opponent = getOpponent(game, username);
    const playerRating = game[color].rating;
    const date = formatDate(game.end_time);

    const header = `Game vs ${opponent.username} (${opponent.rating}) on ${date} | ${color} | ${game.time_class} ${game.time_control} | ${outcome} | Rating: ${playerRating}`;

    const cachedAnalysis = await getCachedAnalysis(game.pgn);

    if (cachedAnalysis) {
      sections.push(`${header}\n  ${summarizeAnalysis(cachedAnalysis)}`);
    } else {
      const moves = stripPgnHeaders(game.pgn);
      sections.push(`${header}\n  Moves: ${moves}`);
    }
  }

  return sections.join("\n\n");
}

export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: "Analysis service not configured" },
      { status: 500 }
    );
  }

  let body: { username?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { username } = body;
  if (!username) {
    return Response.json({ error: "Username is required" }, { status: 400 });
  }

  if (!isAllowedUser(username)) {
    return Response.json({ error: "Player not available" }, { status: 403 });
  }

  try {
    const allGames = await getAllGames(username, 3);
    if (allGames.length === 0) {
      return Response.json(
        { error: "No games found for this player" },
        { status: 404 }
      );
    }

    const games = allGames.slice(0, MAX_GAMES);
    const uuids = games.map((g) => g.uuid);

    // Check cache
    const cached = await getCachedMetaAnalysis(username, uuids);
    if (cached) {
      return Response.json(cached);
    }

    // Determine current rating from most recent game
    const latest = games[0];
    const latestColor = getPlayerColor(latest, username);
    const currentRating = latest[latestColor].rating;

    // Build time control breakdown for the prompt
    const tcCounts: Record<string, { total: number; wins: number }> = {};
    for (const g of games) {
      const tc = g.time_class;
      if (!tcCounts[tc]) tcCounts[tc] = { total: 0, wins: 0 };
      tcCounts[tc].total++;
      if (getPlayerOutcome(g, username) === "win") tcCounts[tc].wins++;
    }
    const tcSummary = Object.entries(tcCounts)
      .map(([tc, { total, wins }]) => `${tc}: ${total} games (${wins} wins, ${Math.round(wins / total * 100)}% win rate)`)
      .join(", ");

    const gamesSummary = `Time control breakdown: ${tcSummary}\n\n` + await buildGamesSummary(games, username);
    const result = await analyzePlayerMeta(
      username,
      gamesSummary,
      currentRating,
      games.length
    );

    // Cache result (fire-and-forget)
    setCachedMetaAnalysis(username, uuids, result);

    return Response.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return Response.json(
      { error: `Meta analysis failed: ${message}` },
      { status: 500 }
    );
  }
}
