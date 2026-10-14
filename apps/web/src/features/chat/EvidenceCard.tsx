import { EvidencePhoto } from "../../lib/EvidencePhoto";
import { DEMO_LABEL, isPlaceholderSource } from "../../lib/evidence";
import { optionLabel } from "../manage/attributeCatalogue";
import type { Citation } from "./chatReducer";

const STATUS_ICON: Record<string, string> = {
  verified: "✓",
  reported: "i",
  stale: "⏱",
  contested: "!",
  unknown: "?",
};

function AttributeLine({ c, title }: { c: Citation; title: string }) {
  const placeholder = isPlaceholderSource(c.source_type);
  return (
    <li className="mt-1">
      <p className="font-medium">
        <span className="mr-1 text-ink-soft">[{c.ref}]</span>
        {optionLabel(c.attribute)}
      </p>
      <p className="flex flex-wrap items-center gap-2">
        {placeholder ? (
          <span className="rounded border border-[#B7791F] bg-warn-tint px-1.5 py-0.5">
            {DEMO_LABEL}
          </span>
        ) : (
          <>
            <span className="rounded border border-line px-1.5 py-0.5">
              <span aria-hidden="true">{STATUS_ICON[c.status] ?? "?"} </span>
              {c.status}
            </span>
            {c.source_type && <span className="text-ink-soft">{c.source_type}</span>}
            {c.verified_at && (
              <span className="text-ink-soft">checked {c.verified_at.slice(0, 10)}</span>
            )}
          </>
        )}
      </p>
      <EvidencePhoto
        photoUrl={c.photo_url}
        element={title}
        attribute={c.attribute}
        source={placeholder ? null : c.source_type}
        checked={placeholder ? null : c.verified_at?.slice(0, 10)}
      />
    </li>
  );
}

export function EvidenceCard({
  element_id,
  title,
  citations,
}: {
  element_id: string;
  title: string;
  citations: Citation[];
}) {
  return (
    <li className="evidence-card rounded-md border border-line bg-card px-3 py-2 text-sm">
      <p className="font-semibold" title={element_id}>
        {title}
      </p>
      <ul>
        {citations.map((c) => (
          <AttributeLine key={`${c.ref}-${c.evidence_id}`} c={c} title={title} />
        ))}
      </ul>
    </li>
  );
}
