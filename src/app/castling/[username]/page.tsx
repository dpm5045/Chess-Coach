"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { CastlingAnalysisResult } from "@/lib/types";
import { CastlingAnalysisView } from "@/components/castling-analysis-view";
import { CastlingAnalysisSkeleton } from "@/components/loading-skeleton";

export default function CastlingAnalysisPage() {
  const params = useParams<{ username: string }>();
  const router = useRouter();
  const username = decodeURIComponent(params.username);

  const [result, setResult] = useState<CastlingAnalysisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/castling-analysis/${encodeURIComponent(username)}`
        );
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to load castling analysis");
        }
        const data: CastlingAnalysisResult = await res.json();
        setResult(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [username]);

  return (
    <div className="mx-auto max-w-lg md:max-w-2xl px-4 pt-6 pb-8">
      <button
        onClick={() => router.push("/")}
        className="mb-4 text-sm text-gray-400 transition hover:text-gray-200"
      >
        &larr; Back
      </button>

      <h1 className="mb-1 text-2xl font-bold">Castling Analysis</h1>
      {result && (
        <p className="mb-6 text-sm text-gray-400">
          {username} &middot; last 3 months &middot; {result.gamesAnalyzed} games
        </p>
      )}

      {loading && (
        <div>
          <p className="mb-4 text-center text-gray-400">Analyzing castling patterns&hellip;</p>
          <CastlingAnalysisSkeleton />
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-lg bg-red-900/30 px-4 py-3 text-accent-red">
          <p>{error}</p>
        </div>
      )}

      {result && <CastlingAnalysisView data={result} />}
    </div>
  );
}
