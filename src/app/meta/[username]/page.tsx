import Link from "next/link";
import { notFound } from "next/navigation";
import { ALLOWED_USERS, isAllowedUser } from "@/lib/chess-com";
import { getAllGames } from "@/lib/game-cache";
import { getCachedAnalysis } from "@/lib/analysis-cache";
import { getCachedMetaAnalysis, setCachedMetaAnalysis } from "@/lib/meta-cache";
import { analyzePlayerMeta } from "@/lib/claude";
import { ChessComGame, AnalysisResult } from "@/lib/types";
import { getPlayerColor, getPlayerOutcome, getOpponent, formatDate } from "@/lib/utils";
import { MetaAnalysisView } from "@/components/meta-analysis-view";

const MAX_GAMES = 50;

export async function generateStaticParams() {
  return ALLOWED_USERS.map((username) => ({ username }));
}

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

export default async function MetaAnalysisPage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;

  if (!isAllowedUser(username)) {
    notFound();
  }

  const allGames = await getAllGames(username, 3);
  if (allGames.length === 0) {
    return (
      <div className="mx-auto max-w-lg md:max-w-2xl px-4 pt-6 pb-8">
        <Link href="/" className="mb-4 inline-block text-sm text-gray-400 transition hover:text-gray-200">
          &larr; Back
        </Link>
        <h1 className="mb-1 text-2xl font-bold">{username}&apos;s Coaching Report</h1>
        <p className="text-gray-400">No games found for this player.</p>
      </div>
    );
  }

  const games = allGames.slice(0, MAX_GAMES);
  const uuids = games.map((g) => g.uuid);

  // Check cache first
  let result = await getCachedMetaAnalysis(username, uuids);

  if (!result) {
    const latest = games[0];
    const latestColor = getPlayerColor(latest, username);
    const currentRating = latest[latestColor].rating;

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
    result = await analyzePlayerMeta(username, gamesSummary, currentRating, games.length);

    setCachedMetaAnalysis(username, uuids, result);
  }

  return (
    <div className="mx-auto max-w-lg md:max-w-2xl px-4 pt-6 pb-8">
      <Link href="/" className="mb-4 inline-block text-sm text-gray-400 transition hover:text-gray-200">
        &larr; Back
      </Link>

      <h1 className="mb-1 text-2xl font-bold">{username}&apos;s Coaching Report</h1>
      <p className="mb-6 text-sm text-gray-400">
        Based on {result.gamesAnalyzed} games ({result.timeRange})
      </p>

      <MetaAnalysisView data={result} />
    </div>
  );
}
