"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-4 text-center">
      <div className="text-4xl">😵</div>
      <h2 className="text-xl font-bold">Something went wrong</h2>
      <p className="text-gray-400">{error.message}</p>
      <button
        onClick={reset}
        className="rounded-lg bg-accent-blue px-6 py-2 font-semibold text-white"
      >
        Try again
      </button>
    </div>
  );
}
