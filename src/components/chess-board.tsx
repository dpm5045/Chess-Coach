import { fenToBoard } from "@/lib/chess-utils";

const PIECE_UNICODE: Record<string, string> = {
  K: "\u2654",
  Q: "\u2655",
  R: "\u2656",
  B: "\u2657",
  N: "\u2658",
  P: "\u2659",
  k: "\u265A",
  q: "\u265B",
  r: "\u265C",
  b: "\u265D",
  n: "\u265E",
  p: "\u265F",
};

function isLightSquare(index: number): boolean {
  const row = Math.floor(index / 8);
  const col = index % 8;
  return (row + col) % 2 === 0;
}

export function ChessBoard({ fen }: { fen: string }) {
  const board = fenToBoard(fen);

  return (
    <div className="mx-auto w-full max-w-[280px]">
      <div className="grid grid-cols-8 overflow-hidden rounded-md border border-gray-700">
        {board.map((piece, i) => (
          <div
            key={i}
            className={`flex aspect-square items-center justify-center text-xl sm:text-2xl ${
              isLightSquare(i)
                ? "bg-amber-100 text-gray-800"
                : "bg-amber-800 text-gray-100"
            }`}
          >
            {piece ? PIECE_UNICODE[piece] : ""}
          </div>
        ))}
      </div>
    </div>
  );
}
