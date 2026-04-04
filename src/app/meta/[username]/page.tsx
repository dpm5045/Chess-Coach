import Link from "next/link";
import { notFound } from "next/navigation";
import { ALLOWED_USERS, isAllowedUser } from "@/lib/chess-com";
import { MetaAnalysisResult } from "@/lib/types";
import { MetaAnalysisView } from "@/components/meta-analysis-view";

export async function generateStaticParams() {
  return ALLOWED_USERS.map((username) => ({ username }));
}

export default async function MetaAnalysisPage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;

  if (!isAllowedUser(username)) {
    notFound();
  }

  let result: MetaAnalysisResult;
  try {
    result = (await import(`@/data/meta/${username.toLowerCase()}.json`)).default;
  } catch {
    notFound();
  }

  return (
    <div className="mx-auto max-w-lg md:max-w-2xl px-4 pt-6 pb-8">
      <Link href="/" className="mb-4 inline-block text-sm text-gray-400 transition hover:text-gray-200">
        &larr; Back
      </Link>

      <h1 className="mb-1 text-2xl font-bold">{username}&apos;s Coaching Report</h1>
      {result.gamesAnalyzed > 0 && (
        <p className="mb-6 text-sm text-gray-400">
          Based on {result.gamesAnalyzed} games ({result.timeRange})
        </p>
      )}

      <MetaAnalysisView data={result} />
    </div>
  );
}
