import { createHash } from "crypto";
import { kv } from "@vercel/kv";
import { AnalysisResult } from "./types";

/**
 * Build a deterministic cache key from the PGN.
 * We strip PGN headers/whitespace so that the same game always hashes
 * the same regardless of minor formatting differences.
 */
function cacheKey(pgn: string): string {
  // Strip header tags (e.g. [Event "..."]) and normalize whitespace
  const moves = pgn
    .replace(/\[.*?\]\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const hash = createHash("sha256").update(moves).digest("hex").slice(0, 16);
  return `analysis:${hash}`;
}

/**
 * Try to read a cached analysis from Vercel KV.
 * Returns null if KV is not configured or the key doesn't exist.
 */
export async function getCachedAnalysis(
  pgn: string
): Promise<AnalysisResult | null> {
  try {
    const result = await kv.get<AnalysisResult>(cacheKey(pgn));
    return result ?? null;
  } catch {
    // KV not configured or unavailable — skip silently
    return null;
  }
}

/**
 * Write an analysis result to Vercel KV.
 * TTL: 90 days. Fails silently if KV is not configured.
 */
export async function setCachedAnalysis(
  pgn: string,
  analysis: AnalysisResult
): Promise<void> {
  try {
    await kv.set(cacheKey(pgn), analysis, { ex: 90 * 24 * 60 * 60 });
  } catch {
    // KV not configured or unavailable — skip silently
  }
}
