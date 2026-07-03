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
 * Get all legal moves (in SAN notation) at the position just before a played move.
 * Optionally exclude the played move itself from the results.
 */
export function getLegalMovesAt(
  pgn: string,
  moveNumber: number,
  playedMove: string
): string[] {
  try {
    const chess = new Chess();
    chess.loadPgn(pgn);
    const history = chess.history();

    const replay = new Chess();

    const whiteIndex = (moveNumber - 1) * 2;
    const blackIndex = whiteIndex + 1;

    let targetIndex: number;
    if (history[whiteIndex] === playedMove) {
      targetIndex = whiteIndex;
    } else if (history[blackIndex] === playedMove) {
      targetIndex = blackIndex;
    } else {
      return [];
    }

    for (let i = 0; i < targetIndex && i < history.length; i++) {
      replay.move(history[i]);
    }

    // Return all legal moves except the one that was played
    return replay.moves().filter((m) => m !== playedMove);
  } catch {
    return [];
  }
}

/**
 * Check if a move (in SAN notation) is legal in the position after a given move number.
 * Returns true if the move is a legal reply at that point in the game.
 */
export function isLegalMoveAt(
  pgn: string,
  moveNumber: number,
  playedMove: string,
  candidateMove: string
): boolean {
  try {
    const chess = new Chess();
    chess.loadPgn(pgn);
    const history = chess.history();

    const replay = new Chess();

    // Replay up to (but not including) the played move to get the position
    // where the player was on the clock.
    const whiteIndex = (moveNumber - 1) * 2;
    const blackIndex = whiteIndex + 1;

    let targetIndex: number;
    if (history[whiteIndex] === playedMove) {
      targetIndex = whiteIndex;
    } else if (history[blackIndex] === playedMove) {
      targetIndex = blackIndex;
    } else {
      // Can't locate the move in the game — can't validate
      return false;
    }

    // Replay up to just before the played move
    for (let i = 0; i < targetIndex && i < history.length; i++) {
      replay.move(history[i]);
    }

    // Now try the candidate move in this position
    const result = replay.move(candidateMove);
    return result !== null;
  } catch {
    return false;
  }
}

/**
 * Verify that a move actually appears in the game at the given move number.
 */
export function moveExistsInGame(
  pgn: string,
  moveNumber: number,
  move: string
): boolean {
  try {
    const chess = new Chess();
    chess.loadPgn(pgn);
    const history = chess.history();

    const whiteIndex = (moveNumber - 1) * 2;
    const blackIndex = whiteIndex + 1;

    return history[whiteIndex] === move || history[blackIndex] === move;
  } catch {
    return false;
  }
}

/**
 * Get the FEN position just before a move is played (the position where the
 * player had to make a decision).
 */
export function getFenBeforeMove(
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
      return null;
    }

    for (let i = 0; i < targetIndex && i < history.length; i++) {
      replay.move(history[i]);
    }

    return replay.fen();
  } catch {
    return null;
  }
}

/**
 * Convert a UCI move (e.g. "e2e4") to SAN (e.g. "e4") given a FEN position.
 * Returns null if the move is illegal in that position.
 */
export function uciToSan(fen: string, uciMove: string): string | null {
  try {
    const chess = new Chess(fen);
    const from = uciMove.slice(0, 2);
    const to = uciMove.slice(2, 4);
    const promotion = uciMove.length > 4 ? uciMove[4] : undefined;
    const result = chess.move({ from, to, promotion });
    return result ? result.san : null;
  } catch {
    return null;
  }
}

/**
 * Convert a UCI line (array of UCI moves) to SAN, starting from a FEN position.
 * Stops at the first illegal move.
 */
export function uciLineToSan(fen: string, uciMoves: string[]): string[] {
  const sanMoves: string[] = [];
  const chess = new Chess(fen);
  for (const uci of uciMoves) {
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = uci.length > 4 ? uci[4] : undefined;
    try {
      const result = chess.move({ from, to, promotion });
      if (!result) break;
      sanMoves.push(result.san);
    } catch {
      break;
    }
  }
  return sanMoves;
}

/** Check whether a SAN move is legal in the given FEN position. */
export function isLegalMoveInFen(fen: string, san: string): boolean {
  try {
    const chess = new Chess(fen);
    return chess.move(san) !== null;
  } catch {
    return false;
  }
}

/** All legal SAN moves in a FEN position, optionally excluding one move. */
export function getLegalMovesInFen(fen: string, exclude?: string): string[] {
  try {
    const chess = new Chess(fen);
    return chess.moves().filter((m) => m !== exclude);
  } catch {
    return [];
  }
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
