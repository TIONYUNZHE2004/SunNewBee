import { useFloodImpact } from "../../lib/api";
import { useScene } from "../scene/sceneStore";
import {
  FLASH_FLOOD_NOTE,
  IMPACT_STYLE,
  type ImpactKind,
  type ImpactMarker,
  INDICATIVE_NOTE,
  impactSummary,
  listRows,
  placesWord,
  possibleOnly,
} from "./impactModel";
import { WatchRiverButton } from "./WatchRiverButton";

/** The round "!" / "⚠" badge every flood-impact surface uses (map card, List view, 3D label). */
export function ImpactGlyph({ kind }: { kind: ImpactKind }) {
  const s = IMPACT_STYLE[kind];
  return (
    <span
      aria-hidden="true"
      className="grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white ring-2 ring-white"
      style={{ background: s.color }}
    >
      {s.glyph}
    </span>
  );
}

/**
 * T-024 summary under the flood note: places likely flooded, places cut off and the length of
 * likely flooded paths, with the two notes every river answer carries. Every number is the
 * API's; the labels are the API's markers' ("indicative"), never "safe", never a depth.
 */
export function FloodImpactCard({ notes = true }: { notes?: boolean }) {
  const scenarioId = useScene((s) => s.scenarioId);
  const q = useFloodImpact(scenarioId);
  const s = impactSummary(q.data);
  if (!scenarioId || scenarioId === "baseline" || !s) return null;
  return (
    <section
      aria-label="Flood impact"
      data-testid="flood-impact"
      className="mt-2 space-y-1.5 border-t border-edge pt-2 text-xs text-fg"
    >
      <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1">
        {possibleOnly(s) ? (
          <span>
            <strong>{placesWord(s.possiblePlaces)}</strong> and{" "}
            <strong>
              {s.possiblePaths} mapped {s.possiblePaths === 1 ? "path" : "paths"}
            </strong>{" "}
            in low-lying areas (possible)
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <ImpactGlyph kind="flooded" />
            <span>
              <strong>{placesWord(s.flooded)}</strong> {IMPACT_STYLE.flooded.label.toLowerCase()}
            </span>
          </span>
        )}
        <span className="inline-flex items-center gap-1.5">
          <ImpactGlyph kind="cut_off" />
          <span>
            <strong>{placesWord(s.cutOff)}</strong> cut off: no mapped way in or out
          </span>
        </span>
        {!possibleOnly(s) && (
          <span>
            <strong>{s.pathLength}</strong> of mapped paths likely flooded
          </span>
        )}
      </p>
      <WatchRiverButton />
      {notes && (
        <p className="m-0 text-fg-soft">
          {INDICATIVE_NOTE} {FLASH_FLOOD_NOTE}
        </p>
      )}
    </section>
  );
}

function MarkerRows({ title, rows }: { title: string; rows: ImpactMarker[] }) {
  if (rows.length === 0) return null;
  const { places, small } = listRows(rows);
  return (
    <div className="mt-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">{title}</h3>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2">
        {places.map((m) => (
          <li
            key={`${m.kind}:${m.id}`}
            className="flex items-center gap-2 rounded-lg border border-line bg-card px-3 py-2 text-sm"
          >
            <ImpactGlyph kind={m.kind} />
            <span>{m.name}</span>
            <span className="sr-only">: {IMPACT_STYLE[m.kind].label}</span>
          </li>
        ))}
        {small > 0 && (
          <li
            data-testid="impact-small-features"
            className="flex items-center gap-2 rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink-soft"
          >
            + {small} small mapped {small === 1 ? "feature" : "features"} (shelters, seats, bins,
            toilets)
          </li>
        )}
      </ul>
    </div>
  );
}

/** The List view's flood impact: the same counts and every marked place, as text. */
export function FloodImpactList({ scenarioId }: { scenarioId: string }) {
  const q = useFloodImpact(scenarioId);
  const s = impactSummary(q.data);
  if (!s) return null;
  const flooded = s.markers.filter((m) => m.kind === "flooded");
  const cut = s.markers.filter((m) => m.kind === "cut_off");
  return (
    <div data-testid="flood-impact-list" className="mt-3">
      <p className="text-sm">
        {possibleOnly(s)
          ? `${placesWord(s.possiblePlaces)} and ${s.possiblePaths} mapped paths in low-lying areas (possible) · ${placesWord(s.cutOff)} cut off.`
          : `${placesWord(s.flooded)} likely flooded · ${placesWord(s.cutOff)} cut off · ${s.pathLength} of mapped paths likely flooded. ${FLASH_FLOOD_NOTE}`}
      </p>
      <MarkerRows title={IMPACT_STYLE.flooded.label} rows={flooded} />
      <MarkerRows title={IMPACT_STYLE.cut_off.label} rows={cut} />
    </div>
  );
}
