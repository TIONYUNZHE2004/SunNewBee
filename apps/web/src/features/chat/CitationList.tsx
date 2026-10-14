import { useState } from "react";
import type { Citation } from "./chatReducer";
import { elementName, groupByElement } from "./citationLabel";
import { EvidenceCard } from "./EvidenceCard";

const VISIBLE = 4;

export function CitationList({
  citations,
  names,
  defaultExpanded = false,
}: {
  citations: Citation[];
  names: Map<string, string>;
  defaultExpanded?: boolean;
}) {
  const [open, setOpen] = useState(defaultExpanded);
  const groups = groupByElement(citations);
  const shown = open ? groups : groups.slice(0, VISIBLE);
  const hidden = groups.length - VISIBLE;
  return (
    <div className="space-y-1.5">
      <ul className="space-y-1.5" aria-label="Evidence">
        {shown.map((g) => (
          <EvidenceCard
            key={g.element_id}
            element_id={g.element_id}
            title={elementName(g.element_id, names)}
            citations={g.citations}
          />
        ))}
      </ul>
      {hidden > 0 && (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="min-h-11 rounded-lg border border-line px-3 text-sm font-medium text-brand hover:bg-brand-tint"
        >
          {open ? "Show fewer sources" : `Show ${hidden} more sources`}
        </button>
      )}
    </div>
  );
}
