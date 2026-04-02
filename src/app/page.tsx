"use client";

import { useEffect, useState } from "react";
import { PlayerProfile } from "@/lib/types";
import { PlayerCard } from "@/components/player-card";
import { PlayerCardSkeleton } from "@/components/loading-skeleton";
import { useRouter } from "next/navigation";
import { ALLOWED_USERS } from "@/lib/chess-com";

export default function Home() {
  const router = useRouter();
  const [players, setPlayers] = useState<Map<string, PlayerProfile>>(new Map());
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    async function fetchAll() {
      const results = await Promise.allSettled(
        ALLOWED_USERS.map(async (username) => {
          const res = await fetch(`/api/player/${encodeURIComponent(username)}`);
          if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || "Player not found");
          }
          const data: PlayerProfile = await res.json();
          return { username, data };
        })
      );

      const newPlayers = new Map<string, PlayerProfile>();
      const newErrors = new Map<string, string>();

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === "fulfilled") {
          newPlayers.set(result.value.username, result.value.data);
        } else {
          const msg = result.reason instanceof Error ? result.reason.message : "Something went wrong";
          newErrors.set(ALLOWED_USERS[i], msg);
        }
      }

      setPlayers(newPlayers);
      setErrors(newErrors);
      setLoading(false);
    }

    fetchAll();
  }, []);

  return (
    <div className="mx-auto max-w-lg md:max-w-2xl px-4 pt-12">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold">&#9823; Chess Coach</h1>
        <p className="mt-2 text-gray-400">
          AI-powered analysis for your Chess.com games
        </p>
      </div>

      <div className="space-y-6">
        {ALLOWED_USERS.map((user) => {
          const data = players.get(user);
          const error = errors.get(user);

          return (
            <div key={user}>
              {loading && <PlayerCardSkeleton />}

              {error && (
                <div className="rounded-lg bg-red-900/30 px-4 py-3 text-accent-red">
                  {user}: {error}
                </div>
              )}

              {data && (
                <div className="space-y-3">
                  <PlayerCard data={data} />
                  <button
                    onClick={() =>
                      router.push(`/games/${encodeURIComponent(data.profile.username)}`)
                    }
                    className="w-full rounded-lg bg-accent-green py-3 text-lg font-semibold text-white"
                  >
                    Analyze Games
                  </button>
                  <button
                    onClick={() =>
                      router.push(`/meta/${encodeURIComponent(data.profile.username)}`)
                    }
                    className="w-full rounded-lg bg-accent-blue py-3 text-lg font-semibold text-white"
                  >
                    Meta Analysis
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
