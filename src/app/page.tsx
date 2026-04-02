"use client";

import { useState } from "react";
import { PlayerProfile } from "@/lib/types";
import { PlayerCard } from "@/components/player-card";
import { PlayerCardSkeleton } from "@/components/loading-skeleton";
import { useRouter } from "next/navigation";
import { ALLOWED_USERS } from "@/lib/chess-com";

export default function Home() {
  const router = useRouter();
  const [playerData, setPlayerData] = useState<PlayerProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSelect(username: string) {
    setLoading(true);
    setError(null);
    setPlayerData(null);

    try {
      const res = await fetch(`/api/player/${encodeURIComponent(username)}`);
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
    <div className="mx-auto max-w-lg md:max-w-2xl px-4 pt-12">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold">&#9823; Chess Coach</h1>
        <p className="mt-2 text-gray-400">
          AI-powered analysis for your Chess.com games
        </p>
      </div>

      <div className="mb-6 flex gap-3">
        {ALLOWED_USERS.map((user) => (
          <button
            key={user}
            onClick={() => handleSelect(user)}
            disabled={loading}
            className="flex-1 rounded-lg bg-surface-card px-4 py-4 text-lg font-semibold text-gray-200 ring-1 ring-gray-700 transition hover:ring-accent-blue disabled:opacity-50"
          >
            {user}
          </button>
        ))}
      </div>

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
            Analyze Games
          </button>
        </div>
      )}
    </div>
  );
}
