import { AnalysisResult, CriticalMoment } from "@/lib/types";
import { getFenAtMove } from "@/lib/chess-utils";
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

export function AnalysisView({
  analysis,
  pgn,
}: {
  analysis: AnalysisResult;
  pgn?: string;
}) {
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

      {/* Critical Moments */}
      <div className="rounded-xl bg-surface-card p-4">
        <h3 className="mb-3 text-sm font-semibold text-gray-400">
          CRITICAL MOMENTS
        </h3>
        <div className="space-y-4">
          {analysis.criticalMoments.map((moment, i) => {
            const fen = pgn
              ? getFenAtMove(pgn, moment.moveNumber, moment.move)
              : null;

            return (
              <div key={i} className="space-y-2">
                {fen && <ChessBoard fen={fen} />}
                <div className="rounded-lg bg-surface-elevated px-3 py-3">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="font-mono text-sm font-bold">
                      Move {moment.moveNumber}: {moment.move}
                    </span>
                    <MomentTypeBadge type={moment.type} />
                  </div>
                  <p className="text-sm text-gray-300">{moment.comment}</p>
                  {moment.suggestion && (
                    <p className="mt-1 text-sm text-accent-green">
                      Better: {moment.suggestion}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
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
