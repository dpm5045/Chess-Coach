/**
 * Aggregate themes from CastleDoon's 50 most recent Rapid games.
 * Pulls cached per-game analyses from Redis and emits a structured JSON
 * aggregate to scripts/data/castledoon-rapid-report.json.
 *
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/rapid-report.ts
 */

import { Redis } from "@upstash/redis";
import { createHash } from "crypto";
import { Chess } from "chess.js";
import * as fs from "fs";
import * as path from "path";

const USER = (process.argv[2] || "castledoon").toLowerCase();
const MAX_GAMES = 50;

interface PlayerResult { username: string; rating: number; result: string; }
interface Game {
  url: string; pgn: string; uuid: string; time_class: string;
  time_control: string; white: PlayerResult; black: PlayerResult; end_time: number;
}
interface CriticalMoment { moveNumber: number; move: string; type: string; comment: string; suggestion: string; }
interface Analysis {
  opening: { name: string; assessment: string; comment: string };
  criticalMoments: CriticalMoment[];
  positionalThemes: string;
  endgame: { reached: boolean; comment: string };
  summary: { overallAssessment: string; focusArea: string; battleAllusion?: { title: string; subtitle?: string; summary?: string } };
  missedMatesInOne?: Array<{ moveNumber: number; color: string; playedSan: string; mateSan: string }>;
}

function getRedis(): Redis {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error("Missing KV_REST_API_URL or KV_REST_API_TOKEN");
  return new Redis({ url, token });
}

function analysisCacheKey(pgn: string): string {
  const moves = pgn.replace(/\[.*?\]\s*/g, "").replace(/\s+/g, " ").trim();
  const hash = createHash("sha256").update(moves).digest("hex").slice(0, 16);
  return `analysis:${hash}`;
}

function outcome(result: string): "win" | "draw" | "loss" {
  if (result === "win") return "win";
  if (["stalemate", "insufficient", "repetition", "agreed", "50move", "timevsinsufficient"].includes(result)) return "draw";
  return "loss";
}

function totalPlies(pgn: string): number {
  try { const c = new Chess(); c.loadPgn(pgn); return c.history().length; } catch { return 0; }
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

async function main() {
  const redis = getRedis();
  const dataDir = path.join(process.cwd(), "scripts", "data");
  const allGames: Game[] = JSON.parse(fs.readFileSync(path.join(dataDir, `${USER}-games.json`), "utf8"));

  const rapid = allGames
    .filter((g) => g.time_class === "rapid" && g.pgn)
    .sort((a, b) => b.end_time - a.end_time)
    .slice(0, MAX_GAMES);

  const games = [] as Array<{
    date: string; opponent: string; opponentRating: number; playerRating: number;
    color: "white" | "black"; outcome: "win" | "draw" | "loss"; result: string;
    plies: number; analysis: Analysis | null;
  }>;

  for (const g of rapid) {
    const isWhite = g.white.username.toLowerCase() === USER;
    const color = isWhite ? "white" as const : "black" as const;
    const me = isWhite ? g.white : g.black;
    const opp = isWhite ? g.black : g.white;
    const analysis = await redis.get<Analysis>(analysisCacheKey(g.pgn));
    games.push({
      date: formatDate(g.end_time),
      opponent: opp.username,
      opponentRating: opp.rating,
      playerRating: me.rating,
      color,
      outcome: outcome(me.result),
      result: me.result,
      plies: totalPlies(g.pgn),
      analysis: analysis ?? null,
    });
  }

  const withAnalysis = games.filter((g) => g.analysis);

  // --- Aggregate helpers ---
  const cm = (g: typeof games[number], type: string) =>
    (g.analysis?.criticalMoments.filter((m) => m.type === type).length ?? 0);
  const blunders = (g: typeof games[number]) => cm(g, "blunder");
  const mistakes = (g: typeof games[number]) => cm(g, "mistake");
  const excellent = (g: typeof games[number]) => cm(g, "excellent");

  const wins = games.filter((g) => g.outcome === "win");
  const losses = games.filter((g) => g.outcome === "loss");
  const draws = games.filter((g) => g.outcome === "draw");

  const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
  const avg = (arr: number[]) => (arr.length ? sum(arr) / arr.length : 0);

  // Opening frequency + per-opening record
  const openingStats: Record<string, { games: number; wins: number; losses: number; draws: number; assessments: Record<string, number> }> = {};
  for (const g of withAnalysis) {
    const name = g.analysis!.opening.name || "Unknown";
    const o = (openingStats[name] ??= { games: 0, wins: 0, losses: 0, draws: 0, assessments: {} });
    o.games++;
    o[g.outcome === "win" ? "wins" : g.outcome === "loss" ? "losses" : "draws"]++;
    const a = g.analysis!.opening.assessment;
    o.assessments[a] = (o.assessments[a] || 0) + 1;
  }

  // Opening assessment distribution overall
  const openingAssessment: Record<string, number> = {};
  for (const g of withAnalysis) {
    const a = g.analysis!.opening.assessment;
    openingAssessment[a] = (openingAssessment[a] || 0) + 1;
  }

  // Result reason distribution
  const resultReasons: Record<string, number> = {};
  for (const g of games) resultReasons[g.result] = (resultReasons[g.result] || 0) + 1;

  // Loss result reasons
  const lossReasons: Record<string, number> = {};
  for (const g of losses) lossReasons[g.result] = (lossReasons[g.result] || 0) + 1;

  // Blunder phase distribution (when do critical errors happen)
  // bucket by move number: opening <=10, middlegame 11-25, late mg 26-40, endgame >40
  const phase = (mv: number) => mv <= 10 ? "opening" : mv <= 25 ? "middlegame" : mv <= 40 ? "late_middlegame" : "endgame";
  const blunderPhase: Record<string, number> = { opening: 0, middlegame: 0, late_middlegame: 0, endgame: 0 };
  const blunderPhaseLosses: Record<string, number> = { opening: 0, middlegame: 0, late_middlegame: 0, endgame: 0 };
  for (const g of withAnalysis) {
    for (const m of g.analysis!.criticalMoments) {
      if (m.type === "blunder" || m.type === "mistake") {
        blunderPhase[phase(m.moveNumber)]++;
        if (g.outcome === "loss") blunderPhaseLosses[phase(m.moveNumber)]++;
      }
    }
  }

  // Focus area frequency
  const focusAreas: Record<string, number> = {};
  for (const g of withAnalysis) {
    const f = g.analysis!.summary.focusArea || "";
    const key = f.split(":")[0].trim();
    if (key) focusAreas[key] = (focusAreas[key] || 0) + 1;
  }

  // Battle allusion distribution
  const battles: Record<string, number> = {};
  for (const g of withAnalysis) {
    const t = g.analysis!.summary.battleAllusion?.title;
    if (t) battles[t] = (battles[t] || 0) + 1;
  }

  // Color splits
  const colorRecord = (c: "white" | "black") => {
    const gs = games.filter((g) => g.color === c);
    return {
      games: gs.length,
      wins: gs.filter((g) => g.outcome === "win").length,
      losses: gs.filter((g) => g.outcome === "loss").length,
      draws: gs.filter((g) => g.outcome === "draw").length,
    };
  };

  // Missed mates
  const missedMates = withAnalysis.filter((g) => (g.analysis!.missedMatesInOne?.length ?? 0) > 0).length;
  const missedMateTotal = sum(withAnalysis.map((g) => g.analysis!.missedMatesInOne?.length ?? 0));

  // Rating range over the window (chronological)
  const chrono = [...games].reverse();
  const ratings = chrono.map((g) => g.playerRating);

  // Notable games for narrative: biggest blunder counts in losses, cleanest wins
  const worstLosses = [...losses].sort((a, b) => blunders(b) - blunders(a)).slice(0, 5)
    .map((g) => ({ date: g.date, opponent: g.opponent, opponentRating: g.opponentRating, blunders: blunders(g), mistakes: mistakes(g), result: g.result, opening: g.analysis?.opening.name ?? "?", color: g.color }));
  const cleanestWins = [...wins].sort((a, b) => (blunders(a) + mistakes(a)) - (blunders(b) + mistakes(b))).slice(0, 5)
    .map((g) => ({ date: g.date, opponent: g.opponent, opponentRating: g.opponentRating, blunders: blunders(g), excellent: excellent(g), opening: g.analysis?.opening.name ?? "?", color: g.color }));

  const report = {
    user: USER,
    generatedFor: "Rapid",
    gamesInWindow: games.length,
    gamesWithAnalysis: withAnalysis.length,
    dateRange: { from: games[games.length - 1]?.date, to: games[0]?.date },
    ratingWindow: { start: ratings[0], end: ratings[ratings.length - 1], min: Math.min(...ratings), max: Math.max(...ratings) },
    record: {
      wins: wins.length, losses: losses.length, draws: draws.length,
      winRate: games.length ? wins.length / games.length : 0,
    },
    colorSplit: { white: colorRecord("white"), black: colorRecord("black") },
    errorStats: {
      avgBlundersPerGame: avg(withAnalysis.map(blunders)),
      avgMistakesPerGame: avg(withAnalysis.map(mistakes)),
      avgExcellentPerGame: avg(withAnalysis.map(excellent)),
      avgBlundersInWins: avg(wins.filter((g) => g.analysis).map(blunders)),
      avgBlundersInLosses: avg(losses.filter((g) => g.analysis).map(blunders)),
      avgMistakesInWins: avg(wins.filter((g) => g.analysis).map(mistakes)),
      avgMistakesInLosses: avg(losses.filter((g) => g.analysis).map(mistakes)),
      totalBlunders: sum(withAnalysis.map(blunders)),
      totalMistakes: sum(withAnalysis.map(mistakes)),
      totalExcellent: sum(withAnalysis.map(excellent)),
    },
    openingAssessment,
    openingStats: Object.entries(openingStats)
      .sort((a, b) => b[1].games - a[1].games)
      .map(([name, s]) => ({ name, ...s, winRate: s.games ? s.wins / s.games : 0 })),
    resultReasons,
    lossReasons,
    blunderPhase,
    blunderPhaseLosses,
    focusAreas: Object.entries(focusAreas).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ area: k, count: v })),
    battles: Object.entries(battles).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ title: k, count: v })),
    missedMates: { gamesWith: missedMates, total: missedMateTotal },
    worstLosses,
    cleanestWins,
    endgameReachedRate: withAnalysis.length ? withAnalysis.filter((g) => g.analysis!.endgame.reached).length / withAnalysis.length : 0,
    games: games.map((g) => ({
      date: g.date, opponent: g.opponent, opponentRating: g.opponentRating,
      playerRating: g.playerRating, color: g.color, outcome: g.outcome, result: g.result,
      plies: g.plies, opening: g.analysis?.opening.name ?? null,
      openingAssessment: g.analysis?.opening.assessment ?? null,
      blunders: blunders(g), mistakes: mistakes(g), excellent: excellent(g),
      battle: g.analysis?.summary.battleAllusion?.title ?? null,
    })),
  };

  const outPath = path.join(dataDir, `${USER}-rapid-report.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`Wrote ${outPath}`);
  console.log(`Games: ${report.gamesInWindow} (${report.gamesWithAnalysis} with analysis)`);
  console.log(`Record: ${report.record.wins}W-${report.record.losses}L-${report.record.draws}D (${(report.record.winRate * 100).toFixed(0)}% win)`);
  console.log(`Date range: ${report.dateRange.from} → ${report.dateRange.to}`);
  console.log(`Avg blunders: wins ${report.errorStats.avgBlundersInWins.toFixed(1)} vs losses ${report.errorStats.avgBlundersInLosses.toFixed(1)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
