"use client";
import { isTaggedPlay, type PlayTagSpec, type TagPosition } from "../../../lib/scouting/playEra";
import { tagBadges, tagForced, tagOptions, visibleTags, type PlayFacts } from "../../../lib/scouting/playTags";
import type { PlayTags } from "./hooks/usePlayTags";

const ACTIVE = { blue: "bg-blue-600 text-white", green: "bg-green-700 text-white" } as const;
const IDLE = "bg-slate-800 text-slate-400 hover:bg-slate-700";

interface Props {
  tags: PlayTags;
  facts: PlayFacts;
  /** "situation" = the four situation tags (top of the logger); "play" = the position's tags that apply. */
  part: "situation" | "play";
  accent: "blue" | "green";
}

/**
 * The per-play tag buttons (tape-grading expansion, Stage 3). Toggles for
 * on/off tags; a row of choices for a tag with values, already set when it
 * has a preset and outlined in amber while a required one is unpicked. Only
 * tags that apply to the play show. While editing a play charted before the
 * tags, nothing shows (its tags are never written).
 */
export default function PlayTagControls({ tags, facts, part, accent }: Props) {
  if (tags.editingUntagged) {
    return part === "situation" ? (
      <div className="px-3 py-1.5 rounded bg-slate-900 border border-slate-800 text-xs text-slate-500">
        Charted before per-play tags. Saving this edit leaves its tags blank.
      </div>
    ) : null;
  }
  const specs = visibleTags(tags.position, facts, part);
  if (specs.length === 0) return null;
  const toggles = specs.filter((s) => !s.values && !s.required);
  const pickers = specs.filter((s) => s.values || s.required);
  const sticky = specs.filter((s) => s.entry === "sticky").map((s) => s.label);

  return (
    <div className="space-y-2">
      <div className="text-xs text-slate-500">
        {part === "situation" ? "Situation" : "Tags"}
        {sticky.length > 0 && <span className="text-slate-600"> · {sticky.join(" and ")} stay on for the next play</span>}
      </div>
      {toggles.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {toggles.map((spec) => {
            // A forced tag (play action on an RPO) shows on and can't be turned off.
            const forced = tagForced(spec, facts);
            const on = forced || tags.values[spec.column] === true;
            return (
              <button key={spec.column} type="button" aria-pressed={on} disabled={forced}
                onClick={() => tags.set(spec.column, !on)}
                title={forced ? `${spec.label}: ${spec.forced?.note}`
                  : spec.entry === "sticky" ? `${spec.label}: stays on for the next play until you turn it off` : spec.label}
                className={`flex-1 whitespace-nowrap px-3 py-1.5 rounded text-xs font-medium transition ${on ? ACTIVE[accent] : IDLE} ${forced ? "cursor-default" : ""}`}>
                {spec.label}
              </button>
            );
          })}
        </div>
      )}
      {pickers.map((spec) => (
        <TagPicker key={spec.column} spec={spec} tags={tags} accent={accent} />
      ))}
    </div>
  );
}

function TagPicker({ spec, tags, accent }: { spec: PlayTagSpec; tags: PlayTags; accent: "blue" | "green" }) {
  const value = tags.values[spec.column] ?? null;
  const unpicked = spec.required && value == null;
  return (
    <div role="group" aria-label={spec.label} className="flex flex-wrap items-center gap-1.5">
      <span className={`text-xs mr-1 ${unpicked ? "text-amber-400" : "text-slate-500"}`}>{spec.label}</span>
      {tagOptions(spec).map((opt) => {
        const on = value === opt.value;
        return (
          <button key={String(opt.value)} type="button" aria-pressed={on}
            onClick={() => tags.set(spec.column, opt.value)}
            className={`flex-1 whitespace-nowrap px-3 py-1.5 rounded text-xs font-medium transition ${on ? ACTIVE[accent] : IDLE} ${unpicked ? "ring-1 ring-amber-500/70" : ""}`}>
            {opt.label}
          </button>
        );
      })}
      {unpicked && <span className="text-[10px] text-amber-400">pick one to log</span>}
    </div>
  );
}

/**
 * Play-list marks for a tagged play: a dot, then its notable tags. Nothing for
 * an untagged play. One shrinkable box, so on a phone the badges clip instead
 * of pushing the row's edit / delete buttons out of view.
 */
export function PlayTagBadges({ play, position }: { play: object; position: TagPosition }) {
  if (!isTaggedPlay(play, position)) return null;
  return (
    <span className="flex items-center gap-2 min-w-0 overflow-hidden whitespace-nowrap">
      <span className="text-sky-500" title="Charted with per-play tags" aria-label="Tagged play">•</span>
      {tagBadges(play, position).map((b) => (
        <span key={b.column} className="text-sky-300" title={b.title}>{b.text}</span>
      ))}
    </span>
  );
}
