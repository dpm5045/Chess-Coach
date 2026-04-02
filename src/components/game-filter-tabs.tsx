import { TimeClass } from "@/lib/types";

type FilterOption = TimeClass | "all";

const FILTERS: { label: string; value: FilterOption }[] = [
  { label: "All", value: "all" },
  { label: "Rapid", value: "rapid" },
  { label: "Blitz", value: "blitz" },
  { label: "Bullet", value: "bullet" },
  { label: "Daily", value: "daily" },
];

export function GameFilterTabs({
  selected,
  onSelect,
}: {
  selected: FilterOption;
  onSelect: (filter: FilterOption) => void;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-2">
      {FILTERS.map(({ label, value }) => (
        <button
          key={value}
          onClick={() => onSelect(value)}
          className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors ${
            selected === value
              ? "bg-accent-blue text-white"
              : "bg-surface-card text-gray-400 hover:text-gray-200"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
