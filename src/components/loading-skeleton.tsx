export function PlayerCardSkeleton() {
  return (
    <div className="animate-pulse rounded-xl bg-surface-card p-4">
      <div className="flex items-center gap-4">
        <div className="h-16 w-16 rounded-full bg-surface-elevated" />
        <div className="flex-1 space-y-2">
          <div className="h-5 w-32 rounded bg-surface-elevated" />
          <div className="h-4 w-24 rounded bg-surface-elevated" />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-12 rounded bg-surface-elevated" />
        ))}
      </div>
    </div>
  );
}

export function GameListSkeleton() {
  return (
    <div className="animate-pulse space-y-2">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="h-16 rounded-lg bg-surface-card" />
      ))}
    </div>
  );
}

export function AnalysisSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-24 rounded-xl bg-surface-card" />
      <div className="h-32 rounded-xl bg-surface-card" />
      <div className="h-20 rounded-xl bg-surface-card" />
      <div className="h-28 rounded-xl bg-surface-card" />
    </div>
  );
}
