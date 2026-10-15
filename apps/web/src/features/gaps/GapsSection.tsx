import { useEffect, useMemo, useRef, useState } from "react";
import { useGaps } from "../../lib/api";
import { useScene } from "../scene/sceneStore";
import {
  attributeNames,
  GAP_HELP,
  type GapItem,
  type GapRow,
  gapRows,
  gapSummaryLine,
  gapsApplicable,
  parseGaps,
} from "./gapModel";

const btn =
  "min-h-11 w-full rounded-lg border border-line bg-card px-4 py-3 text-left hover:bg-brand-tint focus-visible:outline-2 focus-visible:outline-brand";

/** The path equivalent of the place card: what is not yet checked on one path. */
export function GapEdgeCard({ row, onClose }: { row: GapRow; onClose: () => void }) {
  const head = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    head.current?.focus();
    return () => {
      if (opener && document.contains(opener)) opener.focus();
    };
  }, []);
  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="gap-edge-h"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
      className="fixed bottom-4 left-4 right-4 z-30 max-h-[70vh] overflow-y-auto rounded-lg border border-line bg-card p-4 shadow-lg sm:left-auto sm:w-96"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 id="gap-edge-h" ref={head} tabIndex={-1} className="text-lg font-semibold">
          What is not yet checked on this path
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="min-h-11 rounded-md border border-line px-3 text-sm"
        >
          Close
        </button>
      </div>
      <p className="mt-1 text-sm text-ink-soft">{row.label}</p>
      <p className="mt-3 text-sm">{row.detail}.</p>
      {row.attributes.length > 0 && (
        <p className="mt-2 text-sm">
          <span className="font-medium">Facts not yet checked: </span>
          {attributeNames(row.attributes)}
        </p>
      )}
      <p className="mt-3 text-xs text-ink-soft">
        This is a gap in our records, not a finding about the path itself. Staff can check it from
        the verification queue.
      </p>
    </div>
  );
}

/** "Biggest gaps": most-asked-about first, then most journeys a check would confirm, then most
 * facts missing. Streets and unnamed paths are collapsed into rows. Pure. */
export function GapsSection({
  items,
  profile,
  onSelectPlace,
  onLocate,
}: {
  items: GapItem[];
  profile: string;
  onSelectPlace: (id: string) => void;
  onLocate?: (row: GapRow) => void;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const rows = useMemo(() => gapRows(items), [items]);
  const summary = useMemo(() => gapSummaryLine(items, profile), [items, profile]);
  const open = rows.find((r) => r.key === openKey && r.kind !== "place") ?? null;
  return (
    <section aria-labelledby="gaps-h">
      <h2 id="gaps-h" className="text-xl font-semibold">
        Biggest gaps
      </h2>
      {summary && (
        <p className="mt-1 text-sm font-medium" data-testid="gap-summary">
          {summary}
        </p>
      )}
      <p className="mt-1 text-sm text-ink-soft">{GAP_HELP}</p>
      {rows.length === 0 ? (
        <p className="mt-2 text-ink-soft">No gaps to show for this profile in the loaded data.</p>
      ) : (
        <ol className="mt-3 grid gap-2 sm:grid-cols-2">
          {rows.map((r) => (
            <li key={r.key}>
              <button
                type="button"
                aria-haspopup="dialog"
                onClick={() => {
                  if (r.kind === "place") return onSelectPlace(r.firstId);
                  setOpenKey(r.key);
                  onLocate?.(r);
                }}
                className={btn}
              >
                <span className="block font-medium">{r.label}</span>
                <span className="block text-sm text-ink-soft">{r.detail}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
      {open && <GapEdgeCard key={open.key} row={open} onClose={() => setOpenKey(null)} />}
    </section>
  );
}

/** Mounted only while the Gaps toggle is on, so the layer is not fetched otherwise. */
export function GapsLensSection() {
  const profile = useScene((s) => s.profile);
  const selectPlace = useScene((s) => s.selectPlace);
  const applyIntent = useScene((s) => s.applyIntent);
  const q = useGaps(profile, gapsApplicable(profile));
  const items = useMemo(() => parseGaps(q.data), [q.data]);
  if (!gapsApplicable(profile)) return null; // GapProfileNote explains why
  if (q.isPending)
    return (
      <p role="status" className="text-ink-soft">
        Loading gaps…
      </p>
    );
  if (q.isError)
    return (
      <p role="alert" className="text-sm">
        The gap map is unavailable.{" "}
        <button type="button" className="underline" onClick={() => q.refetch()}>
          Retry
        </button>
      </p>
    );
  return (
    <GapsSection
      items={items}
      profile={profile}
      onSelectPlace={selectPlace}
      onLocate={(r) => {
        if (r.at) applyIntent({ kind: "camera.fly_to", center: r.at, range_m: 400 });
      }}
    />
  );
}
