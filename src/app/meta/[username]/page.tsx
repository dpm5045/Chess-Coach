"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { MetaAnalysisResult, MetaFilter } from "@/lib/types";
import { MetaAnalysisView } from "@/components/meta-analysis-view";
import { MetaAnalysisSkeleton } from "@/components/loading-skeleton";

const FILTER_TABS: { label: string; value: MetaFilter }[] = [
  { label: "Rapid", value: "rapid" },
  { label: "Blitz", value: "blitz" },
  { label: "All", value: "all" },
];

export default function MetaAnalysisPage() {
  const params = useParams<{ username: string }>();
  const router = useRouter();
  const username = decodeURIComponent(params.username);

  const [filter, setFilter] = useState<MetaFilter>("rapid");
  const [results, setResults] = useState<Partial<Record<MetaFilter, MetaAnalysisResult>>>({});
  const [emptyMessages, setEmptyMessages] = useState<Partial<Record<MetaFilter, string>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const result = results[filter] ?? null;
  const emptyMessage = emptyMessages[filter] ?? null;

  useEffect(() => {
    // Already have this tab's report (or its empty state) — nothing to fetch
    if (results[filter] || emptyMessages[filter]) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    async function loadCachedAnalysis() {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(
          `/api/meta-analyze?username=${encodeURIComponent(username)}&filter=${filter}`
        );

        const data = await res.json();
        if (cancelled) return;

        if (res.status === 404) {
          setEmptyMessages((prev) => ({ ...prev, [filter]: data.error }));
        } else if (!res.ok) {
          throw new Error(data.error || "Failed to load coaching report");
        } else {
          setResults((prev) => ({ ...prev, [filter]: data }));
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Something went wrong");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadCachedAnalysis();
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, filter]);

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
        <p className="mb-4 text-sm text-gray-400">
          Based on {result.gamesAnalyzed} {filter === "all" ? "" : `${filter} `}games ({result.timeRange})
        </p>
      )}

      <div className="mb-6 flex gap-2 overflow-x-auto pb-2">
        {FILTER_TABS.map(({ label, value }) => (
          <button
            key={value}
            onClick={() => setFilter(value)}
            className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              filter === value
                ? "bg-accent-blue text-white"
                : "bg-surface-card text-gray-400 hover:text-gray-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading && (
        <div>
          <p className="mb-4 text-center text-gray-400">
            Loading coaching report&hellip;
          </p>
          <MetaAnalysisSkeleton />
        </div>
      )}

      {error && !loading && (
        <div className="mb-4 rounded-lg bg-red-900/30 px-4 py-3 text-accent-red">
          <p>{error}</p>
        </div>
      )}

      {emptyMessage && !loading && !error && (
        <div className="rounded-xl bg-surface-card p-6 text-center text-gray-400">
          <p>{emptyMessage}</p>
        </div>
      )}

      {result && !loading && <MetaAnalysisView data={result} />}
    </div>
  );
}
