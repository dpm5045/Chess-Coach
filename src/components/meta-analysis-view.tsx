import { MetaAnalysisResult, MetaTheme } from "@/lib/types";

const FREQUENCY_STYLES: Record<string, string> = {
  consistent: "bg-accent-blue/20 text-accent-blue",
  occasional: "bg-accent-yellow/20 text-accent-yellow",
  rare: "bg-gray-700 text-gray-400",
};

function FrequencyBadge({ frequency }: { frequency: string }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${FREQUENCY_STYLES[frequency] ?? FREQUENCY_STYLES.rare}`}
    >
      {frequency}
    </span>
  );
}

function ThemeCard({
  theme,
  accentBorder,
}: {
  theme: MetaTheme;
  accentBorder: string;
}) {
  return (
    <div className={`rounded-xl bg-surface-card p-4 border-l-4 ${accentBorder}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="font-semibold">{theme.title}</span>
        <FrequencyBadge frequency={theme.frequency} />
      </div>
      <p className="text-sm text-gray-300 mb-3">{theme.description}</p>
      {theme.examples.length > 0 && (
        <div className="mb-3 space-y-1">
          {theme.examples.map((ex, i) => (
            <p key={i} className="text-xs text-gray-500 italic">
              {ex}
            </p>
          ))}
        </div>
      )}
      <div className="rounded-lg bg-accent-blue/10 px-3 py-2">
        <p className="text-sm text-accent-blue">{theme.actionItem}</p>
      </div>
    </div>
  );
}

export function MetaAnalysisView({ data }: { data: MetaAnalysisResult }) {
  return (
    <div className="space-y-6">
      {/* Profile Summary */}
      <div className="rounded-xl bg-surface-card p-4">
        <h2 className="text-sm font-semibold uppercase text-gray-400 mb-2">
          Player Profile
        </h2>
        <p className="text-gray-200 mb-3">{data.overallProfile}</p>
        <p className="text-sm text-gray-400">{data.ratingTrend}</p>
      </div>

      {/* Strengths */}
      {data.strengths.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold uppercase text-gray-400 mb-3">
            Strengths
          </h2>
          <div className="space-y-3">
            {data.strengths.map((theme, i) => (
              <ThemeCard
                key={i}
                theme={theme}
                accentBorder="border-accent-green"
              />
            ))}
          </div>
        </div>
      )}

      {/* Weaknesses */}
      {data.weaknesses.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold uppercase text-gray-400 mb-3">
            Areas for Improvement
          </h2>
          <div className="space-y-3">
            {data.weaknesses.map((theme, i) => (
              <ThemeCard
                key={i}
                theme={theme}
                accentBorder="border-accent-orange"
              />
            ))}
          </div>
        </div>
      )}

      {/* Opening Repertoire */}
      <div className="rounded-xl bg-surface-card p-4">
        <h2 className="text-sm font-semibold uppercase text-gray-400 mb-3">
          Opening Repertoire
        </h2>
        <div className="space-y-2 mb-3">
          <div>
            <span className="text-xs font-medium text-gray-400">As White:</span>
            <p className="text-sm text-gray-200">{data.openingRepertoire.asWhite}</p>
          </div>
          <div>
            <span className="text-xs font-medium text-gray-400">As Black:</span>
            <p className="text-sm text-gray-200">{data.openingRepertoire.asBlack}</p>
          </div>
        </div>
        <div className="rounded-lg bg-accent-blue/10 px-3 py-2">
          <p className="text-sm text-accent-blue">
            {data.openingRepertoire.recommendation}
          </p>
        </div>
      </div>

      {/* Time Control Insights */}
      {data.timeControlInsights && (
        <div className="rounded-xl bg-surface-card p-4">
          <h2 className="text-sm font-semibold uppercase text-gray-400 mb-3">
            Performance by Time Control
          </h2>
          <p className="text-xs text-gray-500 mb-2">{data.timeControlInsights.breakdown}</p>
          <p className="text-sm text-gray-200 mb-3">{data.timeControlInsights.comparison}</p>
          <div className="rounded-lg bg-accent-blue/10 px-3 py-2">
            <p className="text-sm text-accent-blue">
              {data.timeControlInsights.recommendation}
            </p>
          </div>
        </div>
      )}

      {/* Endgame */}
      <div className="rounded-xl bg-surface-card p-4">
        <h2 className="text-sm font-semibold uppercase text-gray-400 mb-2">
          Endgame Tendency
        </h2>
        <p className="text-sm text-gray-200">{data.endgameTendency}</p>
      </div>

      {/* Coaching Plan */}
      {data.coachingPlan.length > 0 && (
        <div className="rounded-xl bg-surface-card p-4">
          <h2 className="text-sm font-semibold uppercase text-gray-400 mb-3">
            Coaching Plan
          </h2>
          <ol className="space-y-2">
            {data.coachingPlan.map((item, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-blue text-xs font-bold text-white">
                  {i + 1}
                </span>
                <span className="text-gray-200">{item}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
