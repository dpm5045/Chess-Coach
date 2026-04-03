import { EngineAnalysis } from "./types";

const CACHE_PREFIX = "engine-eval:";
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface CacheEntry {
  analysis: EngineAnalysis;
  timestamp: number;
}

function hashMoves(pgn: string): string {
  const moves = pgn
    .replace(/\[.*?\]\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();

  let hash = 0;
  for (let i = 0; i < moves.length; i++) {
    const char = moves.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return `${CACHE_PREFIX}${hash.toString(36)}`;
}

export function getCachedEval(pgn: string): EngineAnalysis | null {
  try {
    const key = hashMoves(pgn);
    const cached = localStorage.getItem(key);
    if (!cached) return null;

    const entry: CacheEntry = JSON.parse(cached);
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
      localStorage.removeItem(key);
      return null;
    }

    return entry.analysis;
  } catch {
    return null;
  }
}

export function setCachedEval(pgn: string, analysis: EngineAnalysis): void {
  try {
    const key = hashMoves(pgn);
    const entry: CacheEntry = { analysis, timestamp: Date.now() };
    localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // Quota exceeded or other error
  }
}
