import { Chess } from "chess.js";

/**
 * Parse a PGN and return the FEN position after a given move number.
 * moveNumber is 1-indexed. The move string is used to determine if it's White's or Black's move.
 */
export function getFenAtMove(
  pgn: string,
  moveNumber: number,
  move: string
): string | null {
  try {
    const chess = new Chess();
    chess.loadPgn(pgn);
    const history = chess.history();

    const replay = new Chess();

    const whiteIndex = (moveNumber - 1) * 2;
    const blackIndex = whiteIndex + 1;

    let targetIndex: number;
    if (history[whiteIndex] === move) {
      targetIndex = whiteIndex;
    } else if (history[blackIndex] === move) {
      targetIndex = blackIndex;
    } else {
      targetIndex = whiteIndex;
    }

    for (let i = 0; i <= targetIndex && i < history.length; i++) {
      replay.move(history[i]);
    }

    return replay.fen();
  } catch {
    return null;
  }
}

export interface MoveDetail {
  moveNumber: number;
  color: "w" | "b";
  san: string;
  from: string;
  to: string;
  fen: string;
}

/**
 * Parse a PGN and return all moves with from/to squares and FEN after each move.
 */
export function getAllMoves(pgn: string): MoveDetail[] {
  try {
    const chess = new Chess();
    chess.loadPgn(pgn);
    const history = chess.history({ verbose: true });

    const replay = new Chess();
    const moves: MoveDetail[] = [];

    for (const move of history) {
      replay.move(move.san);
      moves.push({
        moveNumber: Math.ceil(moves.length / 2) + (moves.length % 2 === 0 ? 0 : 0),
        color: move.color,
        san: move.san,
        from: move.from,
        to: move.to,
        fen: replay.fen(),
      });
    }

    // Fix move numbers: white moves are odd indices (0,2,4..), black are even (1,3,5..)
    for (let i = 0; i < moves.length; i++) {
      moves[i].moveNumber = Math.floor(i / 2) + 1;
    }

    return moves;
  } catch {
    return [];
  }
}

/**
 * Get the from/to label for a move matching a given moveNumber and SAN.
 */
export function getMoveFromTo(
  allMoves: MoveDetail[],
  moveNumber: number,
  san: string
): string | null {
  const match = allMoves.find(
    (m) => m.moveNumber === moveNumber && m.san === san
  );
  if (!match) return null;
  return `${match.from}→${match.to}`;
}

/**
 * Parse a FEN string into an 8x8 board array.
 * Returns array of 64 entries, row by row from rank 8 to rank 1.
 * Each entry is a piece character or null for empty squares.
 */
export function fenToBoard(fen: string): (string | null)[] {
  const board: (string | null)[] = [];
  const ranks = fen.split(" ")[0].split("/");

  for (const rank of ranks) {
    for (const char of rank) {
      if (/\d/.test(char)) {
        for (let i = 0; i < parseInt(char, 10); i++) {
          board.push(null);
        }
      } else {
        board.push(char);
      }
    }
  }

  return board;
}
