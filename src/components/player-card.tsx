import { PlayerProfile, RatingRecord } from "@/lib/types";

const TIME_CLASS_LABELS: Record<string, string> = {
  chess_rapid: "Rapid",
  chess_blitz: "Blitz",
  chess_bullet: "Bullet",
  chess_daily: "Daily",
};

function RatingStat({ label, record }: { label: string; record: RatingRecord }) {
  return (
    <div className="rounded-lg bg-surface-elevated px-3 py-2">
      <div className="text-xs text-gray-400">{label}</div>
      <div className="text-lg font-bold">{record.last?.rating ?? "—"}</div>
      <div className="text-xs text-gray-500">
        <span className="text-accent-green">{record.wins}W</span>{" "}
        <span className="text-accent-red">{record.losses}L</span>{" "}
        <span className="text-gray-400">{record.draws}D</span>
      </div>
    </div>
  );
}

export function PlayerCard({ data }: { data: PlayerProfile }) {
  const { profile, stats } = data;

  const ratingEntries = Object.entries(TIME_CLASS_LABELS)
    .filter(([key]) => stats[key as keyof typeof stats])
    .map(([key, label]) => ({
      label,
      record: stats[key as keyof typeof stats] as RatingRecord,
    }));

  return (
    <div className="rounded-xl bg-surface-card p-4">
      <div className="flex items-center gap-4">
        {profile.avatar ? (
          <img
            src={profile.avatar}
            alt={profile.username}
            className="h-16 w-16 rounded-full"
          />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-elevated text-2xl">
            ♟
          </div>
        )}
        <div>
          <div className="flex items-center gap-2">
            {profile.title && (
              <span className="rounded bg-accent-yellow px-1.5 py-0.5 text-xs font-bold text-black">
                {profile.title}
              </span>
            )}
            <span className="text-lg font-bold">{profile.username}</span>
          </div>
          <div className="text-sm text-gray-400">
            {profile.league && `${profile.league} League \u2022 `}
            {profile.status}
          </div>
        </div>
      </div>

      {ratingEntries.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          {ratingEntries.map(({ label, record }) => (
            <RatingStat key={label} label={label} record={record} />
          ))}
        </div>
      )}
    </div>
  );
}
