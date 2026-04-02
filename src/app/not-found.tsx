import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-4 text-center">
      <div className="text-4xl">♟</div>
      <h2 className="text-xl font-bold">Page not found</h2>
      <Link href="/" className="text-accent-blue">
        Go home
      </Link>
    </div>
  );
}
