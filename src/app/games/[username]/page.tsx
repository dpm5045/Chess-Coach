"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ChessComGame, TimeClass } from "@/lib/types";
import { GameFilterTabs } from "@/components/game-filter-tabs";
import { GameListItem } from "@/components/game-list-item";
import { GameListSkeleton } from "@/components/loading-skeleton";

type FilterOption = TimeClass | "all";

export default function GamesPage() {
  const params = useParams<{ username: string }>();
  const router = useRouter();
  const username = decodeURIComponent(params.username);

  const [games, setGames] = useState<ChessComGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterOption>("rapid");

  useEffect(() => {
    async function loadGames() {
      try {
        const res = await fetch(`/api/games/${encodeURIComponent(username)}`);
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to load games");
        }
        const data = await res.json();
        setGames(data.games);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setLoading(false);
      }
    }
    loadGames();
  }, [username]);

  const filteredGames =
    filter === "all"
      ? games
      : games.filter((g) => g.time_class === filter);

  function handleGameClick(game: ChessComGame) {
    sessionStorage.setItem("selectedGame", JSON.stringify(game));
    router.push(
      `/analysis/${encodeURIComponent(username)}?game=${encodeURIComponent(game.url)}`
    );
  }

  return (
    <div className="mx-auto max-w-lg md:max-w-2xl px-4 pt-6">
      <button
        onClick={() => router.push("/")}
        className="mb-4 min-h-[44px] flex items-center text-sm text-gray-400"
      >
        &larr; Back to search
      </button>

      <h1 className="mb-1 text-xl font-bold">{username}</h1>
      <p className="mb-4 text-sm text-gray-400">
        {games.length} games loaded
      </p>

      <GameFilterTabs selected={filter} onSelect={setFilter} />

      <div className="mt-4 space-y-2">
        {loading && <GameListSkeleton />}

        {error && (
          <div className="rounded-lg bg-red-900/30 px-4 py-3 text-accent-red">
            {error}
          </div>
        )}

        {!loading && !error && filteredGames.length === 0 && (
          <div className="py-8 text-center text-gray-500">
            No {filter === "all" ? "" : filter} games found in the last 3 months.
          </div>
        )}

        {filteredGames.map((game) => (
          <GameListItem
            key={game.uuid}
            game={game}
            username={username}
            onClick={() => handleGameClick(game)}
          />
        ))}
      </div>
    </div>
  );
}
