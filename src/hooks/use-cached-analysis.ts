import { useState, useEffect } from "react";
import { AnalysisResult } from "@/lib/types";

const CACHE_PREFIX = "analysis:";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface CacheEntry {
  result: AnalysisResult;
  timestamp: number;
}

export function useCachedAnalysis(gameUrl: string) {
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cacheKey = `${CACHE_PREFIX}${gameUrl}`;

  useEffect(() => {
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const entry: CacheEntry = JSON.parse(cached);
        if (Date.now() - entry.timestamp < CACHE_TTL_MS) {
          setAnalysis(entry.result);
        } else {
          localStorage.removeItem(cacheKey);
        }
      }
    } catch {
      // Ignore cache read errors
    }
  }, [cacheKey]);

  async function fetchAnalysis(
    pgn: string,
    username: string,
    color: "white" | "black",
    rating: number
  ) {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pgn, username, color, rating }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Analysis failed");
      }

      const result: AnalysisResult = await res.json();
      setAnalysis(result);

      try {
        const entry: CacheEntry = { result, timestamp: Date.now() };
        localStorage.setItem(cacheKey, JSON.stringify(entry));
      } catch {
        // Ignore cache write errors (quota exceeded, etc.)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return { analysis, loading, error, fetchAnalysis };
}
