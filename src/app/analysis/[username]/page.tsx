"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { ChessComGame } from "@/lib/types";
import { getPlayerColor, getPlayerOutcome, getOpponent, formatDate, outcomeColor, outcomeLabel } from "@/lib/utils";
import { useCachedAnalysis } from "@/hooks/use-cached-analysis";
import { AnalysisView } from "@/components/analysis-view";
import { AnalysisSkeleton } from "@/components/loading-skeleton";

export default function AnalysisPage() {
  const params = useParams<{ username: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const username = decodeURIComponent(params.username);
  const gameUrl = searchParams.get("game") || "";

  const [game, setGame] = useState<ChessComGame | null>(null);
  const { analysis, loading, error, fetchAnalysis } =
    useCachedAnalysis(gameUrl);

  useEffect(() => {
    const stored = sessionStorage.getItem("selectedGame");
    if (stored) {
      try {
        const parsed: ChessComGame = JSON.parse(stored);
        if (parsed.url === gameUrl) {
          setGame(parsed);
          return;
        }
      } catch {
        // Ignore parse errors
      }
    }
    // No game in session storage — can't analyze without PGN
    setGame(null);
  }, [gameUrl]);

  useEffect(() => {
    if (game && !analysis && !loading) {
      const color = getPlayerColor(game, username);
      const rating = game[color].rating;
      fetchAnalysis(game.pgn, username, color, rating);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, analysis, loading, username]);

  if (!gameUrl) {
    return (
      <div className="mx-auto max-w-lg md:max-w-2xl px-4 pt-12 text-center">
        <p className="text-gray-400">No game selected.</p>
        <button
          onClick={() => router.push("/")}
          className="mt-4 text-accent-blue"
        >
          Go to search
        </button>
      </div>
    );
  }

  if (!game) {
    return (
      <div className="mx-auto max-w-lg md:max-w-2xl px-4 pt-12 text-center">
        <p className="text-gray-400">
          Game data not available. Please select a game from the list.
        </p>
        <button
          onClick={() => router.push(`/games/${encodeURIComponent(username)}`)}
          className="mt-4 text-accent-blue"
        >
          View games
        </button>
      </div>
    );
  }

  const outcome = getPlayerOutcome(game, username);
  const opponent = getOpponent(game, username);
  const color = getPlayerColor(game, username);

  return (
    <div className="mx-auto max-w-lg md:max-w-2xl px-4 pt-6">
      <button
        onClick={() => router.push(`/games/${encodeURIComponent(username)}`)}
        className="mb-4 min-h-[44px] flex items-center text-sm text-gray-400"
      >
        &larr; Back to games
      </button>

      {/* Game header */}
      <div className="mb-6 rounded-xl bg-surface-card p-4">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm text-gray-400">
              Playing {color} vs
            </span>
            <div className="text-lg md:text-xl font-bold">
              {opponent.username}{" "}
              <span className="text-sm text-gray-500">
                ({opponent.rating})
              </span>
            </div>
          </div>
          <div className={`text-xl md:text-2xl font-bold ${outcomeColor(outcome)}`}>
            {outcomeLabel(outcome)}
          </div>
        </div>
        <div className="mt-1 text-xs text-gray-500">
          {formatDate(game.end_time)} &middot; {game.time_class} &middot; {game.time_control}
        </div>
      </div>

      {/* Analysis */}
      {loading && (
        <div>
          <div className="mb-4 text-center text-gray-400">
            <div className="mb-2 text-2xl">{"\uD83E\uDD14"}</div>
            Coach is reviewing your game...
          </div>
          <AnalysisSkeleton />
        </div>
      )}

      {error && (
        <div className="rounded-lg bg-red-900/30 px-4 py-3 text-accent-red">
          {error}
          <button
            onClick={() => {
              const c = getPlayerColor(game, username);
              fetchAnalysis(game.pgn, username, c, game[c].rating);
            }}
            className="mt-2 block text-sm text-accent-blue"
          >
            Try again
          </button>
        </div>
      )}

      {analysis && <AnalysisView analysis={analysis} pgn={game.pgn} />}
    </div>
  );
}
