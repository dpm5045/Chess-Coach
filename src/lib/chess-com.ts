import { ChessComPlayer, ChessComStats, ChessComGame } from "./types";

const CHESS_COM_API = "https://api.chess.com/pub";

export const ALLOWED_USERS = ["castledoon", "exstrax"];

export function isAllowedUser(username: string): boolean {
  return ALLOWED_USERS.includes(username.toLowerCase());
}
const HEADERS = {
  "User-Agent": "ChessCoach/1.0 (github.com/chess-coach)",
  Accept: "application/json",
};

async function chessComFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${CHESS_COM_API}${path}`, { headers: HEADERS });
  if (!res.ok) {
    throw new Error(`Chess.com API error: ${res.status} for ${path}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchPlayer(username: string): Promise<ChessComPlayer> {
  return chessComFetch<ChessComPlayer>(`/player/${username.toLowerCase()}`);
}

export async function fetchStats(username: string): Promise<ChessComStats> {
  return chessComFetch<ChessComStats>(`/player/${username.toLowerCase()}/stats`);
}

export async function fetchArchives(username: string): Promise<string[]> {
  const data = await chessComFetch<{ archives: string[] }>(
    `/player/${username.toLowerCase()}/games/archives`
  );
  return data.archives;
}

export async function fetchGamesFromArchive(
  archiveUrl: string
): Promise<ChessComGame[]> {
  const res = await fetch(archiveUrl, { headers: HEADERS });
  if (!res.ok) {
    throw new Error(`Chess.com archive error: ${res.status}`);
  }
  const data = (await res.json()) as { games: ChessComGame[] };
  return data.games;
}

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
): "win" | "draw" | "loss" {
  const color = getPlayerColor(game, username);
  const result = game[color].result;
  if (result === "win") return "win";
  if (
    [
      "stalemate",
      "insufficient",
      "repetition",
      "agreed",
      "50move",
      "timevsinsufficient",
    ].includes(result)
  )
    return "draw";
  return "loss";
}
