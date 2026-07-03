import { z } from "zod";

// --- Request validation (POST /api/analyze) ---

export const PositionEvalSchema = z.object({
  moveNumber: z.number().int().min(1),
  color: z.enum(["w", "b"]),
  san: z.string().min(1).max(10),
  scoreCp: z.number().int().min(-30000).max(30000),
  mate: z.number().int().nullable(),
  bestLine: z.array(z.string().max(8)).max(64),
  depth: z.number().int().min(0).max(99),
});

export const AnalyzeRequestSchema = z.object({
  pgn: z.string().min(1).max(20000),
  username: z.string().min(1).max(50),
  color: z.enum(["white", "black"]),
  rating: z.number().int().min(0).max(4000).optional(),
  cacheOnly: z.boolean().optional(),
  engineEvals: z
    .object({
      // Client-computed drops are ignored; the server recomputes them.
      positions: z.array(PositionEvalSchema).max(600),
      drops: z.array(z.unknown()).optional(),
    })
    .optional(),
});

// --- Claude response validation ---

const CriticalMomentSchema = z.object({
  moveNumber: z.number().int().min(1),
  move: z.string().min(1),
  type: z.enum(["blunder", "mistake", "excellent", "missed_tactic"]),
  comment: z.string(),
  suggestion: z.string().optional().default(""),
});

export const AnalysisResultSchema = z.object({
  opening: z.object({
    name: z.string(),
    assessment: z.enum(["good", "inaccurate", "dubious"]),
    comment: z.string(),
  }),
  criticalMoments: z.array(CriticalMomentSchema),
  positionalThemes: z.string(),
  endgame: z.object({ reached: z.boolean(), comment: z.string() }),
  summary: z.object({ overallAssessment: z.string(), focusArea: z.string() }),
});

const MetaThemeSchema = z.object({
  title: z.string(),
  sentiment: z.enum(["strength", "weakness", "neutral"]),
  frequency: z.enum(["consistent", "occasional", "rare"]),
  description: z.string(),
  examples: z.array(z.string()),
  actionItem: z.string(),
});

export const MetaAnalysisResultSchema = z.object({
  playerUsername: z.string(),
  gamesAnalyzed: z.number(),
  timeRange: z.string(),
  overallProfile: z.string(),
  ratingTrend: z.string(),
  strengths: z.array(MetaThemeSchema),
  weaknesses: z.array(MetaThemeSchema),
  openingRepertoire: z.object({
    asWhite: z.string(),
    asBlack: z.string(),
    recommendation: z.string(),
  }),
  timeControlInsights: z.object({
    breakdown: z.string(),
    comparison: z.string(),
    recommendation: z.string(),
  }),
  endgameTendency: z.string(),
  coachingPlan: z.array(z.string()),
});
