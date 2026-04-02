import { getRedis } from "./analysis-cache";
import { ChessComGame } from "./types";

function gamesKey(username: string): string {
  return `games:${username.toLowerCase()}`;
}

/**
 * Read cached games for a user from Redis.
 * Returns null if Redis is not configured or key doesn't exist.
 */
export async function getCachedGames(
  username: string
): Promise<ChessComGame[] | null> {
  try {
    const redis = getRedis();
    if (!redis) return null;
    const games = await redis.get<ChessComGame[]>(gamesKey(username));
    return games ?? null;
  } catch {
    return null;
  }
}

/**
 * Write a user's full game list to Redis (no TTL — historical games don't change).
 */
export async function setCachedGames(
  username: string,
  games: ChessComGame[]
): Promise<void> {
  try {
    const redis = getRedis();
    if (!redis) return;
    await redis.set(gamesKey(username), games);
  } catch {
    // Redis not configured or unavailable — skip silently
  }
}
