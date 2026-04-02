import { ChessComGame, GameResult } from "./types";

const WIN_RESULTS: GameResult[] = ["win"];
const DRAW_RESULTS: GameResult[] = [
  "stalemate",
  "insufficient",
  "repetition",
  "agreed",
  "50move",
  "timevsinsufficient",
];

export function getPlayerColor(
  game: ChessComGame,
  username: string
): "white" | "black" {
  return game.white.username.toLowerCase() === username.toLowerCase()
    ? "white"
    : "black";
}

export function getPlayerOutcome(
  game: ChessComGame,
  username: string
): "win" | "loss" | "draw" {
  const color = getPlayerColor(game, username);
  const result = game[color].result;
  if (WIN_RESULTS.includes(result)) return "win";
  if (DRAW_RESULTS.includes(result)) return "draw";
  return "loss";
}

export function getOpponent(
  game: ChessComGame,
  username: string
): { username: string; rating: number } {
  const color = getPlayerColor(game, username);
  const opp = color === "white" ? game.black : game.white;
  return { username: opp.username, rating: opp.rating };
}

export function getRatingChange(
  game: ChessComGame,
  username: string
): string {
  const outcome = getPlayerOutcome(game, username);
  if (outcome === "win") return "+";
  if (outcome === "loss") return "-";
  return "=";
}

export function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatTimeControl(tc: string): string {
  const parts = tc.split("+");
  const base = parseInt(parts[0], 10);
  const increment = parts[1] ? parseInt(parts[1], 10) : 0;

  if (base < 60) return `${base}s${increment ? `+${increment}` : ""}`;
  const minutes = Math.floor(base / 60);
  return `${minutes}${increment ? `+${increment}` : ""}`;
}

export function outcomeColor(outcome: "win" | "loss" | "draw"): string {
  switch (outcome) {
    case "win":
      return "text-accent-green";
    case "loss":
      return "text-accent-red";
    case "draw":
      return "text-accent-yellow";
  }
}

export function outcomeLabel(outcome: "win" | "loss" | "draw"): string {
  switch (outcome) {
    case "win":
      return "WIN";
    case "loss":
      return "LOSS";
    case "draw":
      return "DRAW";
  }
}
