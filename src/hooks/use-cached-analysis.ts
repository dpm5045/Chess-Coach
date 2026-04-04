import { useState } from "react";
import { AnalysisResult, EngineAnalysis } from "@/lib/types";
import { getAllMoves } from "@/lib/chess-utils";
import { evaluateGame } from "@/lib/stockfish";
import { getCachedEval, setCachedEval } from "@/lib/eval-cache";

const CACHE_PREFIX = "analysis:";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface CacheEntry {
  result: AnalysisResult;
  timestamp: number;
}

export type AnalysisPhase = "idle" | "engine" | "coaching" | "done" | "error";

export function useCachedAnalysis(gameUrl: string) {
  const cacheKey = `${CACHE_PREFIX}${gameUrl}`;

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
  const [engineAnalysis, setEngineAnalysis] = useState<EngineAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<AnalysisPhase>("idle");
  const [engineProgress, setEngineProgress] = useState({ completed: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);

  function saveToLocalStorage(result: AnalysisResult) {
    try {
      const entry: CacheEntry = { result, timestamp: Date.now() };
      localStorage.setItem(cacheKey, JSON.stringify(entry));
    } catch {
      // Ignore cache write errors
    }
  }

  async function checkCache(pgn: string) {
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pgn, username: "_", color: "white", cacheOnly: true }),
      });

      if (res.status === 204) return;

      if (res.ok) {
        const result: AnalysisResult = await res.json();
        setAnalysis(result);
        saveToLocalStorage(result);
        setPhase("done");
      }
    } catch {
      // Cache check failed — not critical
    }
  }

  async function fetchAnalysis(
    pgn: string,
    username: string,
    color: "white" | "black",
    rating: number
  ) {
    setLoading(true);
    setError(null);
    setPhase("engine");

    try {
      // Phase 1: Run Stockfish engine evaluation (client-side)
      let evals: EngineAnalysis | null = getCachedEval(pgn);

      if (!evals) {
        const moves = getAllMoves(pgn);
        if (moves.length === 0) {
          throw new Error("Could not parse game moves. The PGN may be empty or invalid.");
        }
        evals = await evaluateGame(moves, (completed, total) => {
          setEngineProgress({ completed, total });
        });
        setCachedEval(pgn, evals);
      }

      setEngineAnalysis(evals);
      setPhase("coaching");

      // Phase 2: Send PGN + engine evals to Claude for coaching commentary
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pgn, username, color, rating, engineEvals: evals }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Analysis failed");
      }

      const result: AnalysisResult = await res.json();
      setAnalysis(result);
      saveToLocalStorage(result);
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setPhase("error");
    } finally {
      setLoading(false);
    }
  }

  return { analysis, engineAnalysis, loading, phase, engineProgress, error, checkCache, fetchAnalysis };
}
