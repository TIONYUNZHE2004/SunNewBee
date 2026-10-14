import type { Citation } from "./chatReducer";

const STATUS_ICON: Record<string, string> = {
  verified: "✓",
  reported: "i",
  stale: "⏱",
  contested: "!",
  unknown: "?",
};

export function EvidenceCard({ c }: { c: Citation }) {
  const placeholder = c.source_type === "team_survey_placeholder";
  return (
    <li className="rounded-md border border-line bg-card px-3 py-2 text-sm">
      <p className="font-medium">
        <span className="mr-1 text-ink-soft">[{c.ref}]</span>
        {c.element_id} · {c.attribute}
      </p>
      <p className="mt-1 flex flex-wrap items-center gap-2">
        <span className="rounded border border-line px-1.5 py-0.5">
          <span aria-hidden="true">{STATUS_ICON[c.status] ?? "?"} </span>
          {c.status}
        </span>
        {placeholder && (
          <span className="rounded border border-[#B7791F] bg-warn-tint px-1.5 py-0.5">
            placeholder
          </span>
        )}
        {c.source_type && !placeholder && <span className="text-ink-soft">{c.source_type}</span>}
        {c.verified_at && (
          <span className="text-ink-soft">checked {c.verified_at.slice(0, 10)}</span>
        )}
      </p>
    </li>
  );
}
