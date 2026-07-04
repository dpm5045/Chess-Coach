import { MetaFilter } from "./types";

/**
 * Select the games a meta-analysis report is built from: the `max` most
 * recent games matching the filter ("all" passes every time class).
 */
export function selectGamesForFilter<
  T extends { time_class: string; end_time: number }
>(games: T[], filter: MetaFilter, max = 50): T[] {
  return games
    .filter((g) => filter === "all" || g.time_class === filter)
    .sort((a, b) => b.end_time - a.end_time)
    .slice(0, max);
}
