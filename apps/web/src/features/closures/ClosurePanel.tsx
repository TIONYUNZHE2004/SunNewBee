import { useState } from "react";
import { useLayer } from "../../lib/api";
import { Button } from "../../ui/Button";
import { LaunchRow } from "../../ui/LaunchRow";
import { ImpactGlyph } from "../flood/FloodImpact";
import { parseLayer } from "../scene/list/listModel";
import { useScene } from "../scene/sceneStore";
import {
  basisWords,
  buildSimRequest,
  CLOSURE_REASONS,
  type ClosureImpact,
  type ClosureReason,
  type ClosureRow,
  closureFeatures,
  DETOUR_ROWS,
  PRESSURE_STYLE,
  resultLines,
  simulateClosures,
  uniqueSuggestions,
} from "./closureSimModel";

const FIELD =
  "min-h-11 w-full rounded-lg border border-edge bg-raised px-3 text-sm text-fg placeholder:text-fg-soft";

function todayMy(): string {
  // the Malaysia calendar day, whatever the browser's time zone
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur" }).format(new Date());
}

const emptyRow = (): ClosureRow => ({ roads: "", day: todayMy(), start: "09:00", end: "17:00" });

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
                // a name repeats once per stretch, so the engine's order is the key
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

/**
 * Management (T-026/T-027): close one or more roads or stretches for a time window and see what
 * changes for everyday sample trips. Draws the course in red and the detours by pressure on the
 * map. A server without POST /closures/simulate gets a plain "not available yet" note.
 */
export function ClosurePanel() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [reason, setReason] = useState<ClosureReason>("works");
  const [rows, setRows] = useState<ClosureRow[]>(() => [emptyRow()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<ClosureImpact | null>(null);
  const profile = useScene((s) => s.profile);
  const scenarioId = useScene((s) => s.scenarioId);
  const setClosureSim = useScene((s) => s.setClosureSim);
  const access = useLayer("access", profile, scenarioId, open);

  if (!open)
    return (
      <div className="px-3 py-1">
        <LaunchRow
          icon="route"
          title="Road closures"
          subtitle="What changes for trips when roads close?"
          onClick={() => setOpen(true)}
        />
      </div>
    );

  const patch = (i: number, p: Partial<ClosureRow>) =>
    setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...p } : r)));

  async function run() {
    setError(null);
    setNotice(null);
    const req = buildSimRequest(name, reason, rows);
    if ("error" in req) return setError(req.error);
    setBusy(true);
    const out = await simulateClosures(req.body);
    setBusy(false);
    if (!out.ok) {
      setResult(null);
      setClosureSim(null);
      return out.unavailable ? setNotice(out.message) : setError(out.message);
    }
    setResult(out.result);
    const edges = parseLayer(access.data).edges;
    setClosureSim({ geojson: closureFeatures(out.result, edges) });
  }

  return (
    <section
      aria-label="Road closures"
      className="max-h-[60vh] space-y-3 overflow-y-auto border-b border-edge px-4 py-3 text-sm"
    >
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-fg">Road closures · sample trips</h2>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setResult(null);
            setClosureSim(null);
          }}
          className="min-h-11 rounded px-2 text-fg-soft hover:bg-raised"
        >
          Close
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-fg-soft">
          Name
          <input
            className={FIELD}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Elmina Marathon"
          />
        </label>
        <label className="text-xs text-fg-soft">
          Reason
          <select
            className={FIELD}
            value={reason}
            onChange={(e) => setReason(e.target.value as ClosureReason)}
          >
            {CLOSURE_REASONS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ol className="space-y-2">
        {rows.map((r, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and never reordered
          <li key={i} className="space-y-2 rounded-xl border border-edge p-2">
            <label className="block text-xs text-fg-soft">
              Road or stretch{rows.length > 1 ? ` (closure ${i + 1})` : ""}
              <input
                className={FIELD}
                value={r.roads}
                onChange={(e) => patch(i, { roads: e.target.value })}
                placeholder="Persiaran Garcinia, or Persiaran Elmina between A and B"
              />
            </label>
            <div className="grid grid-cols-3 gap-2">
              <label className="text-xs text-fg-soft">
                Day
                <input
                  type="date"
                  className={FIELD}
                  value={r.day}
                  onChange={(e) => patch(i, { day: e.target.value })}
                />
              </label>
              <label className="text-xs text-fg-soft">
                From
                <input
                  type="time"
                  className={FIELD}
                  value={r.start}
                  onChange={(e) => patch(i, { start: e.target.value })}
                />
              </label>
              <label className="text-xs text-fg-soft">
                Until
                <input
                  type="time"
                  className={FIELD}
                  value={r.end}
                  onChange={(e) => patch(i, { end: e.target.value })}
                />
              </label>
            </div>
            {rows.length > 1 && (
              <button
                type="button"
                className="min-h-11 rounded px-2 text-xs text-fg-soft hover:bg-raised"
                onClick={() => setRows((rs) => rs.filter((_, k) => k !== i))}
              >
                Remove closure {i + 1}
              </button>
            )}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setRows((rs) => [...rs, emptyRow()])}>
          Add closure
        </Button>
        <Button onClick={run} disabled={busy}>
          {busy ? "Simulating…" : "Simulate"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-rose">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded border border-dashed border-edge p-2 text-fg-soft">
          {notice}
        </p>
      )}
      {result && <ClosureResult r={result} />}
    </section>
  );
}
