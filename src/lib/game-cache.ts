import { getRedis } from "./analysis-cache";
import { fetchArchives, fetchGamesFromArchive } from "./chess-com";
import { ChessComGame } from "./types";

const CURRENT_MONTH_TTL = 5 * 60; // 5 minutes
const ARCHIVES_TTL = 5 * 60; // 5 minutes

function archivesKey(username: string): string {
  return `archives:${username.toLowerCase()}`;
}

function archiveGamesKey(username: string, year: string, month: string): string {
  return `games:${username.toLowerCase()}:${year}/${month}`;
}

/** Extract year and month from a Chess.com archive URL. */
function parseArchiveUrl(url: string): { year: string; month: string } {
  const parts = url.split("/");
  return { year: parts[parts.length - 2], month: parts[parts.length - 1] };
}

function isCurrentMonth(year: string, month: string): boolean {
  const now = new Date();
  return (
    parseInt(year, 10) === now.getFullYear() &&
    parseInt(month, 10) === now.getMonth() + 1
  );
}

/**
 * Get all games for a user, using per-archive Redis caching.
 * Past months are cached permanently. Current month has a 5-min TTL.
 * Only fetches from Chess.com on cache miss.
 */
export async function getAllGames(
  username: string,
  months: number
): Promise<ChessComGame[]> {
  const redis = getRedis();

  // Step 1: Get archive list (cached or fetched)
  let archives: string[];
  if (redis) {
    const cached = await redis.get<string[]>(archivesKey(username));
    if (cached) {
      archives = cached;
    } else {
      archives = await fetchArchives(username);
      redis.set(archivesKey(username), archives, { ex: ARCHIVES_TTL });
    }
  } else {
    archives = await fetchArchives(username);
  }

  if (archives.length === 0) return [];

  // Step 2: Slice to requested month range
  const recentArchives = archives.slice(-months);

  // Step 3: For each archive, check Redis then fetch on miss
  const allGames: ChessComGame[] = [];

  for (const archiveUrl of recentArchives) {
    const { year, month } = parseArchiveUrl(archiveUrl);
    const key = archiveGamesKey(username, year, month);

    let games: ChessComGame[] | null = null;

    if (redis) {
      games = await redis.get<ChessComGame[]>(key);
    }

    if (!games) {
      games = await fetchGamesFromArchive(archiveUrl);
      if (redis) {
        const ttl = isCurrentMonth(year, month) ? { ex: CURRENT_MONTH_TTL } : {};
        redis.set(key, games, ttl);
      }
    }

    allGames.push(...games);
  }

  return allGames
    .filter((g) => g.pgn)
    .sort((a, b) => b.end_time - a.end_time);
}
