import { describe, it, expect } from "vitest";
import {
  parseUciInfoLines,
  toWhitePov,
  getTerminalEval,
  findEvalDrops,
  detectMissedMatesInOne,
  MATE_SCORE_CP,
} from "@/lib/engine-core";
import { getAllMoves } from "@/lib/chess-utils";
import { PositionEval } from "@/lib/types";

function pos(over: Partial<PositionEval>): PositionEval {
  return {
    moveNumber: 1,
    color: "w",
    san: "e4",
    scoreCp: 0,
    mate: null,
    bestLine: [],
    depth: 12,
    ...over,
  };
}

describe("parseUciInfoLines", () => {
  it("takes the last scored info line", () => {
    const r = parseUciInfoLines([
      "info depth 10 seldepth 12 score cp 30 nodes 100 pv e2e4 e7e5",
      "info depth 12 seldepth 14 score cp -616 nodes 3767 pv b8c6 c2c3",
      "bestmove b8c6",
    ]);
    expect(r).toEqual({ scoreCp: -616, mate: null, bestLine: ["b8c6", "c2c3"], depth: 12 });
  });

  it("parses mate scores", () => {
    const r = parseUciInfoLines(["info depth 12 seldepth 2 score mate 1 nodes 361 pv d8h4"]);
    expect(r.mate).toBe(1);
    expect(r.bestLine).toEqual(["d8h4"]);
  });

  it("returns zeros when no info lines", () => {
    expect(parseUciInfoLines(["bestmove (none)"])).toEqual({
      scoreCp: 0,
      mate: null,
      bestLine: [],
      depth: 0,
    });
  });
});

describe("toWhitePov", () => {
  // Verified empirically 2026-07-03: stockfish npm pkg reports side-to-move POV.
  // Black to move, White up a queen => raw cp is NEGATIVE; white-POV is positive.
  it("negates cp and mate when black is to move", () => {
    const fen = "rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1";
    const r = toWhitePov({ scoreCp: -616, mate: null, bestLine: [], depth: 12 }, fen);
    expect(r.scoreCp).toBe(616);
    const m = toWhitePov({ scoreCp: 0, mate: 1, bestLine: ["d8h4"], depth: 12 }, fen);
    expect(m.mate).toBe(-1); // black mates in 1 => negative in white-POV
  });

  it("leaves scores unchanged when white is to move", () => {
    const fen = "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4";
    const r = toWhitePov({ scoreCp: 0, mate: 1, bestLine: ["h5f7"], depth: 12 }, fen);
    expect(r.mate).toBe(1);
  });
});

describe("getTerminalEval", () => {
  it("scores checkmate for the winner in white-POV", () => {
    // Fool's mate final position: white is checkmated, black won.
    const fen = "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3";
    const r = getTerminalEval(fen, 16);
    expect(r).toEqual({ scoreCp: -MATE_SCORE_CP, mate: null, bestLine: [], depth: 16 });
  });

  it("scores stalemate as 0", () => {
    const fen = "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1"; // black stalemated
    const r = getTerminalEval(fen, 16);
    expect(r).toEqual({ scoreCp: 0, mate: null, bestLine: [], depth: 16 });
  });

  it("returns null for non-terminal positions", () => {
    expect(getTerminalEval("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1")).toBeNull();
  });
});

describe("findEvalDrops", () => {
  it("detects a black blunder and converts engine line to SAN", () => {
    // 1. e4 e5 2. Qh5 g6?? — craft evals so 2...g6 is a black blunder
    const moves = getAllMoves("1. e4 e5 2. Qh5 g6");
    const positions: PositionEval[] = [
      pos({ moveNumber: 1, color: "w", san: "e4", scoreCp: 30 }),
      pos({ moveNumber: 1, color: "b", san: "e5", scoreCp: 25 }),
      // after 2.Qh5, black to move; white-POV +30. Engine best for black: b8c6.
      pos({ moveNumber: 2, color: "w", san: "Qh5", scoreCp: 30, bestLine: ["b8c6", "f1c4"] }),
      // after 2...g6?? white-POV +250 => black lost 220cp
      pos({ moveNumber: 2, color: "b", san: "g6", scoreCp: 250 }),
    ];
    const drops = findEvalDrops(positions, moves, 50);
    expect(drops).toHaveLength(1);
    expect(drops[0]).toMatchObject({
      moveNumber: 2,
      color: "b",
      san: "g6",
      cpLoss: 220, // (30 * -1) - (250 * -1)
      engineBest: "Nc6", // b8c6 converted to SAN at the decision FEN
    });
    expect(drops[0].engineLine).toEqual(["Nc6", "Bc4"]);
  });

  it("maps mate scores to ±MATE_SCORE_CP", () => {
    const moves = getAllMoves("1. f3 e5 2. g4 d6");
    const positions: PositionEval[] = [
      pos({ moveNumber: 1, color: "w", san: "f3", scoreCp: -50 }),
      pos({ moveNumber: 1, color: "b", san: "e5", scoreCp: -100 }),
      pos({ moveNumber: 2, color: "w", san: "g4", scoreCp: 0, mate: -1, bestLine: ["d8h4"] }),
      pos({ moveNumber: 2, color: "b", san: "d6", scoreCp: -200 }),
    ];
    const drops = findEvalDrops(positions, moves, 50);
    // Black had mate (mover-POV +10000), played d6 (mover-POV +200): loss 9800
    const blackDrop = drops.find((d) => d.san === "d6");
    expect(blackDrop?.cpLoss).toBe(MATE_SCORE_CP - 200);
  });
});

describe("detectMissedMatesInOne", () => {
  it("flags a missed mate for the correct color", () => {
    // After 2.g4 black has Qh4#; black plays d6 instead.
    const moves = getAllMoves("1. f3 e5 2. g4 d6");
    const positions: PositionEval[] = [
      pos({ moveNumber: 1, color: "w", san: "f3" }),
      pos({ moveNumber: 1, color: "b", san: "e5" }),
      // white-POV: black mates in 1 => mate: -1
      pos({ moveNumber: 2, color: "w", san: "g4", mate: -1, bestLine: ["d8h4"] }),
      pos({ moveNumber: 2, color: "b", san: "d6", scoreCp: -300 }),
    ];
    const missed = detectMissedMatesInOne(moves, positions);
    expect(missed).toEqual([
      { moveNumber: 2, color: "b", playedSan: "d6", mateSan: "Qh4#" },
    ]);
  });

  it("does not flag a delivered mate", () => {
    const moves = getAllMoves("1. f3 e5 2. g4 Qh4#");
    const positions: PositionEval[] = [
      pos({ moveNumber: 1, color: "w", san: "f3" }),
      pos({ moveNumber: 1, color: "b", san: "e5" }),
      pos({ moveNumber: 2, color: "w", san: "g4", mate: -1, bestLine: ["d8h4"] }),
      pos({ moveNumber: 2, color: "b", san: "Qh4#", scoreCp: -MATE_SCORE_CP }),
    ];
    expect(detectMissedMatesInOne(moves, positions)).toEqual([]);
  });

  it("does not flag when mate belongs to the other side", () => {
    // white-POV mate +1 while BLACK is to move => white threatens mate, black has nothing
    const moves = getAllMoves("1. f3 e5 2. g4 d6");
    const positions: PositionEval[] = [
      pos({ moveNumber: 1, color: "w", san: "f3" }),
      pos({ moveNumber: 1, color: "b", san: "e5" }),
      pos({ moveNumber: 2, color: "w", san: "g4", mate: 1, bestLine: ["a2a3"] }),
      pos({ moveNumber: 2, color: "b", san: "d6" }),
    ];
    expect(detectMissedMatesInOne(moves, positions)).toEqual([]);
  });
});
