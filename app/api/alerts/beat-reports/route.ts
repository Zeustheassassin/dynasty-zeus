import type { NextRequest } from "next/server";
import { PFT_RSS_URL, CBS_NFL_RSS_URL, BEAT_REPORTS_REVALIDATE_S } from "../../../../lib/constants";

export const revalidate = BEAT_REPORTS_REVALIDATE_S;

export type BeatReportItem = {
  id: string;
  title: string;
  summary: string;
  author: string;
  source: string;
  sourceLabel: string;
  published: string;
  link: string | null;
  playerNames: string[];
  impact: boolean;
};

// ── Lightweight RSS 2.0 parser (no dependencies) ──────────────
// Handles CDATA sections and Dublin Core dc:creator for author fields.
function extractTag(xml: string, tag: string): string {
  const re = new RegExp(
    `<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`,
    "i"
  );
  return (xml.match(re)?.[1] ?? "").trim();
}

function extractDC(xml: string, tag: string): string {
  return extractTag(xml, `dc:${tag}`);
}

function stripHtml(str: string): string {
  return str.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").trim();
}

function parseRSSItems(xml: string, source: string, sourceLabel: string): Omit<BeatReportItem, "playerNames" | "impact">[] {
  const items: Omit<BeatReportItem, "playerNames" | "impact">[] = [];
  const matches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);
  let idx = 0;
  for (const match of matches) {
    const item = match[1];
    const title = stripHtml(extractTag(item, "title"));
    const summary = stripHtml(extractTag(item, "description")).slice(0, 300);
    const link = extractTag(item, "link") || null;
    const pubDate = extractTag(item, "pubDate");
    const author = extractDC(item, "creator") || extractTag(item, "author") || "";
    if (!title) continue;
    items.push({
      id: `${source}-${idx++}-${encodeURIComponent(title).slice(0, 20)}`,
      title,
      summary,
      author,
      source,
      sourceLabel,
      published: pubDate,
      link,
    });
  }
  return items;
}

function normalizeName(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Keywords that indicate a real NFL roster transaction
const TRANSACTION_KEYWORDS = [
  "sign", "signed", "signing", "signs",
  "release", "released", "releases", "cut", "cuts", "waive", "waived",
  "placed on ir", "injured reserve", "ir designation",
  "activated", "activate", "reinstated",
  "suspend", "suspended", "suspension",
  "trade", "traded", "trading",
  "extension", "extends", "extended",
  "franchise tag", "tagged",
  "practice squad", "ps elevation",
  "free agent", "fa signing",
  "retire", "retirement", "retires",
];

function isTransactionItem(title: string, summary: string): boolean {
  const text = `${title} ${summary}`.toLowerCase();
  return TRANSACTION_KEYWORDS.some((kw) => text.includes(kw));
}

export async function GET(request: NextRequest) {
  const playersParam = request.nextUrl.searchParams.get("players") || "";
  const filterParam = request.nextUrl.searchParams.get("filter") || "";
  const onlyTransactions = filterParam === "transactions";
  const trackedPlayers = playersParam
    .split("|")
    .map((n) => n.trim())
    .filter(Boolean)
    .slice(0, 50);

  const fetches = await Promise.allSettled([
    fetch(PFT_RSS_URL, {
      next: { revalidate: BEAT_REPORTS_REVALIDATE_S },
      headers: { Accept: "application/rss+xml, application/xml, text/xml, */*" },
    }),
    fetch(CBS_NFL_RSS_URL, {
      next: { revalidate: BEAT_REPORTS_REVALIDATE_S },
      headers: { Accept: "application/rss+xml, application/xml, text/xml, */*" },
    }),
  ]);

  const [pftResult, cbsResult] = fetches;

  const rawItems: Omit<BeatReportItem, "playerNames" | "impact">[] = [];

  if (pftResult.status === "fulfilled" && pftResult.value.ok) {
    const xml = await pftResult.value.text();
    rawItems.push(...parseRSSItems(xml, "pft", "Pro Football Talk"));
  }

  if (cbsResult.status === "fulfilled" && cbsResult.value.ok) {
    const xml = await cbsResult.value.text();
    rawItems.push(...parseRSSItems(xml, "cbs", "CBS Sports"));
  }

  // Sort newest first (RFC 822 dates parse fine via Date constructor)
  rawItems.sort((a, b) => {
    const ta = a.published ? new Date(a.published).getTime() : 0;
    const tb = b.published ? new Date(b.published).getTime() : 0;
    return tb - ta;
  });

  // Deduplicate: if PFT and CBS both carry the same story, keep the first (newest source wins).
  // Compare normalised titles — strip punctuation, lowercase, take first 60 chars.
  const normaliseTitle = (t: string) =>
    t.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
  const seenTitles = new Set<string>();
  const dedupedItems = rawItems.filter((item) => {
    const key = normaliseTitle(item.title);
    if (seenTitles.has(key)) return false;
    seenTitles.add(key);
    return true;
  });

  // Match tracked players against title + summary
  const items: BeatReportItem[] = dedupedItems.map((item) => {
    const body = normalizeName(`${item.title} ${item.summary}`);
    const playerNames = trackedPlayers.filter((name) =>
      body.includes(normalizeName(name))
    );
    return { ...item, playerNames, impact: playerNames.length > 0 };
  });

  // Apply transaction filter if requested
  const filtered = onlyTransactions
    ? items.filter((item) => isTransactionItem(item.title, item.summary))
    : items;

  return Response.json({ items: filtered.slice(0, 40) });
}
