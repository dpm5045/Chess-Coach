"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { MetaAnalysisResult } from "@/lib/types";
import { MetaAnalysisView } from "@/components/meta-analysis-view";
import { MetaAnalysisSkeleton } from "@/components/loading-skeleton";

export default function MetaAnalysisPage() {
  const params = useParams<{ username: string }>();
  const router = useRouter();
  const username = decodeURIComponent(params.username);

  const [result, setResult] = useState<MetaAnalysisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function fetchMetaAnalysis() {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/meta-analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Meta analysis failed");
      }

      const data: MetaAnalysisResult = await res.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchMetaAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username]);

  return (
    <div className="mx-auto max-w-lg md:max-w-2xl px-4 pt-6 pb-8">
      <button
        onClick={() => router.push("/")}
        className="mb-4 text-sm text-gray-400 transition hover:text-gray-200"
      >
        &larr; Back
      </button>

      <h1 className="mb-1 text-2xl font-bold">{username}&apos;s Coaching Report</h1>
      {result && (
        <p className="mb-6 text-sm text-gray-400">
          Based on {result.gamesAnalyzed} games ({result.timeRange})
        </p>
      )}

      {loading && (
        <div>
          <p className="mb-4 text-center text-gray-400">
            Coach is reviewing your game history&hellip;
          </p>
          <MetaAnalysisSkeleton />
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-lg bg-red-900/30 px-4 py-3 text-accent-red">
          <p>{error}</p>
          <button
            onClick={fetchMetaAnalysis}
            className="mt-2 text-sm font-medium text-accent-blue"
          >
            Try again
          </button>
        </div>
      )}

      {result && <MetaAnalysisView data={result} />}
    </div>
  );
}
