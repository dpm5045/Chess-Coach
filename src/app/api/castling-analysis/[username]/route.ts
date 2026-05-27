import { NextRequest } from "next/server";
import { Chess } from "chess.js";
import { isAllowedUser, getPlayerColor, getPlayerOutcome } from "@/lib/chess-com";
import { getAllGames } from "@/lib/game-cache";
import { CastlingAnalysisResult, CastlingStats } from "@/lib/types";

interface CastlingInfo {
  castled: boolean;
  side: "kingside" | "queenside" | null;
  moveNumber: number | null;
}

function detectCastling(pgn: string, playerColor: "white" | "black"): CastlingInfo {
  try {
    const chess = new Chess();
    chess.loadPgn(pgn);
    const history = chess.history({ verbose: true });
    const color = playerColor === "white" ? "w" : "b";

    for (let i = 0; i < history.length; i++) {
      const move = history[i];
      if (move.color === color) {
        if (move.san === "O-O") {
          return { castled: true, side: "kingside", moveNumber: Math.floor(i / 2) + 1 };
        }
        if (move.san === "O-O-O") {
          return { castled: true, side: "queenside", moveNumber: Math.floor(i / 2) + 1 };
        }
      }
    }

    return { castled: false, side: null, moveNumber: null };
  } catch {
    return { castled: false, side: null, moveNumber: null };
  }
}

function makeStats(wins: number, draws: number, losses: number): CastlingStats {
  const total = wins + draws + losses;
  return {
    total,
    wins,
    draws,
    losses,
    winRate: total > 0 ? Math.round((wins / total) * 100) : 0,
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  const { username } = await params;

  if (!isAllowedUser(username)) {
    return Response.json({ error: "Player not available" }, { status: 403 });
  }

  try {
    const games = await getAllGames(username, 3);

    type Wdl = { w: number; d: number; l: number };
    const fresh = (): Wdl => ({ w: 0, d: 0, l: 0 });

    const castledAll = fresh();
    const castledWhite = fresh();
    const castledBlack = fresh();
    const noCastleAll = fresh();
    const noCastleWhite = fresh();
    const noCastleBlack = fresh();
    const kingside = fresh();
    const queenside = fresh();

    let totalCastlingMove = 0;
    let castlingMoveCount = 0;

    for (const game of games) {
      const color = getPlayerColor(game, username);
      const outcome = getPlayerOutcome(game, username);
      const info = detectCastling(game.pgn, color);

      const k: keyof Wdl = outcome === "win" ? "w" : outcome === "draw" ? "d" : "l";

      if (info.castled) {
        castledAll[k]++;
        (color === "white" ? castledWhite : castledBlack)[k]++;
        (info.side === "kingside" ? kingside : queenside)[k]++;
        if (info.moveNumber !== null) {
          totalCastlingMove += info.moveNumber;
          castlingMoveCount++;
        }
      } else {
        noCastleAll[k]++;
        (color === "white" ? noCastleWhite : noCastleBlack)[k]++;
      }
    }

    const result: CastlingAnalysisResult = {
      username,
      gamesAnalyzed: games.length,
      overall: {
        castled: makeStats(castledAll.w, castledAll.d, castledAll.l),
        didNotCastle: makeStats(noCastleAll.w, noCastleAll.d, noCastleAll.l),
      },
      byColor: {
        asWhite: {
          castled: makeStats(castledWhite.w, castledWhite.d, castledWhite.l),
          didNotCastle: makeStats(noCastleWhite.w, noCastleWhite.d, noCastleWhite.l),
        },
        asBlack: {
          castled: makeStats(castledBlack.w, castledBlack.d, castledBlack.l),
          didNotCastle: makeStats(noCastleBlack.w, noCastleBlack.d, noCastleBlack.l),
        },
      },
      bySide: {
        kingside: makeStats(kingside.w, kingside.d, kingside.l),
        queenside: makeStats(queenside.w, queenside.d, queenside.l),
      },
      averageCastlingMove:
        castlingMoveCount > 0 ? Math.round(totalCastlingMove / castlingMoveCount) : null,
    };

    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: `Failed to analyze castling: ${message}` }, { status: 500 });
  }
}
