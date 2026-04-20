import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

const URGENCY_LABELS: Record<string, string> = {
  critical: "Act This Week",
  high: "Act Soon",
  medium: "Worth Watching",
  low: "Hold Pat",
};

interface BriefingPlayer {
  name: string;
  position: string;
  age: number | null;
  dynastyValue: number;
  redraftValue: number;
  trend30Day: number | null;
}

interface BriefingTradePartner {
  ownerName: string;
  bucket: string;
  motivation: string;
  strongestPos: string;
  isSeller: boolean;
  isBuyer: boolean;
}

interface BriefingContext {
  leagueName: string;
  leagueSize: number;
  myTeam: {
    wins: number;
    losses: number;
    ties: number;
    standingsRank: number;
    waiverPosition: number;
    players: BriefingPlayer[];
  };
  profile: {
    bucket: string;
    bucketColor: string;
    dynRank: number;
    redRank: number;
    totalTeams: number;
    coreAge: number;
    youngCoreCount: number;
    oldCoreCount: number;
    firstRounders: number;
    futureFirsts: number;
    pickTotal: number;
    playoffOdds: number;
    positionRanks: { pos: string; rank: number; total: number }[];
    actions: string[];
  };
  marketMovers: {
    falling: { name: string; pos: string; delta: number }[];
    rising: { name: string; pos: string; delta: number }[];
  };
  tradePartners: BriefingTradePartner[];
}

interface RequestBody {
  userId: string;
  leagueId: string;
  rosterId: number;
  leagueName: string;
  context: BriefingContext;
}

function buildPrompt(ctx: BriefingContext): string {
  const { myTeam, profile, marketMovers, tradePartners } = ctx;

  const rosterLines = myTeam.players
    .slice(0, 20)
    .map((p) => {
      const trend = p.trend30Day != null && p.trend30Day !== 0
        ? ` (${p.trend30Day > 0 ? "+" : ""}${p.trend30Day} 30d)`
        : "";
      const age = p.age != null ? `, age ${p.age}` : "";
      return `  ${p.position} ${p.name}${age} — dynasty ${p.dynastyValue}, redraft ${p.redraftValue}${trend}`;
    })
    .join("\n");

  const posRanks = profile.positionRanks
    .map((pr) => `${pr.pos}: ${pr.rank}/${pr.total}`)
    .join(", ");

  const falling = marketMovers.falling.length > 0
    ? marketMovers.falling.map((p) => `${p.name} (${p.pos}) ${p.delta}`).join(", ")
    : "none";

  const rising = marketMovers.rising.length > 0
    ? marketMovers.rising.map((p) => `${p.name} (${p.pos}) +${p.delta}`).join(", ")
    : "none";

  const partners = tradePartners.length > 0
    ? tradePartners
        .map((tp) => `  ${tp.ownerName}: ${tp.bucket}${tp.isSeller ? " [SELLER]" : ""}${tp.isBuyer ? " [BUYER]" : ""} — strongest ${tp.strongestPos}, motivation: ${tp.motivation}`)
        .join("\n")
    : "  No clear trade partners identified";

  return `You are a dynasty fantasy football GM advisor. Analyze this team and write a concise, specific briefing.

Return ONLY valid JSON, nothing else:
{
  "urgency": "critical" | "high" | "medium" | "low",
  "headline": "one punchy sentence capturing the most urgent priority (max 15 words)",
  "writeup": "3-4 sentences of specific analysis. Name players by name. Call out concrete opportunities or risks. Be direct.",
  "bullets": ["specific action 1 (max 12 words)", "specific action 2 (max 12 words)", "specific action 3 (max 12 words)"]
}

Urgency guide: critical = act this week or miss the window; high = act within 2 weeks; medium = monitor actively; low = stay the course.

TEAM DATA:
League: ${ctx.leagueName} (${ctx.leagueSize} teams)
Record: ${myTeam.wins}-${myTeam.losses}-${myTeam.ties}, Standings: ${myTeam.standingsRank}/${ctx.leagueSize}
Strategic bucket: ${profile.bucket}
Dynasty rank: ${profile.dynRank}/${profile.totalTeams} | Redraft rank: ${profile.redRank}/${profile.totalTeams}
Core age: ${profile.coreAge} | Young core: ${profile.youngCoreCount} | Aging core: ${profile.oldCoreCount}
Pick inventory: ${profile.firstRounders} 1sts (${profile.futureFirsts} future), ${profile.pickTotal} total
Playoff odds: ${profile.playoffOdds}%
Position strength ranks: ${posRanks}
Advisor actions from profile: ${profile.actions.join("; ")}

ROSTER (sorted by dynasty value):
${rosterLines}

MARKET MOVEMENT (30-day dynasty value change):
Falling: ${falling}
Rising: ${rising}

TRADE LANDSCAPE IN THIS LEAGUE:
${partners}`;
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as RequestBody;
  const { userId, leagueId, rosterId, leagueName, context } = body;

  // Account allowlist — comma-separated Supabase user UUIDs in GM_BRIEFING_ALLOWED_USER_IDS
  const allowed = (process.env.GM_BRIEFING_ALLOWED_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowed.length === 0 || !allowed.includes(userId)) {
    return NextResponse.json({ error: "Not authorized for GM Briefing" }, { status: 403 });
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
  }

  const prompt = buildPrompt(context);

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 900,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json({ error: err }, { status: 500 });
  }

  const data = (await res.json()) as { content: { type: string; text: string }[] };
  const text = data.content.find((c) => c.type === "text")?.text ?? "";

  // Extract JSON block from response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return NextResponse.json({ error: "Invalid AI response format" }, { status: 500 });
  }

  let parsed: { urgency?: string; headline?: string; writeup?: string; bullets?: string[] };
  try {
    parsed = JSON.parse(jsonMatch[0]) as typeof parsed;
  } catch {
    return NextResponse.json({ error: "Failed to parse AI response" }, { status: 500 });
  }

  const urgency = (["critical", "high", "medium", "low"].includes(parsed.urgency ?? "")
    ? parsed.urgency
    : "medium") as "critical" | "high" | "medium" | "low";

  const generatedAt = new Date().toISOString();

  const briefing = {
    rosterId,
    leagueId,
    leagueName,
    ownerName: "You",
    isMyTeam: true,
    urgency,
    urgencyLabel: URGENCY_LABELS[urgency],
    bucket: context.profile.bucket,
    bucketColor: context.profile.bucketColor,
    headline: parsed.headline ?? "",
    writeup: parsed.writeup ?? "",
    bullets: parsed.bullets ?? [],
    fallingPlayers: context.marketMovers.falling,
    risingPlayers: context.marketMovers.rising,
    generatedAt,
    isAi: true,
  };

  return NextResponse.json({ briefing });
}
