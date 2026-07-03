import { describe, it, expect } from "vitest";
import {
  AnalysisResultSchema,
  MetaAnalysisResultSchema,
  AnalyzeRequestSchema,
} from "@/lib/schemas";

const validAnalysis = {
  opening: { name: "Italian Game", assessment: "good", comment: "Solid." },
  criticalMoments: [
    { moveNumber: 12, move: "Nxe5", type: "blunder", comment: "Drops a piece.", suggestion: "Nf3" },
  ],
  positionalThemes: "Open center.",
  endgame: { reached: false, comment: "" },
  summary: { overallAssessment: "Good game.", focusArea: "Tactics." },
};

describe("AnalysisResultSchema", () => {
  it("accepts a valid analysis", () => {
    expect(AnalysisResultSchema.safeParse(validAnalysis).success).toBe(true);
  });

  it("defaults a missing suggestion to empty string", () => {
    const noSuggestion = {
      ...validAnalysis,
      criticalMoments: [{ moveNumber: 3, move: "e4", type: "excellent", comment: "Nice." }],
    };
    const parsed = AnalysisResultSchema.parse(noSuggestion);
    expect(parsed.criticalMoments[0].suggestion).toBe("");
  });

  it("rejects an invalid moment type", () => {
    const bad = {
      ...validAnalysis,
      criticalMoments: [{ moveNumber: 1, move: "e4", type: "brilliant", comment: "x", suggestion: "" }],
    };
    expect(AnalysisResultSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a missing summary", () => {
    const { summary: _summary, ...bad } = validAnalysis;
    expect(AnalysisResultSchema.safeParse(bad).success).toBe(false);
  });
});

describe("AnalyzeRequestSchema", () => {
  const base = { pgn: "1. e4 e5", username: "castledoon", color: "white" };

  it("accepts a minimal valid request", () => {
    expect(AnalyzeRequestSchema.safeParse(base).success).toBe(true);
  });

  it("rejects an oversized PGN", () => {
    expect(
      AnalyzeRequestSchema.safeParse({ ...base, pgn: "x".repeat(20001) }).success
    ).toBe(false);
  });

  it("rejects malformed engineEvals positions", () => {
    const bad = {
      ...base,
      engineEvals: { positions: [{ moveNumber: "one" }], drops: [] },
    };
    expect(AnalyzeRequestSchema.safeParse(bad).success).toBe(false);
  });
});

describe("MetaAnalysisResultSchema", () => {
  it("rejects a response missing coachingPlan", () => {
    expect(MetaAnalysisResultSchema.safeParse({ playerUsername: "x" }).success).toBe(false);
  });
});
