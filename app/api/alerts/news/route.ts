import type { NextRequest } from "next/server";
import { ESPN_NFL_NEWS_URL, ESPN_NEWS_REVALIDATE_S } from "../../../../lib/constants";
import { checkRateLimit } from "../../../../lib/rateLimit";

// Revalidate every 30 seconds — batches concurrent requests instead of hitting ESPN on every call
// NOTE: This must be a static literal (not an import) for Next.js segment config to work.
export const revalidate = 30;

const normalizeName = (value: string) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export async function GET(request: NextRequest): Promise<Response> {
  const rl = checkRateLimit(request, 15, 60_000, 'news');
  if (!rl.allowed) return rl.response;

  const playersParam = request.nextUrl.searchParams.get("players") || "";
  const trackedPlayers = playersParam
    .split("|")
    .map((name) => name.trim())
    .filter(Boolean)
    .slice(0, 12);

  try {
    const res = await fetch(ESPN_NFL_NEWS_URL, {
      next: { revalidate: ESPN_NEWS_REVALIDATE_S },
      headers: {
        Accept: "application/json",
      },
    });
    if (!res.ok) return Response.json({ items: [] });
    const data = await res.json() as { articles?: unknown[] };
    const articles = Array.isArray(data?.articles) ? data.articles : [];

    interface EspnArticle {
      id?: string | number;
      headline?: string;
      description?: string;
      story?: string;
      published?: string;
      lastModified?: string;
      links?: { web?: { href?: string } };
      link?: string;
    }

    const items = (articles as EspnArticle[])
      .map((article, index: number) => {
        const title = String(article?.headline || "");
        const summary = String(article?.description || article?.story || "");
        const body = normalizeName(`${title} ${summary}`);
        const matchedPlayers = trackedPlayers.filter((playerName) => body.includes(normalizeName(playerName)));

        return {
          id: article?.id || `${Date.now()}-${index}`,
          title,
          summary,
          published: article?.published || article?.lastModified || new Date().toISOString(),
          link: article?.links?.web?.href || article?.link || null,
          playerNames: matchedPlayers,
          impact: matchedPlayers.length > 0,
        };
      })
      .filter((item) => item.title && (item.impact || trackedPlayers.length === 0))
      .slice(0, 12);

    return Response.json({ items });
  } catch {
    return Response.json({ items: [] });
  }
}
