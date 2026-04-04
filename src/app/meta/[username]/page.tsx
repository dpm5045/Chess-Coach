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

  useEffect(() => {
    async function loadCachedAnalysis() {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(
          `/api/meta-analyze?username=${encodeURIComponent(username)}`
        );

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to load coaching report");
        }

        const data: MetaAnalysisResult = await res.json();
        setResult(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setLoading(false);
      }
    }

    loadCachedAnalysis();
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
            Loading coaching report&hellip;
          </p>
          <MetaAnalysisSkeleton />
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-lg bg-red-900/30 px-4 py-3 text-accent-red">
          <p>{error}</p>
        </div>
      )}

      {result && <MetaAnalysisView data={result} />}
    </div>
  );
}
