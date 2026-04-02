"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PlayerProfile } from "@/lib/types";
import { PlayerCard } from "@/components/player-card";
import { PlayerCardSkeleton } from "@/components/loading-skeleton";

export default function Home() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [playerData, setPlayerData] = useState<PlayerProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim()) return;

    setLoading(true);
    setError(null);
    setPlayerData(null);

    try {
      const res = await fetch(`/api/player/${encodeURIComponent(username.trim())}`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Player not found");
      }
      const data: PlayerProfile = await res.json();
      setPlayerData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 pt-12">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold">&#9823; Chess Coach</h1>
        <p className="mt-2 text-gray-400">
          AI-powered analysis for your Chess.com games
        </p>
      </div>

      <form onSubmit={handleSearch} className="mb-6">
        <div className="flex gap-2">
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Chess.com username"
            className="flex-1 rounded-lg bg-surface-card px-4 py-3 text-gray-200 placeholder-gray-500 outline-none ring-1 ring-gray-700 focus:ring-accent-blue"
          />
          <button
            type="submit"
            disabled={loading || !username.trim()}
            className="rounded-lg bg-accent-blue px-6 py-3 font-semibold text-white disabled:opacity-50"
          >
            {loading ? "..." : "Search"}
          </button>
        </div>
      </form>

      {error && (
        <div className="mb-4 rounded-lg bg-red-900/30 px-4 py-3 text-accent-red">
          {error}
        </div>
      )}

      {loading && <PlayerCardSkeleton />}

      {playerData && (
        <div className="space-y-4">
          <PlayerCard data={playerData} />
          <button
            onClick={() =>
              router.push(`/games/${encodeURIComponent(playerData.profile.username)}`)
            }
            className="w-full rounded-lg bg-accent-green py-3 text-lg font-semibold text-white"
          >
            View Games
          </button>
        </div>
      )}
    </div>
  );
}
