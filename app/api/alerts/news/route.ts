import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const normalizeName = (value: string) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export async function GET(request: NextRequest) {
  const playersParam = request.nextUrl.searchParams.get("players") || "";
  const trackedPlayers = playersParam
    .split("|")
    .map((name) => name.trim())
    .filter(Boolean)
    .slice(0, 12);

  try {
    const res = await fetch("https://site.api.espn.com/apis/site/v2/sports/football/nfl/news", {
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
    });
    const data = await res.json();
    const articles = Array.isArray(data?.articles) ? data.articles : [];

    const items = articles
      .map((article: any, index: number) => {
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
      .filter((item: any) => item.title && (item.impact || trackedPlayers.length === 0))
      .slice(0, 12);

    return Response.json({ items });
  } catch {
    return Response.json({ items: [] });
  }
}
