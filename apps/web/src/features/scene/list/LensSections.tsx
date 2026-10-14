import { useMemo } from "react";
import { useLayer } from "../../../lib/api";
import { useScene } from "../sceneStore";
import { type CentreItem, parseCentres, parseWaste, type WasteItem } from "./listModel";

const btn =
  "min-h-11 w-full rounded-lg border border-line bg-card px-4 py-3 text-left hover:bg-brand-tint focus-visible:outline-2 focus-visible:outline-brand";

export function EvacuationSection({
  items,
  onSelect,
}: {
  items: CentreItem[];
  onSelect: (id: string) => void;
}) {
  return (
    <section aria-labelledby="evac-h">
      <h2 id="evac-h" className="text-xl font-semibold">
        Evacuation centres
      </h2>
      {items.length === 0 ? (
        <p className="mt-2 text-ink-soft">No evacuation centres to show yet.</p>
      ) : (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {items.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                aria-haspopup="dialog"
                onClick={() => onSelect(c.id)}
                className={btn}
              >
                <span className="block font-medium">{c.name}</span>
                <span className="block text-sm text-ink-soft">{c.sourceLabel}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function WasteSection({
  items,
  onSelect,
}: {
  items: WasteItem[];
  onSelect: (id: string) => void;
}) {
  return (
    <section aria-labelledby="waste-h">
      <h2 id="waste-h" className="text-xl font-semibold">
        Waste points
      </h2>
      {items.length === 0 ? (
        <p className="mt-2 text-ink-soft">No waste points to show yet.</p>
      ) : (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {items.map((w) => (
            <li key={w.id}>
              <button
                type="button"
                aria-haspopup="dialog"
                onClick={() => onSelect(w.id)}
                className={btn}
              >
                <span className="block font-medium">{w.name}</span>
                <span className="block text-sm text-ink-soft">
                  {w.typeLabel}. {w.statusLabel}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Mounted only while the flood lens is on, so the layer is not fetched otherwise. */
export function EvacuationLensSection() {
  const profile = useScene((s) => s.profile);
  const scenarioId = useScene((s) => s.scenarioId);
  const selectPlace = useScene((s) => s.selectPlace);
  const q = useLayer("flood", profile, scenarioId);
  const items = useMemo(() => parseCentres(q.data), [q.data]);
  return <EvacuationSection items={items} onSelect={selectPlace} />;
}

export function WasteLensSection() {
  const profile = useScene((s) => s.profile);
  const scenarioId = useScene((s) => s.scenarioId);
  const selectPlace = useScene((s) => s.selectPlace);
  const q = useLayer("waste", profile, scenarioId);
  const items = useMemo(() => parseWaste(q.data), [q.data]);
  return <WasteSection items={items} onSelect={selectPlace} />;
}

/** Each section mounts only with its lens, so a hidden lens fetches nothing. */
export function ListLensSections({ flood, waste }: { flood: boolean; waste: boolean }) {
  return (
    <>
      {flood && <EvacuationLensSection />}
      {waste && <WasteLensSection />}
    </>
  );
}
