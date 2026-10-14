import Badge from "./Badge";

/** League Overview's Playoff% colors: 50%+ green, 25%+ amber, below that red. */
export const playoffOddsTone = (odds: number) => (odds >= 50 ? "good" : odds >= 25 ? "warning" : "critical");

/** "62% playoff" — the user's odds from the last League Overview sim (getPlayoffOdds). Null means
 *  the league has never been simulated: a muted "No sim" pill rather than a misleading 0%. */
export default function PlayoffOddsBadge({ odds, className = "" }: { odds: number | null; className?: string }) {
  if (odds == null) {
    return (
      <span title="No playoff odds yet — Run All Sims on League Overview">
        <Badge tone="neutral" className={`text-slate-500 ${className}`}>No sim</Badge>
      </span>
    );
  }
  return (
    <span title="Playoff odds from your last League Overview sim">
      <Badge tone={playoffOddsTone(odds)} className={`font-mono ${className}`}>{odds}% playoff</Badge>
    </span>
  );
}
