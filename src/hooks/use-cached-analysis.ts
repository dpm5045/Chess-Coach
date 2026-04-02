import { useState } from "react";
import { AnalysisResult } from "@/lib/types";

const CACHE_PREFIX = "analysis:";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface CacheEntry {
  result: AnalysisResult;
  timestamp: number;
}

export function useCachedAnalysis(gameUrl: string) {
  const cacheKey = `${CACHE_PREFIX}${gameUrl}`;

  // Check localStorage synchronously to set initial state
  const initial = (() => {
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const entry: CacheEntry = JSON.parse(cached);
        if (Date.now() - entry.timestamp < CACHE_TTL_MS) {
          return entry.result;
        }
        localStorage.removeItem(cacheKey);
      }
    } catch {
      // Ignore cache read errors
    }
    return null;
  })();

  const [analysis, setAnalysis] = useState<AnalysisResult | null>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function saveToLocalStorage(result: AnalysisResult) {
    try {
      const entry: CacheEntry = { result, timestamp: Date.now() };
      localStorage.setItem(cacheKey, JSON.stringify(entry));
    } catch {
      // Ignore cache write errors (quota exceeded, etc.)
    }
  }

  /**
   * Check the server-side Redis cache only (no Claude API call).
   * If cached, loads the result. If not, does nothing.
   */
  async function checkCache(pgn: string) {
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pgn, username: "_", color: "white", cacheOnly: true }),
      });

      if (res.status === 204) return; // Not cached — do nothing

      if (res.ok) {
        const result: AnalysisResult = await res.json();
        setAnalysis(result);
        saveToLocalStorage(result);
      }
    } catch {
      // Cache check failed — not critical, do nothing
    }
  }

  /**
   * Request a full analysis from Claude (costs API credits).
   * Only call this when the user explicitly clicks "Analyze".
   */
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
      saveToLocalStorage(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return { analysis, loading, error, checkCache, fetchAnalysis };
}
