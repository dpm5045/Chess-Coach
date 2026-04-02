import { createHash } from "crypto";
import { getRedis } from "./analysis-cache";
import { MetaAnalysisResult } from "./types";

function metaCacheKey(username: string, gameUuids: string[]): string {
  const sorted = [...gameUuids].sort().join(",");
  const hash = createHash("sha256").update(sorted).digest("hex").slice(0, 16);
  return `meta:${username.toLowerCase()}:${hash}`;
}

export async function getCachedMetaAnalysis(
  username: string,
  gameUuids: string[]
): Promise<MetaAnalysisResult | null> {
  try {
    const redis = getRedis();
    if (!redis) return null;
    const result = await redis.get<MetaAnalysisResult>(
      metaCacheKey(username, gameUuids)
    );
    return result ?? null;
  } catch {
    return null;
  }
}

export async function setCachedMetaAnalysis(
  username: string,
  gameUuids: string[],
  result: MetaAnalysisResult
): Promise<void> {
  try {
    const redis = getRedis();
    if (!redis) return;
    await redis.set(metaCacheKey(username, gameUuids), result, {
      ex: 14 * 24 * 60 * 60,
    });
  } catch {
    // Redis not configured or unavailable — skip silently
  }
}
