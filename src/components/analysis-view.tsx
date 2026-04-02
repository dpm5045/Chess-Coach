"use client";

import { useState, useMemo } from "react";
import { AnalysisResult, CriticalMoment } from "@/lib/types";
import { getAllMoves, MoveDetail } from "@/lib/chess-utils";
import { ChessBoard } from "@/components/chess-board";

function AssessmentBadge({ assessment }: { assessment: string }) {
  const colors: Record<string, string> = {
    good: "bg-accent-green/20 text-accent-green",
    inaccurate: "bg-accent-orange/20 text-accent-orange",
    dubious: "bg-accent-red/20 text-accent-red",
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
        colors[assessment] || "bg-gray-700 text-gray-300"
      }`}
    >
      {assessment}
    </span>
  );
}

function MomentTypeBadge({ type }: { type: CriticalMoment["type"] }) {
  const config: Record<string, { bg: string; icon: string }> = {
    blunder: { bg: "bg-accent-red/20 text-accent-red", icon: "\u26A0" },
    mistake: { bg: "bg-accent-orange/20 text-accent-orange", icon: "?" },
    excellent: { bg: "bg-accent-green/20 text-accent-green", icon: "\u2713" },
    missed_tactic: { bg: "bg-accent-yellow/20 text-accent-yellow", icon: "\uD83D\uDCA1" },
  };
  const { bg, icon } = config[type] || config.mistake;
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${bg}`}>
      {icon} {type.replace("_", " ")}
    </span>
  );
}

function findCriticalMoment(
  moments: CriticalMoment[],
  moveNumber: number,
  san: string
): CriticalMoment | undefined {
  return moments.find(
    (m) => m.moveNumber === moveNumber && m.move === san
  );
}

export function AnalysisView({
  analysis,
  pgn,
  playerColor,
}: {
  analysis: AnalysisResult;
  pgn?: string;
  playerColor?: "white" | "black";
}) {
  const [showAllMoves, setShowAllMoves] = useState(false);
  const [expandedMove, setExpandedMove] = useState<number | null>(null);

  const allMoves = useMemo(() => (pgn ? getAllMoves(pgn) : []), [pgn]);

  const criticalMoveKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const m of analysis.criticalMoments) {
      keys.add(`${m.moveNumber}-${m.move}`);
    }
    return keys;
  }, [analysis.criticalMoments]);

  const displayMoves: MoveDetail[] = showAllMoves
    ? allMoves
    : allMoves.filter((m) => criticalMoveKeys.has(`${m.moveNumber}-${m.san}`));

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="rounded-xl bg-surface-card p-4">
        <h3 className="mb-2 text-sm font-semibold text-gray-400">SUMMARY</h3>
        <p className="text-gray-200">{analysis.summary.overallAssessment}</p>
        <div className="mt-3 rounded-lg bg-accent-blue/10 px-3 py-2">
          <span className="text-xs font-semibold text-accent-blue">
            FOCUS AREA
          </span>
          <p className="mt-1 text-sm text-gray-200">
            {analysis.summary.focusArea}
          </p>
        </div>
      </div>

      {/* Opening */}
      <div className="rounded-xl bg-surface-card p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-400">OPENING</h3>
          <AssessmentBadge assessment={analysis.opening.assessment} />
        </div>
        <p className="font-medium">{analysis.opening.name}</p>
        <p className="mt-1 text-sm text-gray-400">{analysis.opening.comment}</p>
      </div>

      {/* Moves */}
      <div className="rounded-xl bg-surface-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-400">
            {showAllMoves ? "ALL MOVES" : "CRITICAL MOMENTS"}
          </h3>
          <div className="flex gap-1">
            <button
              onClick={() => setShowAllMoves(false)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                !showAllMoves
                  ? "bg-accent-blue text-white"
                  : "bg-surface-elevated text-gray-400"
              }`}
            >
              Critical
            </button>
            <button
              onClick={() => setShowAllMoves(true)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                showAllMoves
                  ? "bg-accent-blue text-white"
                  : "bg-surface-elevated text-gray-400"
              }`}
            >
              All Moves
            </button>
          </div>
        </div>
        <div className="space-y-2">
          {displayMoves.map((move, i) => {
            const critical = findCriticalMoment(
              analysis.criticalMoments,
              move.moveNumber,
              move.san
            );
            const isExpanded = expandedMove === i;
            const colorLabel = move.color === "w" ? "White" : "Black";
            const moveLabel = `${move.moveNumber}${move.color === "b" ? "..." : "."} ${move.san}`;

            return (
              <div key={i} className="space-y-2">
                <button
                  onClick={() => setExpandedMove(isExpanded ? null : i)}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-3 text-left transition-colors ${
                    critical
                      ? "bg-surface-elevated ring-1 ring-accent-yellow/30"
                      : "bg-surface-elevated"
                  } active:brightness-110`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-block h-2.5 w-2.5 rounded-full ${
                        move.color === "w"
                          ? "border border-gray-400 bg-white"
                          : "border border-gray-600 bg-gray-800"
                      }`}
                    />
                    <span className="font-mono text-sm font-bold">
                      {moveLabel}
                    </span>
                    <span className="text-xs text-gray-500">
                      {move.from}→{move.to}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {critical && <MomentTypeBadge type={critical.type} />}
                    <span className="text-xs text-gray-500">
                      {isExpanded ? "▲" : "▼"}
                    </span>
                  </div>
                </button>

                {isExpanded && (
                  <div className="space-y-2 pb-2">
                    <ChessBoard fen={move.fen} orientation={playerColor} />
                    {critical && (
                      <div className="rounded-lg bg-surface px-3 py-2">
                        <p className="text-sm text-gray-300">
                          {critical.comment}
                        </p>
                        {critical.suggestion && (
                          <p className="mt-1 text-sm text-accent-green">
                            Better: {critical.suggestion}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {displayMoves.length === 0 && (
            <div className="py-4 text-center text-sm text-gray-500">
              No moves to display.
            </div>
          )}
        </div>
      </div>

      {/* Positional Themes */}
      <div className="rounded-xl bg-surface-card p-4">
        <h3 className="mb-2 text-sm font-semibold text-gray-400">
          POSITIONAL THEMES
        </h3>
        <p className="text-sm text-gray-300">{analysis.positionalThemes}</p>
      </div>

      {/* Endgame */}
      {analysis.endgame.reached && (
        <div className="rounded-xl bg-surface-card p-4">
          <h3 className="mb-2 text-sm font-semibold text-gray-400">ENDGAME</h3>
          <p className="text-sm text-gray-300">{analysis.endgame.comment}</p>
        </div>
      )}
    </div>
  );
}
