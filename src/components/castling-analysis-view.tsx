"use client";

import { CastlingAnalysisResult, CastlingStats, CastlingColorBreakdown } from "@/lib/types";

function WinRateBar({ stats, label }: { stats: CastlingStats; label: string }) {
  const winPct = stats.total > 0 ? Math.round((stats.wins / stats.total) * 100) : 0;
  const drawPct = stats.total > 0 ? Math.round((stats.draws / stats.total) * 100) : 0;
  const lossPct = Math.max(0, 100 - winPct - drawPct);

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-gray-300">{label}</span>
        <span className="text-sm font-semibold text-gray-200">
          {winPct}% wins
          <span className="text-xs text-gray-500 ml-1">({stats.total} games)</span>
        </span>
      </div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-elevated">
        <div
          className="bg-accent-green h-full transition-all"
          style={{ width: `${winPct}%` }}
        />
        <div
          className="bg-accent-yellow h-full transition-all"
          style={{ width: `${drawPct}%` }}
        />
        <div
          className="bg-accent-red h-full transition-all"
          style={{ width: `${lossPct}%` }}
        />
      </div>
      <div className="flex gap-3 mt-1 text-xs text-gray-500">
        <span className="text-accent-green">{stats.wins}W</span>
        <span className="text-accent-yellow">{stats.draws}D</span>
        <span className="text-accent-red">{stats.losses}L</span>
      </div>
    </div>
  );
}

function ComparisonCard({
  title,
  breakdown,
}: {
  title: string;
  breakdown: CastlingColorBreakdown;
}) {
  const castledRate = breakdown.castled.winRate;
  const noCastleRate = breakdown.didNotCastle.winRate;
  const diff = castledRate - noCastleRate;

  return (
    <div className="rounded-xl bg-surface-card p-4">
      <h2 className="text-sm font-semibold uppercase text-gray-400 mb-4">{title}</h2>
      <div className="space-y-4">
        <WinRateBar stats={breakdown.castled} label="Castled" />
        <WinRateBar stats={breakdown.didNotCastle} label="Did not castle" />
      </div>
      {breakdown.castled.total > 0 && breakdown.didNotCastle.total > 0 && (
        <div className={`mt-3 rounded-lg px-3 py-2 text-sm ${diff >= 0 ? "bg-accent-green/10 text-accent-green" : "bg-accent-red/10 text-accent-red"}`}>
          {diff >= 0
            ? `+${diff}% win rate when castling`
            : `${diff}% win rate when castling`}
        </div>
      )}
    </div>
  );
}

function SideComparisonCard({ data }: { data: CastlingAnalysisResult }) {
  const { kingside, queenside } = data.bySide;
  if (kingside.total === 0 && queenside.total === 0) return null;

  return (
    <div className="rounded-xl bg-surface-card p-4">
      <h2 className="text-sm font-semibold uppercase text-gray-400 mb-4">
        Castling Side
      </h2>
      <div className="space-y-4">
        {kingside.total > 0 && <WinRateBar stats={kingside} label="Kingside (O-O)" />}
        {queenside.total > 0 && <WinRateBar stats={queenside} label="Queenside (O-O-O)" />}
      </div>
      {data.averageCastlingMove !== null && (
        <p className="mt-3 text-xs text-gray-500">
          Average castling on move {data.averageCastlingMove}
        </p>
      )}
    </div>
  );
}

export function CastlingAnalysisView({ data }: { data: CastlingAnalysisResult }) {
  const castledPct =
    data.overall.castled.total + data.overall.didNotCastle.total > 0
      ? Math.round(
          (data.overall.castled.total /
            (data.overall.castled.total + data.overall.didNotCastle.total)) *
            100
        )
      : 0;

  return (
    <div className="space-y-6">
      <div className="rounded-xl bg-surface-card p-4">
        <h2 className="text-sm font-semibold uppercase text-gray-400 mb-1">Summary</h2>
        <p className="text-gray-300 text-sm">
          You castled in{" "}
          <span className="font-semibold text-white">{castledPct}%</span> of games (
          {data.overall.castled.total} of {data.gamesAnalyzed}).
        </p>
        {data.averageCastlingMove !== null && (
          <p className="text-xs text-gray-500 mt-1">
            When you castle, you do so on move {data.averageCastlingMove} on average.
          </p>
        )}
      </div>

      <ComparisonCard title="Overall" breakdown={data.overall} />

      <ComparisonCard title="As White" breakdown={data.byColor.asWhite} />

      <ComparisonCard title="As Black" breakdown={data.byColor.asBlack} />

      <SideComparisonCard data={data} />
    </div>
  );
}
