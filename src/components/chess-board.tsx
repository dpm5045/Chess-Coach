"use client";

import { Chessboard } from "react-chessboard";

export function ChessBoard({ fen, orientation = "white" }: { fen: string; orientation?: "white" | "black" }) {
  return (
    <div className="mx-auto w-full max-w-[280px] md:max-w-[420px]">
      <Chessboard
        options={{
          position: fen,
          boardOrientation: orientation,
          allowDragging: false,
          showNotation: true,
          showAnimations: false,
          allowDrawingArrows: false,
          darkSquareStyle: { backgroundColor: "#b58863" },
          lightSquareStyle: { backgroundColor: "#f0d9b5" },
          boardStyle: {
            borderRadius: "6px",
            overflow: "hidden",
            border: "1px solid #4a5568",
          },
        }}
      />
    </div>
  );
}
