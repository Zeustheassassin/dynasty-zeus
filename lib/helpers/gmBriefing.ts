// ============================================================
// GM Briefing — per-team weekly recommendation engine.
// Pure rule-based logic: no AI calls. Synthesizes a team's
// RosterDirectionProfile + 30-day player trends into an
// urgency-ranked writeup for the Alerts Hub GM Briefing tab.
// ============================================================

import type { RosterDirectionProfile, FcTrendEntry, GmBriefing, GmUrgency } from "../types";

const SKILL_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);

const URGENCY_LABEL: Record<GmUrgency, string> = {
  critical: "Act This Week",
  high:     "Act Soon",
  medium:   "Worth Watching",
  low:      "Hold Pat",
};

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

function computeUrgency(
  profile: RosterDirectionProfile,
  fallingPlayers: { name: string; pos: string; delta: number }[]
): GmUrgency {
  const { bucket, oldCoreCount, firstRounders } = profile;

  let base: GmUrgency;
  switch (bucket) {
    case "Window Closing":
      base = (oldCoreCount >= 3 || firstRounders <= 0) ? "critical" : "high";
      break;
    case "Fading Contender":
      base = oldCoreCount >= 3 ? "critical" : "high";
      break;
    case "Purgatory":
    case "Stranded":
      base = "high";
      break;
    case "Fading Out":
    case "Hopeless":
    case "Almost There":
    case "Rebuilder":
      base = "medium";
      break;
    case "True Contender":
    case "Elite":
    default:
      base = "low";
  }

  // Boost urgency when major assets are falling fast
  const majorFalling = fallingPlayers.filter(p => p.delta <= -400).length;
  if (majorFalling >= 1 && base === "high")   return "critical";
  if (majorFalling >= 2 && base === "medium") return "high";

  return base;
}

function buildWriteup(
  profile: RosterDirectionProfile,
  label: string,  // "Your team" or owner name
  fallingPlayers: { name: string; pos: string; delta: number }[],
  risingPlayers:  { name: string; pos: string; delta: number }[]
): { headline: string; writeup: string; bullets: string[] } {
  const {
    bucket,
    actions,
    summary,
    coreAge,
    oldCoreCount,
    youngCoreCount,
    firstRounders,
    futureFirsts,
    dynRank,
    redRank,
    n,
    positionRanks,
  } = profile;

  const weakPos   = positionRanks ? [...positionRanks].sort((a, b) => b.rank - a.rank)[0]?.pos : "RB";
  const strongPos = positionRanks ? [...positionRanks].sort((a, b) => a.rank - b.rank)[0]?.pos : "WR";

  const pickStr = firstRounders > 0
    ? `${firstRounders} first-rounder${firstRounders !== 1 ? "s" : ""}`
    : "no first-rounders";

  const fallingNote = fallingPlayers.length > 0
    ? ` ${fallingPlayers[0].name} has dropped ${Math.abs(fallingPlayers[0].delta)} dynasty points this month — they should be on the block now before the market cools.`
    : "";

  const risingNote = risingPlayers.length > 0
    ? ` ${risingPlayers[0].name} is surging in value right now — worth holding unless the team needs a different direction.`
    : "";

  const bullets: string[] = actions?.slice(0, 3) ?? [];

  let headline: string;
  let writeup: string;

  switch (bucket) {
    case "Elite":
      headline = `${label} is in the driver's seat — don't overthink it.`;
      writeup = `The best build in the league right now, with both present production and long-term insulation. The only risk is making a panic move that disrupts something that's already working.${risingNote} Stay disciplined and only upgrade at ${weakPos} if the value is undeniable.`;
      break;

    case "True Contender":
      headline = `${label} is ready to compete — keep the pressure on.`;
      writeup = `Dynasty rank ${ordinal(dynRank)} of ${n}, redraft rank ${ordinal(redRank)} of ${n}. Everything is pointed in the right direction. The path forward: maintain the core, buy a reliable ${weakPos ?? "position upgrade"} if the price is right, and avoid burning picks for marginal gains.${risingNote}`;
      break;

    case "Almost There":
      headline = `${label} is one move away — make sure it's the right one.`;
      writeup = `Close enough to compete now, but a wrong move could collapse the window before it fully opens. The dynasty base is solid; what's missing is a real ${weakPos} upgrade to get over the top. ${futureFirsts > 0 ? `Keep at least one future first on the roster.` : `Draft capital is already thin, so be selective.`}${fallingNote}`;
      break;

    case "Rebuilder":
      headline = `${label} should be patient — the future looks bright if they hold.`;
      writeup = `Dynasty rank ${ordinal(dynRank)} of ${n} but redraft hasn't caught up yet. This team has the assets to rebuild the right way — rushing for short-term floor will only dilute what they're building. ${youngCoreCount > 0 ? `With ${youngCoreCount} young core piece${youngCoreCount !== 1 ? "s" : ""} already in place, patience pays off here.` : "Focus on acquiring youth and picks before buying redraft points."}${fallingNote}`;
      break;

    case "Fading Contender":
      headline = `${label} is watching their window narrow — time to decide.`;
      writeup = `Still competitive in the short term, but dynasty equity is eroding${coreAge ? ` (avg core age ${coreAge.toFixed(1)})` : ""}. The fork in the road is here: either push all-in now while the current production is real, or start converting aging pieces into future capital before the market loses interest. ${oldCoreCount >= 2 ? `With ${oldCoreCount} aging core pieces, the sell window is right now.` : ""}${fallingNote}`;
      break;

    case "Window Closing":
      headline = `${label}'s window is closing — act this week or miss it.`;
      writeup = `Good production now, but the dynasty foundation is thinning fast. With ${pickStr} on hand, this team needs to be extracting every ounce of value from current ${strongPos} strength before the floor drops out. Inaction this week isn't neutral — it's a loss.${fallingNote}`;
      break;

    case "Purgatory":
      headline = `${label} is stuck in the middle — a direction decision is overdue.`;
      writeup = `Middle of the pack in both dynasty and redraft — the worst place to be in dynasty football. Sideways trades won't fix this roster; what's needed is a direction-changing deal that either commits to a rebuild or buys enough points to actually compete. Pick one and press it.${fallingNote}`;
      break;

    case "Stranded":
      headline = `${label} needs to convert aging assets before it's too late.`;
      writeup = `Dynasty value is fading and redraft production isn't compensating. The smart play is moving any aging veterans at ${strongPos} for picks or young talent now — before those players' value drops further and the window to deal them closes entirely. Every week of waiting narrows the options.${fallingNote}`;
      break;

    case "Fading Out":
      headline = `${label} needs a deliberate reset — the sooner the better.`;
      writeup = `Low dynasty value and low redraft production is the combination that's hardest to escape passively. The only path forward is a focused rebuild: accumulate first-rounders, acquire young skill players, and shed any veterans with remaining trade value before it evaporates.${fallingNote}`;
      break;

    case "Hopeless":
      headline = `${label} should embrace the rebuild fully — no half measures.`;
      writeup = `The most difficult roster situation in dynasty: low dynasty value, low redraft production, and likely insufficient picks to close the gap quickly. Every move from here should maximize future flexibility — take the first-rounders, collect the young WRs, and accept being bad this year to be competitive in two.${fallingNote}`;
      break;

    default:
      headline = `${label} has mixed signals — stay flexible this week.`;
      writeup = summary ?? "This roster has a complex mix of assets. Prioritize moves that improve either redraft floor or dynasty ceiling, and avoid lateral swaps that don't change the roster's shape.";
  }

  return { headline, writeup, bullets };
}

export function generateGmBriefing({
  rosterId,
  leagueName,
  ownerName,
  isMyTeam,
  profile,
  rosterPlayerIds,
  trendData,
}: {
  rosterId: number;
  leagueName: string;
  ownerName: string;
  isMyTeam: boolean;
  profile: RosterDirectionProfile;
  rosterPlayerIds: string[];
  trendData: FcTrendEntry[];
}): GmBriefing {
  const trendByPlayerId = new Map<string, FcTrendEntry>(
    trendData.map((t) => [t.sleeperId, t])
  );

  const rosterTrends = rosterPlayerIds
    .map((id) => trendByPlayerId.get(id))
    .filter((t): t is FcTrendEntry => t != null && SKILL_POSITIONS.has(t.position))
    .sort((a, b) => a.trend30Day - b.trend30Day);

  const fallingPlayers = rosterTrends
    .filter((t) => t.trend30Day <= -200)
    .slice(0, 3)
    .map((t) => ({ name: t.name, pos: t.position, delta: t.trend30Day }));

  const risingPlayers = rosterTrends
    .filter((t) => t.trend30Day >= 250)
    .sort((a, b) => b.trend30Day - a.trend30Day)
    .slice(0, 2)
    .map((t) => ({ name: t.name, pos: t.position, delta: t.trend30Day }));

  const urgency = computeUrgency(profile, fallingPlayers);

  const displayLabel = isMyTeam ? "Your team" : ownerName;
  const { headline, writeup, bullets } = buildWriteup(profile, displayLabel, fallingPlayers, risingPlayers);

  return {
    rosterId,
    leagueName,
    ownerName,
    isMyTeam,
    urgency,
    urgencyLabel: URGENCY_LABEL[urgency],
    bucket: profile.bucket,
    bucketColor: profile.bucketColor,
    headline,
    writeup,
    bullets,
    fallingPlayers,
    risingPlayers,
  };
}
