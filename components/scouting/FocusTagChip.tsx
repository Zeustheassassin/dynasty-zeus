import { focusTagDef } from "../../lib/scouting/focusTag";

/** Small pill for a prospect's Focus Tag (migration 084). Renders nothing when untagged. */
export default function FocusTagChip({ tag, className = "" }: { tag: string | null | undefined; className?: string }) {
  const def = focusTagDef(tag);
  if (!def) return null;
  return (
    <span
      className={`flex-shrink-0 items-center rounded border px-1.5 py-px text-[10px] font-medium leading-4 whitespace-nowrap ${def.classes} ${className}`}
      title={`Focus Tag: ${def.label}`}
    >
      {def.chip}
    </span>
  );
}
