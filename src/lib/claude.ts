import Anthropic from "@anthropic-ai/sdk";
import { AnalysisResult, CriticalMoment, MetaAnalysisResult } from "./types";
import {
  isLegalMoveAt,
  moveExistsInGame,
  getAllMoves,
  getLegalMovesAt,
} from "./chess-utils";

const client = new Anthropic();

const SYSTEM_PROMPT = `You are an encouraging chess coach analyzing a student's game. Your tone is warm and supportive — always lead with what the player did well before discussing mistakes. Frame improvements as opportunities, not failures. Be specific: reference exact move numbers and positions.

You will receive a PGN of a chess game and information about which player you are coaching. Analyze the game and respond with ONLY valid JSON (no markdown, no code fences, no text outside the JSON) matching this exact schema:

{
  "opening": {
    "name": "string - name of the opening played",
    "assessment": "good" | "inaccurate" | "dubious",
    "comment": "string - 1-2 sentences about the opening"
  },
  "criticalMoments": [
    {
      "moveNumber": number,
      "move": "string - the move in algebraic notation",
      "type": "blunder" | "mistake" | "excellent" | "missed_tactic",
      "comment": "string - explain why this move matters",
      "suggestion": "string - better move if applicable, or empty string"
    }
  ],
  "positionalThemes": "string - 2-3 sentences about pawn structure, piece activity, king safety",
  "endgame": {
    "reached": boolean,
    "comment": "string - endgame assessment if reached, or empty string"
  },
  "summary": {
    "overallAssessment": "string - 2-3 sentence overall coaching summary",
    "focusArea": "string - one specific thing to work on"
  }
}

Identify 3-5 critical moments. Calibrate your advice to the player's rating level — don't suggest grandmaster-level ideas to a beginner.

IMPORTANT: You will also receive FEN positions at key points in the game. Use them to verify your analysis — only suggest moves that are legal in the given position. The "move" field MUST exactly match the SAN notation from the PGN. The "suggestion" field MUST be a legal move in standard algebraic notation for that position.`;

function buildUserPrompt(
  pgn: string,
  username: string,
  color: "white" | "black",
  rating: number
): string {
  // Include FEN positions at every move so Claude can ground its analysis
  // in the actual board state rather than hallucinating positions.
  const moves = getAllMoves(pgn);
  const fenList = moves
    .map(
      (m) =>
        `${m.moveNumber}${m.color === "w" ? "." : "..."} ${m.san} → FEN: ${m.fen}`
    )
    .join("\n");

  return `Analyze this game for ${username} (playing ${color}, rated ${rating}).

PGN:
${pgn}

Position after each move:
${fenList}`;
}

function extractJson(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) return fenceMatch[1];
  return text.trim();
}

export async function analyzeGame(
  pgn: string,
  username: string,
  color: "white" | "black",
  rating: number
): Promise<AnalysisResult> {
  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: buildUserPrompt(pgn, username, color, rating),
      },
    ],
  });

  const responseText =
    message.content[0].type === "text" ? message.content[0].text : "";
  const jsonStr = extractJson(responseText);

  let result: AnalysisResult;
  try {
    result = JSON.parse(jsonStr) as AnalysisResult;
  } catch {
    throw new Error("Failed to parse analysis response from Claude");
  }

  // Post-process: validate that moves and suggestions are legal.
  // This catches hallucinated moves that don't exist on the board.
  result.criticalMoments = result.criticalMoments
    .filter((cm: CriticalMoment) => {
      // Drop moments where the referenced move doesn't exist in the game
      return moveExistsInGame(pgn, cm.moveNumber, cm.move);
    })
    .map((cm: CriticalMoment) => {
      const needsSuggestion =
        cm.type === "blunder" || cm.type === "mistake" || cm.type === "missed_tactic";
      const hasValidSuggestion =
        cm.suggestion &&
        cm.suggestion.length > 0 &&
        isLegalMoveAt(pgn, cm.moveNumber, cm.move, cm.suggestion);

      if (hasValidSuggestion) {
        return cm;
      }

      if (!needsSuggestion) {
        // For "excellent" moments, just clear any invalid suggestion
        return { ...cm, suggestion: "" };
      }

      // For blunders/mistakes/missed tactics: pick a fallback from legal moves.
      // Prefer captures (contain "x") as they're typically tactical and relevant.
      const legalMoves = getLegalMovesAt(pgn, cm.moveNumber, cm.move);
      const captures = legalMoves.filter((m) => m.includes("x"));
      const checks = legalMoves.filter((m) => m.includes("+"));
      const fallback = captures[0] || checks[0] || legalMoves[0] || "";

      return { ...cm, suggestion: fallback };
    });

  return result;
}

// --- Meta Analysis ---

const META_SYSTEM_PROMPT = `You are a long-term chess coach reviewing a student's body of work across many games. Your tone is warm and supportive — celebrate their strengths before addressing weaknesses. Frame improvements as the next step in their journey, not as failures.

You will receive summaries or move lists from multiple games for one player. Identify recurring patterns across games — not one-off events. Look for consistent themes in openings, tactics, positional play, time management, and endgames.

Respond with ONLY valid JSON (no markdown, no code fences, no text outside the JSON) matching this exact schema:

{
  "playerUsername": "string",
  "gamesAnalyzed": number,
  "timeRange": "string - e.g. Jan 2026 – Mar 2026",
  "overallProfile": "string - 3-4 sentence player profile summarizing their style and level",
  "ratingTrend": "string - observation about their rating trajectory and what it suggests",
  "strengths": [
    {
      "title": "string - short name for this strength",
      "sentiment": "strength",
      "frequency": "consistent" | "occasional" | "rare",
      "description": "string - 2-3 sentences explaining this pattern",
      "examples": ["string - specific game reference, e.g. 'Game vs opponent (date): description'"],
      "actionItem": "string - how to build on this strength"
    }
  ],
  "weaknesses": [
    {
      "title": "string - short name for this weakness",
      "sentiment": "weakness",
      "frequency": "consistent" | "occasional" | "rare",
      "description": "string - 2-3 sentences explaining this pattern",
      "examples": ["string - specific game reference"],
      "actionItem": "string - specific drill or focus to improve"
    }
  ],
  "openingRepertoire": {
    "asWhite": "string - summary of their white opening tendencies",
    "asBlack": "string - summary of their black opening tendencies",
    "recommendation": "string - coaching advice on their opening choices"
  },
  "endgameTendency": "string - overall endgame pattern observation",
  "coachingPlan": ["string - ordered improvement priorities, 3-5 items"]
}

Include 2-4 strengths and 2-4 weaknesses. Each must reference specific games as examples. Calibrate advice to the player's rating level.`;

export async function analyzePlayerMeta(
  username: string,
  gamesSummary: string,
  rating: number,
  gamesCount: number
): Promise<MetaAnalysisResult> {
  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: META_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Analyze the game history for ${username} (current rating ~${rating}, ${gamesCount} games below). Identify recurring patterns and provide a coaching plan.\n\n${gamesSummary}`,
      },
    ],
  });

  const responseText =
    message.content[0].type === "text" ? message.content[0].text : "";
  const jsonStr = extractJson(responseText);

  try {
    return JSON.parse(jsonStr) as MetaAnalysisResult;
  } catch {
    throw new Error("Failed to parse meta analysis response from Claude");
  }
}
