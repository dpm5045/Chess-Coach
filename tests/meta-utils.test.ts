import { describe, it, expect } from "vitest";
import { selectGamesForFilter } from "@/lib/meta-utils";

const game = (time_class: string, end_time: number) => ({ time_class, end_time });

describe("selectGamesForFilter", () => {
  const games = [
    game("rapid", 100),
    game("blitz", 400),
    game("rapid", 300),
    game("bullet", 500),
    game("daily", 50),
    game("blitz", 200),
  ];

  it("returns only games of the requested time class, most recent first", () => {
    expect(selectGamesForFilter(games, "rapid")).toEqual([
      game("rapid", 300),
      game("rapid", 100),
    ]);
  });

  it("passes every time class through for 'all', sorted by recency", () => {
    const all = selectGamesForFilter(games, "all");
    expect(all.map((g) => g.end_time)).toEqual([500, 400, 300, 200, 100, 50]);
  });

  it("respects the max parameter", () => {
    expect(selectGamesForFilter(games, "all", 2)).toEqual([
      game("bullet", 500),
      game("blitz", 400),
    ]);
  });

  it("does not mutate the input array", () => {
    const copy = [...games];
    selectGamesForFilter(games, "all");
    expect(games).toEqual(copy);
  });
});
