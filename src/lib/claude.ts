import Anthropic from "@anthropic-ai/sdk";
import { AnalysisResult } from "./types";

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

Identify 3-5 critical moments. Calibrate your advice to the player's rating level — don't suggest grandmaster-level ideas to a beginner.`;

function buildUserPrompt(
  pgn: string,
  username: string,
  color: "white" | "black",
  rating: number
): string {
  return `Analyze this game for ${username} (playing ${color}, rated ${rating}).

PGN:
${pgn}`;
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
  return JSON.parse(jsonStr) as AnalysisResult;
}
