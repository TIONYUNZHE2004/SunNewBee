import { useState } from "react";
import { isPlaceholderSource } from "../../lib/evidence";
import { Icon } from "../../ui/icons";
import type { Citation } from "./chatReducer";
import { elementName, groupByElement } from "./citationLabel";
import { EvidenceCard } from "./EvidenceCard";

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
  const n = groups.length;
  // Sources (groups) resting on demo data, so the count shares a unit with "N sources".
  const demo = groups.filter((g) =>
    g.citations.some((c) => isPlaceholderSource(c.source_type)),
  ).length;
  return (
    <div className="space-y-1.5" data-collapsible="">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-edge bg-raised px-3 py-2 text-left text-sm font-medium text-fg transition-colors hover:bg-fg/5"
      >
        <span className="min-w-0 flex-1">
          <span>
            Evidence · {n} {n === 1 ? "source" : "sources"}
            {demo > 0
              ? ` · ${demo} with ${demo === 1 ? "a demo value" : "demo values"} (not surveyed)`
              : ""}
          </span>
          {n > 0 && (
            // Split bar: sources resting on demo values (dashed) vs the rest. Decorative; the
            // words above carry the numbers.
            <span
              aria-hidden="true"
              className="mt-1.5 flex h-1 overflow-hidden rounded-full bg-edge"
            >
              <span className="bg-fg/60" style={{ width: `${(100 * (n - demo)) / n}%` }} />
              <span
                className="bg-[repeating-linear-gradient(90deg,var(--c-peach)_0_3px,transparent_3px_5px)]"
                style={{ width: `${(100 * demo) / n}%` }}
              />
            </span>
          )}
        </span>
        <Icon name="chevron" className={`size-4 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <ul className="space-y-1.5" aria-label="Evidence">
          {groups.map((g) => (
            <EvidenceCard
              key={g.element_id}
              element_id={g.element_id}
              title={elementName(g.element_id, names)}
              citations={g.citations}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
