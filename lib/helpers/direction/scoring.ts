import type { RosterDirectionProfile, StrategicBucket } from "../../types";

/** Composite window score: positive = window open/widening, negative = closing.
 *  Combines core age relative to dynasty prime, young builders, and aging vets. */
export const computeWindowScore = (profile: Pick<RosterDirectionProfile, "coreAge" | "youngCoreCount" | "oldCoreCount"> | null | undefined): number => {
  const coreAge        = Number(profile?.coreAge        || 0);
  const youngCoreCount = Number(profile?.youngCoreCount || 0);
  const oldCoreCount   = Number(profile?.oldCoreCount   || 0);
  let score = 0;
  if (coreAge > 0) {
    score -= Math.max(0, coreAge - 26) * 0.55;
    score += Math.max(0, 26 - coreAge) * 0.25;
  }
  score += youngCoreCount * 0.85;
  score -= oldCoreCount   * 1.05;
  return score; // typically -5 to +5
};

export interface OppAcceptanceClass {
  isHopeless: boolean;
  isRebuild: boolean;
  isElite: boolean;
  isContender: boolean;
  isFading: boolean;
  isSeller: boolean;   // hopeless || rebuild — wants picks/youth, sheds production
  isBuyer: boolean;    // elite || contender — wants win-now production, not picks
}

/** Canonical buyer/seller + window classification for a trade partner.
 *  SINGLE source of truth used by the trade-finder acceptance gate, oppDirectionScore,
 *  cross-league intel, oppDirOk, and the leaguemate rankings — so the same opponent is
 *  never classified three different ways. Callers pass the adjusted bucket and the
 *  partner's playoff odds (missing sim → pass 50, neutral). Thresholds: <30 hopeless,
 *  <50 rebuild, ≥78 elite, ≥65 contender, ≥50 fading. */
export const classifyOppDirection = (
  adjustedBucket: string,
  playoffOdds: number,
): OppAcceptanceClass => {
  const isHopeless   = playoffOdds < 30 || ["Stranded", "Fading Out", "Hopeless"].includes(adjustedBucket);
  const isRebuild    = !isHopeless && (playoffOdds < 50 || adjustedBucket === "Rebuilder");
  const isElite      = playoffOdds >= 78 || ["Elite", "True Contender"].includes(adjustedBucket);
  const isContender  = !isElite && (playoffOdds >= 65 || adjustedBucket === "Almost There");
  const isFading     = !isHopeless && !isRebuild && !isElite && !isContender
                       && (playoffOdds >= 50 || adjustedBucket === "Fading Contender");
  return {
    isHopeless, isRebuild, isElite, isContender, isFading,
    // Mutually exclusive in cascade priority (matches oppDirectionScore's if/else-if order):
    // a hopeless/rebuild team is a SELLER even if a high sim seed also trips isElite, so the
    // same opponent can never be both a seller and a buyer.
    isSeller: isHopeless || isRebuild,
    isBuyer: !isHopeless && !isRebuild && (isElite || isContender),
  };
};

/** Three-factor adjusted bucket: raw rank bucket + window score (age/youth)
 *  + playoff simulation pressure. Single source of truth for strategic label. */
export const getAdjustedDirectionBucket = (
  rawBucket: string,
  profile: Pick<RosterDirectionProfile, "coreAge" | "youngCoreCount" | "oldCoreCount"> | null | undefined,
  playoffOdds: number,
  hasSimData = false
): StrategicBucket => {
  if (!rawBucket) return "Fading Out";

  const windowScore     = computeWindowScore(profile);
  const playoffPressure = hasSimData ? (playoffOdds - 50) / 12.5 : 0;
  const composite       = windowScore + playoffPressure;
  const youngCoreCount  = Number(profile?.youngCoreCount || 0);

  let result: StrategicBucket;
  switch (rawBucket) {
    case "Elite":
      if (composite < -4)       result = "Fading Contender";
      else if (composite < -2)  result = "True Contender";
      else                      result = "Elite";
      break;

    case "True Contender":
      if (composite > 2.5)       result = "Elite";
      else if (composite < -3.5) result = "Stranded";
      else if (composite < -1.5) result = "Fading Contender";
      else                       result = "True Contender";
      break;

    case "Almost There":
      if (composite > 2.5)       result = "True Contender";
      else if (composite < -3.5) result = "Stranded";
      else if (composite < -1.5) result = "Rebuilder";
      else                       result = "Almost There";
      break;

    case "Fading Contender":
      if (composite > 2.5 && youngCoreCount >= 2) result = "True Contender";
      else if (composite > 1.5)  result = "Almost There";
      else if (composite < -2.5) result = "Window Closing";
      else                       result = "Fading Contender";
      break;

    case "Purgatory":
      if (composite > 3)         result = "Almost There";
      else if (composite < -2.5) result = "Stranded";
      else                       result = "Purgatory";
      break;

    case "Rebuilder":
      if (composite > 3.5 && youngCoreCount >= 2) result = "Almost There";
      else if (composite < -3.5) result = "Hopeless";
      else                       result = "Rebuilder";
      break;

    case "Stranded":
      if (composite > 3.5 && youngCoreCount >= 3) result = "Rebuilder";
      else if (composite < -3)   result = "Hopeless";
      else                       result = "Stranded";
      break;

    case "Window Closing":
      if (composite > 2 && youngCoreCount >= 2) result = "Fading Contender";
      else if (composite < -3)   result = "Hopeless";
      else                       result = "Window Closing";
      break;

    case "Fading Out":
      if (composite > 3 && youngCoreCount >= 2) result = "Stranded";
      else if (composite < -2)   result = "Hopeless";
      else                       result = "Fading Out";
      break;

    case "Hopeless":
      if (composite > 4 && youngCoreCount >= 4) result = "Stranded";
      else                                      result = "Hopeless";
      break;

    default:
      result = (rawBucket as StrategicBucket) || "Fading Out";
  }

  // Hard playoff-odds floors — sim data overrides gradient when not a contender.
  if (hasSimData) {
    const above = (...buckets: string[]) => buckets.includes(result);
    if (playoffOdds === 0) {
      if (above("Elite", "True Contender", "Almost There")) result = "Rebuilder";
      if (result === "Fading Contender") result = "Purgatory";
    } else if (playoffOdds < 15) {
      if (above("Elite", "True Contender", "Almost There")) result = "Rebuilder";
      if (result === "Fading Contender") result = "Purgatory";
    } else if (playoffOdds < 50) {
      if (above("Elite", "True Contender")) result = "Almost There";
    }
  }

  return result;
};
