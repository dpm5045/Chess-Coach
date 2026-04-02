import { ChessComGame } from "@/lib/types";
import {
  getOpponent,
  getPlayerOutcome,
  getPlayerColor,
  formatDate,
  formatTimeControl,
  outcomeColor,
  outcomeLabel,
} from "@/lib/utils";

export function GameListItem({
  game,
  username,
  onClick,
}: {
  game: ChessComGame;
  username: string;
  onClick: () => void;
}) {
  const opponent = getOpponent(game, username);
  const outcome = getPlayerOutcome(game, username);
  const color = getPlayerColor(game, username);

  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-lg bg-surface-card px-4 py-3 text-left transition-colors active:bg-surface-elevated"
    >
      <div className="flex items-center gap-3">
        <div
          className={`h-3 w-3 rounded-full ${
            color === "white"
              ? "border border-gray-400 bg-white"
              : "bg-gray-800 border border-gray-600"
          }`}
        />
        <div>
          <div className="font-medium">
            vs {opponent.username}{" "}
            <span className="text-sm text-gray-500">({opponent.rating})</span>
          </div>
          <div className="text-xs text-gray-500">
            {formatDate(game.end_time)} · {formatTimeControl(game.time_control)}
          </div>
        </div>
      </div>
      <div className={`text-right font-bold ${outcomeColor(outcome)}`}>
        {outcomeLabel(outcome)}
      </div>
    </button>
  );
}
