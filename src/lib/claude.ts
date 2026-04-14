import Anthropic from "@anthropic-ai/sdk";
import { AnalysisResult, CriticalMoment, MetaAnalysisResult } from "./types";
import {
  isLegalMoveAt,
  moveExistsInGame,
  getAllMoves,
  getLegalMovesAt,
} from "./chess-utils";
import {
  classifyBattle,
  buildFeaturesFromEngineEvals,
} from "./battle-allusion";

const client = new Anthropic();

const SYSTEM_PROMPT = `You are an encouraging chess coach analyzing a student's game. Your tone is warm and supportive — lead with what the player did well before discussing mistakes. Frame improvements as opportunities, not failures. Be specific: reference exact move numbers and positions.

However, encouragement must never replace honesty. If the player won but missed faster or cleaner wins, say so clearly. A win with sloppy technique is still a coaching opportunity. Your job is to help the player improve, not just feel good.

ENDGAME ANALYSIS: Pay special attention to endgame efficiency when the player has a winning advantage. Specifically look for:
- Missed checkmate sequences or faster paths to checkmate
- Inactive rooks that could have been brought forward to cut off the king or deliver check
- Unnecessary "safe" moves when forcing moves (checks, rook lifts, passed pawn pushes) would win faster
- King and pawn endgames where centralization or opposition was missed
Even if the player won, flag these as "missed_tactic" critical moments. Converting a won position efficiently is a key skill at every level.

ENGINE EVALUATIONS: You may receive Stockfish engine evaluations for each position. When provided, USE THEM as your primary source of truth for identifying mistakes and missed opportunities. The engine eval (in centipawns) tells you objectively how good each move was. A drop of 50+ centipawns is an inaccuracy, 100+ is a mistake, 200+ is a blunder. Reference the engine's preferred move when suggesting alternatives. Do NOT contradict the engine evaluation — if the engine says a move lost 150cp, do not call it "solid" or "fine".

MATE SCORES — STRICT ACCURACY REQUIRED: When the engine shows "mate in N", this is a precise calculation — forced checkmate in exactly N moves with best play. You MUST report this accurately:
- Only say "mate in 1" if the engine literally shows "mate in 1" for that position. Do NOT infer or guess that a position is "mate in 1" from the board — trust the engine number.
- If the engine shows "mate in 5", say the player missed a forced checkmate in 5 moves, not "missed mate in 1".
- When describing a missed mate sequence, include the engine's recommended line of play (the continuation moves provided) so the player can study the full mating idea. Walk through the key moves briefly — e.g. "After Rxh8+ Kd7, the engine continues with Qd3+ Ke6 Qd5# — a forced mate in 3."
- If no mate score is shown by the engine, do NOT claim a checkmate existed. You may say the position was "winning" or give the centipawn advantage instead.
- NEVER calculate checkmate sequences yourself. Only reference mate-in-N when the engine data explicitly provides it.

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
    "comment": "string - endgame assessment if reached, or empty string. If reached, be specific about conversion efficiency — did the player find the fastest path to victory or miss shorter wins?"
  },
  "summary": {
    "overallAssessment": "string - 2-3 sentence overall coaching summary",
    "focusArea": "string - one specific thing to work on"
  }
}

Identify 3-6 critical moments. Include at least 1-2 from the endgame if one was reached and the player had a winning advantage. Calibrate your advice to the player's rating level — don't suggest grandmaster-level ideas to a beginner.

IMPORTANT: You will also receive FEN positions at key points in the game. Use them to verify your analysis — only suggest moves that are legal in the given position. The "move" field MUST exactly match the SAN notation from the PGN. The "suggestion" field MUST be a legal move in standard algebraic notation for that position.`;

function buildUserPrompt(
  pgn: string,
  username: string,
  color: "white" | "black",
  rating: number,
  engineEvals?: { positions: Array<{ moveNumber: number; color: "w" | "b"; san: string; scoreCp: number; mate: number | null; bestLine: string[]; depth: number }>; drops: Array<{ moveNumber: number; color: "w" | "b"; san: string; evalBefore: number; evalAfter: number; cpLoss: number; engineBest: string; engineLine: string[] }> }
): string {
  const moves = getAllMoves(pgn);
  const fenList = moves
    .map(
      (m) =>
        `${m.moveNumber}${m.color === "w" ? "." : "..."} ${m.san} → FEN: ${m.fen}`
    )
    .join("\n");

  let prompt = `Analyze this game for ${username} (playing ${color}, rated ${rating}).

PGN:
${pgn}

Position after each move:
${fenList}`;

  if (engineEvals && engineEvals.positions.length > 0) {
    const evalList = engineEvals.positions
      .map((p) => {
        const score = p.mate !== null ? `mate in ${p.mate}` : `${p.scoreCp}cp`;
        const moveLabel = `${p.moveNumber}${p.color === "w" ? "." : "..."} ${p.san}`;
        const line = p.bestLine.length > 0 ? ` [engine line: ${p.bestLine.join(" ")}]` : "";
        return `${moveLabel} → eval: ${score} (depth ${p.depth})${line}`;
      })
      .join("\n");

    prompt += `\n\nStockfish evaluation after each move (from White's perspective, positive = White advantage):\n${evalList}`;

    if (engineEvals.drops.length > 0) {
      const dropList = engineEvals.drops
        .map((d) => {
          const moveLabel = `${d.moveNumber}${d.color === "w" ? "." : "..."} ${d.san}`;
          const line = d.engineLine.length > 1 ? ` (continuation: ${d.engineLine.join(" ")})` : "";
          return `${moveLabel}: lost ${d.cpLoss}cp (was ${d.evalBefore}cp, now ${d.evalAfter}cp). Engine preferred: ${d.engineBest}${line}`;
        })
        .join("\n");

      prompt += `\n\nSignificant eval drops (mistakes/inaccuracies detected by engine):\n${dropList}`;
    }
  }

  return prompt;
}

function extractJson(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) return fenceMatch[1];
  return text.trim();
}

/** Derive win/loss/draw from the PGN [Result] tag relative to the player's color. */
function deriveResultFromPgn(
  pgn: string,
  playerColor: "w" | "b"
): "win" | "loss" | "draw" | null {
  const match = pgn.match(/\[Result\s+"([^"]+)"\]/);
  if (!match) return null;
  const tag = match[1];
  if (tag === "1/2-1/2") return "draw";
  if (tag === "1-0") return playerColor === "w" ? "win" : "loss";
  if (tag === "0-1") return playerColor === "b" ? "win" : "loss";
  return null;
}

export async function analyzeGame(
  pgn: string,
  username: string,
  color: "white" | "black",
  rating: number,
  engineEvals?: { positions: Array<{ moveNumber: number; color: "w" | "b"; san: string; scoreCp: number; mate: number | null; bestLine: string[]; depth: number }>; drops: Array<{ moveNumber: number; color: "w" | "b"; san: string; evalBefore: number; evalAfter: number; cpLoss: number; engineBest: string; engineLine: string[] }> }
): Promise<AnalysisResult> {
  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: buildUserPrompt(pgn, username, color, rating, engineEvals),
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

  // Compute battle allusion deterministically (server-side, prompt untouched).
  if (engineEvals) {
    const playerColorChar: "w" | "b" = color === "white" ? "w" : "b";
    const gameResult = deriveResultFromPgn(pgn, playerColorChar);
    if (gameResult) {
      const missedMate = (result.missedMatesInOne?.length ?? 0) > 0;
      result.summary.battleAllusion = classifyBattle(
        buildFeaturesFromEngineEvals(
          engineEvals,
          playerColorChar,
          gameResult,
          result.opening.assessment,
          result.endgame.reached,
          { missedMate }
        )
      );
    }
  }

  return result;
}

// --- Meta Analysis ---

const META_SYSTEM_PROMPT = `You are a long-term chess coach reviewing a student's body of work across many games. Your tone is warm and supportive — celebrate their strengths before addressing weaknesses. Frame improvements as the next step in their journey, not as failures.

You will receive summaries or move lists from multiple games for one player across ALL time controls (rapid, blitz, bullet, daily). Identify recurring patterns across games — not one-off events. Look for consistent themes in openings, tactics, positional play, time management, and endgames.

TIME CONTROL ANALYSIS: The games span different time controls. Compare the player's performance across formats. Do they play better in rapid vs blitz? Do they blunder more under time pressure? Are their openings different by format? This cross-format comparison is a key part of your coaching.

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
  "timeControlInsights": {
    "breakdown": "string - how many games in each time control and win rates",
    "comparison": "string - 2-3 sentences comparing performance across time controls (e.g. more blunders in blitz, stronger openings in rapid, etc.)",
    "recommendation": "string - which time control to focus on for improvement and why"
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
    model: "claude-sonnet-4-6",
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
