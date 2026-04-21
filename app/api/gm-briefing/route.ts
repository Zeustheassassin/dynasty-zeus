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
  nflTeam: string;
  age: number | null;
  dynastyValue: number;
  redraftValue: number;
  trend30Day: number | null;
  injuryStatus?: string | null;
  tag?: string | null;
}

interface BriefingTradePartner {
  ownerName: string;
  bucket: string;
  motivation: string;
  strongestPos: string;
  weakPositions: string[];
  isSeller: boolean;
  isBuyer: boolean;
  topPlayers: { name: string; position: string; dynastyValue: number }[];
}

interface BriefingContext {
  leagueName: string;
  leagueSize: number;
  isSuperflex: boolean;
  rosterPositions: string[];
  starterSlotCounts: Record<string, number>;
  pickInventory: string[];
  currentYear: number;
  scoringHighlights: string;
  recentNews: string[];
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
    titleOdds: number;
    finishRange: string;
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
      const team = p.nflTeam && p.nflTeam !== "FA" ? ` [${p.nflTeam}]` : " [FA - unsigned]";
      const injury = p.injuryStatus ? ` ⚠${p.injuryStatus}` : "";
      const tag = p.tag === "CORE" ? " 🔒CORE" : p.tag === "WANT_TO_TRADE" ? " 🔄TRADE CANDIDATE" : "";
      return `  ${p.position} ${p.name}${team}${age} — dynasty ${p.dynastyValue}, redraft ${p.redraftValue}${trend}${injury}${tag}`;
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
    ? tradePartners.map((tp) => {
        const tag = tp.isSeller ? " [SELLER]" : tp.isBuyer ? " [BUYER]" : "";
        const weak = tp.weakPositions.length > 0 ? `, needs ${tp.weakPositions.join("/")}` : "";
        const top = tp.topPlayers.length > 0
          ? `\n    Assets: ${tp.topPlayers.map((pl) => `${pl.name} (${pl.position}, ${pl.dynastyValue})`).join(", ")}`
          : "";
        return `  ${tp.ownerName}: ${tp.bucket}${tag} — strong at ${tp.strongestPos}${weak}${top}`;
      }).join("\n")
    : "  No clear trade partners identified";

  const superflexNote = ctx.isSuperflex
    ? "SUPERFLEX — QBs fill a second starting flex spot, making them worth roughly 1.5–2× their value in a 1QB format. A QB with dynasty value 4000+ is a core dynasty asset, not expendable depth. Never recommend trading a high-value QB simply because the roster has multiple QBs — evaluate each by actual value and realistic NFL ceiling. A QB under 1500 in value who is a backup or bust risk is a dart throw, not real depth."
    : "1QB format.";

  const starterSummary = Object.entries(ctx.starterSlotCounts)
    .map(([pos, n]) => `${n}× ${pos}`)
    .join(", ");

  const pickInvDisplay = ctx.pickInventory.length > 0
    ? ctx.pickInventory.join(" | ")
    : "No future picks";

  return `You are an expert dynasty fantasy football GM advisor. You think in 2–3 year time horizons, not just the current season.

=== LEAGUE FORMAT ===
${ctx.isSuperflex ? "SUPERFLEX" : "1QB"} dynasty, ${ctx.leagueSize} teams. Current year: ${ctx.currentYear}.
${superflexNote}

=== DYNASTY VALUE SCALE (league-adjusted, 0–10000) ===
Elite asset: 6000+. Solid starter: 3000–6000. Rotational/upside piece: 1000–3000. Dart/throwaway: under 1000.
Use these thresholds to judge whether a player is a real asset or roster filler — never rely on position count alone.

=== STARTING LINEUP & TANK STRATEGY ===
Required starters: ${starterSummary}
An incomplete or non-competitive starting lineup is NOT automatically bad. In a deliberate tank/rebuild, intentionally fielding a weak lineup to finish lower in standings and secure a better draft pick is a legitimate and often optimal strategy. Only flag lineup gaps as urgent if the team is trying to compete this year.

=== PICK INVENTORY PHILOSOPHY ===
If a team already has multiple first-rounders, prioritize converting picks into players — more picks do not always equal more value, especially across multiple draft years. If pick inventory is thin, acquiring capital matters more. Apply your knowledge of upcoming draft class strength — a historically deep class increases pick value; a thin class decreases it. Spread across years matters: owning picks in a strong class year is worth more than the same number of picks in a down year.

=== TRADE STRATEGY — BILATERAL THINKING ===
A trade only happens if BOTH sides benefit. Before suggesting any trade involving a specific league opponent, consider their situation:
- What bucket are they in? (contender vs rebuilder determines what they want)
- What positions are they weak at? That is what they are willing to overpay for.
- What positions are they strong at? That is where they can be pressured to sell.
- Are their timelines aligned? Seller/buyer matchups are the highest-percentage trades.
- Are they an active trader recently? Active traders are more likely to move.
Frame trade suggestions as "Team X would likely accept because..." — not just what you want.

=== HOLD vs SELL PHILOSOPHY ===
Selling is NOT always the right answer, even in a rebuild. Key principles:
1. If a player's value is near its floor due to a temporary situation (free agent, depth chart uncertainty, team circumstance), holding through that uncertainty is often better than selling at a discount.
2. Only sell if the return you receive meaningfully improves your team. A minimal return for a player with legitimate upside is often a bad deal.
3. Buy-low opportunities exist on the other side too — players with depressed values due to temporary situations are worth targeting in trades.
4. Sell-high timing matters: sell when a player has just had a strong stretch or positive news, not after the market has already corrected.
5. Patience is a strategy. A player on a bad contract situation today can be a difference-maker the moment they sign with a contender.

=== CURRENT DYNASTY CALENDAR CONTEXT (critical for urgency calibration) ===
The NFL Draft begins this week (late April ${ctx.currentYear}). Dynasty rookie drafts typically occur within 1–2 weeks of the NFL Draft, sometimes sooner. This means:
1. PICKS ARE ABOUT TO CONVERT TO PLAYERS. A team sitting on 8 first-rounders right now will likely have 8 rookies within 2 weeks. Pick-heavy rosters are about to become player-heavy — factor this into any rebuild/contention assessment.
2. PRE-DRAFT IS THE BEST TIME TO TRADE PICKS. Pick value is at its peak right now — before landing spots are known and hype adjusts. After the draft, rookie values shift dramatically based on scheme fit, depth chart position, and role. Selling picks for established players before the draft is often the optimal window.
3. NO URGENCY TO WIN NOW. The NFL regular season doesn't start for 4–5 months. There is zero pressure to field a competitive lineup today. Teams should NOT be making panic moves to add redraft points in the offseason. The correct frame is: position yourself optimally for when the season starts, not for today.
4. ROOKIE DRAFT POSITIONING MATTERS. Where a team drafts in the rookie draft (based on last season's finish or a set order) can significantly affect their outcome. If a team is tanking to get a top rookie pick, that strategy is still in play.
5. POST-DRAFT VALUE SHIFTS. After landing spots are revealed, some rookies spike in value (immediate starter, great scheme fit) while others crater (blocked by a veteran, wrong system). Teams that can predict these outcomes and move quickly after the draft have a real edge.

=== REBUILD PHILOSOPHY ===
A rebuild does not mean liquidate everything. Holding a young elite player (value 5000+) through a rebuild is usually correct — they appreciate as you rebuild around them. Only trade genuine stars if the return is transformative. The goal of a tank year is to emerge with both draft capital AND the young core already in place.

Return ONLY valid JSON, nothing else:
{
  "urgency": "critical" | "high" | "medium" | "low",
  "headline": "one punchy sentence, most important priority right now (max 15 words)",
  "writeup": "3-4 sentences of specific, nuanced analysis. Name players by name and dynasty value. Consider hold vs sell carefully — acknowledge when patience is the right call. Reference trade partners by name when relevant and explain why the deal makes sense for BOTH sides. Reference pick inventory and draft class quality where applicable.",
  "bullets": ["specific action 1 (max 12 words)", "specific action 2 (max 12 words)", "specific action 3 (max 12 words)"]
}

Urgency: critical = act this week; high = act within 2 weeks; medium = monitor; low = stay the course.

=== TEAM DATA ===
League: ${ctx.leagueName} (${ctx.leagueSize} teams) — ${ctx.isSuperflex ? "SUPERFLEX" : "1QB"} dynasty
Scoring: ${ctx.scoringHighlights}
Starting lineup: ${starterSummary}
Record: ${myTeam.wins}-${myTeam.losses}-${myTeam.ties}, Standings: ${myTeam.standingsRank}/${ctx.leagueSize}
Strategic bucket: ${profile.bucket}
Dynasty rank: ${profile.dynRank}/${profile.totalTeams} | Redraft rank: ${profile.redRank}/${profile.totalTeams}
Core age: ${profile.coreAge} | Young core players: ${profile.youngCoreCount} | Aging core: ${profile.oldCoreCount}
Pick inventory by year: ${pickInvDisplay}
Playoff odds: ${profile.playoffOdds}%${profile.titleOdds ? ` | Title odds: ${profile.titleOdds}%` : ""}${profile.finishRange ? ` | Projected finish: ${profile.finishRange}` : ""}
Position ranks in league: ${posRanks}

ROSTER (sorted by dynasty value — value is already league-scoring-adjusted):
${rosterLines}

30-DAY MARKET MOVEMENT:
Falling: ${falling}
Rising: ${rising}

TRADE LANDSCAPE — OTHER TEAMS IN THIS LEAGUE:
${partners}${ctx.recentNews.length > 0 ? `

RECENT NEWS (live headlines filtered to this roster — prioritize these over training data for current situations):
${ctx.recentNews.map((h, i) => `  ${i + 1}. ${h}`).join("\n")}` : ""}`;
}

export async function POST(req: NextRequest) {
  let userId = "", leagueId = "", rosterId = 0, leagueName = "", context: BriefingContext | null = null;
  try {
    const body = (await req.json()) as RequestBody;
    userId = body.userId;
    leagueId = body.leagueId;
    rosterId = body.rosterId;
    leagueName = body.leagueName;
    context = body.context;
  } catch (e) {
    console.error("[gm-briefing] Failed to parse request body:", e);
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

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

  let prompt: string;
  try {
    prompt = buildPrompt(context!);
  } catch (e) {
    console.error("[gm-briefing] buildPrompt threw:", e);
    return NextResponse.json({ error: `buildPrompt error: ${String(e)}` }, { status: 500 });
  }

  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
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
  } catch (e) {
    console.error("[gm-briefing] Anthropic fetch threw:", e);
    return NextResponse.json({ error: `Network error: ${String(e)}` }, { status: 500 });
  }

  if (!res.ok) {
    const err = await res.text();
    console.error("[gm-briefing] Anthropic returned", res.status, err);
    return NextResponse.json({ error: err, anthropicStatus: res.status }, { status: 500 });
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
