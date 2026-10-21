import { ImpactGlyph } from "../flood/FloodImpact";
import {
  basisWords,
  type ClosureImpact,
  DETOUR_ROWS,
  PRESSURE_STYLE,
  resultLines,
  uniqueSuggestions,
} from "./closureSimModel";

/** Manager-only result card: every number is the engine's; pressure bands as returned. */
export function ClosureResult({ r }: { r: ClosureImpact }) {
  const l = resultLines(r);
  const more = r.detour_roads.length - DETOUR_ROWS;
  const suggestions = uniqueSuggestions(r);
  return (
    <section
      aria-label="Closure result"
      data-testid="closure-result"
      className="space-y-3 rounded-2xl border border-edge bg-raised p-3 text-sm text-fg"
    >
      <ul className="space-y-1">
        <li>
          <strong>{l.affected}</strong>
        </li>
        <li>{l.newly}</li>
        {l.extra && <li className="text-fg-soft">{l.extra}</li>}
        {l.gaps && <li className="text-fg-soft">{l.gaps}</li>}
      </ul>
      {r.detour_roads.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-soft">
            Detour roads
          </h3>
          <ul className="mt-1 space-y-1">
            {r.detour_roads.slice(0, DETOUR_ROWS).map((d, i) => {
              const p = PRESSURE_STYLE[d.pressure];
              return (
                // the engine's order is the key: a name is not guaranteed unique
                // biome-ignore lint/suspicious/noArrayIndexKey: rows are the engine's, never reordered
                <li key={i} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {d.name} · {d.trips} sample {d.trips === 1 ? "trip" : "trips"}
                  </span>
                  <span className={`chip chip-solid chip-${p.tone}`}>
                    <span
                      aria-hidden="true"
                      className="size-2.5 rounded-full"
                      style={{ background: p.color }}
                    />
                    {p.label}
                  </span>
                </li>
              );
            })}
          </ul>
          {more > 0 && (
            <p className="mt-1 text-xs text-fg-soft">
              and {more} more detour {more === 1 ? "stretch" : "stretches"}, drawn on the map
            </p>
          )}
        </div>
      )}
      {r.places_cut_off.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-soft">
            Cut off during the closure
          </h3>
          <ul className="mt-1 space-y-1">
            {r.places_cut_off.map((p) => (
              <li key={p.id} className="flex items-center gap-2">
                <ImpactGlyph kind="cut_off" />
                {p.name}
              </li>
            ))}
          </ul>
        </div>
      )}
      {suggestions.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-soft">
            Keep traffic moving
          </h3>
          <ul className="mt-1 space-y-1.5">
            {suggestions.map((s) => (
              <li key={s.text}>
                {s.text}
                <span className="block text-xs text-fg-soft">Based on: {basisWords(s.basis)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p role="note" className="rounded border border-dashed border-lilac p-2 text-xs">
        {r.disclaimer}
        {r.weights_note && <span className="block text-fg-soft">{r.weights_note}</span>}
      </p>
    </section>
  );
}
