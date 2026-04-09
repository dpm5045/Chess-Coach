import { createHash } from "crypto";
import { Redis } from "@upstash/redis";
import { AnalysisResult } from "./types";

/**
 * Lazily initialize the Redis client.
 * Returns null if the required env vars are not set.
 */
export function getRedis(): Redis | null {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

/**
 * Build a deterministic cache key from the PGN.
 * We strip PGN headers/whitespace so that the same game always hashes
 * the same regardless of minor formatting differences.
 */
export function analysisCacheKey(pgn: string): string {
  const moves = pgn
    .replace(/\[.*?\]\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const hash = createHash("sha256").update(moves).digest("hex").slice(0, 16);
  return `analysis:${hash}`;
}

/**
 * Try to read a cached analysis from Upstash Redis.
 * Returns null if Redis is not configured or the key doesn't exist.
 */
export async function getCachedAnalysis(
  pgn: string
): Promise<AnalysisResult | null> {
  try {
    const redis = getRedis();
    if (!redis) return null;
    const result = await redis.get<AnalysisResult>(analysisCacheKey(pgn));
    return result ?? null;
  } catch {
    return null;
  }
}

/**
 * Write an analysis result to Upstash Redis.
 * TTL: 90 days. Fails silently if Redis is not configured.
 */
export async function setCachedAnalysis(
  pgn: string,
  analysis: AnalysisResult
): Promise<void> {
  try {
    const redis = getRedis();
    if (!redis) return;
    await redis.set(analysisCacheKey(pgn), analysis, { ex: 90 * 24 * 60 * 60 });
  } catch {
    // Redis not configured or unavailable — skip silently
  }
}
