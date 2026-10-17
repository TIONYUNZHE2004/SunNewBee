import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../lib/api";
import { useScene } from "../scene/sceneStore";
import {
  cellSentence,
  minutesOf,
  OUTCOME_STYLE,
  PROFILE_WORDS,
  type SweepCell,
  type TripMeta,
  tripFromApi,
} from "./tripModel";

/** A resident's own trip in a rehearsal (Cycle 20): one cell per 10-minute departure, coloured
 * and marked by what happened to that trip in the rehearsal. Tapping a cell rehearses that
 * departure again and plays it on the map. Words are the engine's; nothing here is advice. */
export interface TripEnds {
  from_id?: string | null;
  to_id?: string | null;
  from_point?: string | null;
  to_point?: string | null;
}

export function TripStrip({ meta, ends }: { meta: TripMeta; ends?: TripEnds }) {
  const sweep = meta.sweep ?? [];
  // the departure on the map is the one shown as picked, so every strip agrees (review C20)
  const shown = useScene((s) => (s.myTrip?.geojson as { meta?: TripMeta } | undefined)?.meta);
  const sameTrip =
    shown && shown.from === meta.from && shown.to === meta.to && shown.day === meta.day;
  const [own, setOwn] = useState<string | null>(meta.leave ?? null);
  const picked = sameTrip ? (shown?.leave ?? own) : own;
  const setPicked = setOwn;
  const setMyTrip = useScene((s) => s.setMyTrip);
  const setDay = useScene((s) => s.setDay);
  const clearWhatIf = useScene((s) => s.clearWhatIf);
  const body = ends ?? { from_id: meta.from_id ?? null, to_id: meta.to_id ?? null };
  const replay = useMutation({
    mutationFn: async (leave: string) => {
      const r = await api.POST("/day/{scenario_id}/trip", {
        params: { path: { scenario_id: meta.day ?? "storm" } },
        body: {
          from_id: body.from_id ?? null,
          to_id: body.to_id ?? null,
          from_point: body.from_point ?? null,
          to_point: body.to_point ?? null,
          profile: meta.profile ?? "default",
          leave_at: leave,
        },
      });
      if (!r.data) throw new Error(r.response.status === 503 ? "busy" : "failed");
      return r.data as unknown as Record<string, unknown>;
    },
    onSuccess: (d, leave) => {
      clearWhatIf(); // a what-if from another moment never stays beside the trip
      setMyTrip(tripFromApi(d));
      const t = minutesOf(leave);
      setDay({ on: true, playing: false, scenario: meta.day ?? "storm", ...(t ? { t } : {}) });
    },
  });
  if (!sweep.length) return null;
  const canReplay = !!(
    meta.day &&
    (body.from_id || body.from_point) &&
    (body.to_id || body.to_point)
  );
  const sel = sweep.find((c) => c.leave === picked) ?? sweep.find((c) => c.leave === meta.leave);
  const present = [...new Set(sweep.map((c) => c.outcome))];
  const pick = (c: SweepCell) => {
    setPicked(c.leave);
    if (canReplay) replay.mutate(c.leave);
  };
  return (
    <section
      aria-label="Your trip in the rehearsal"
      className="space-y-2 rounded-xl border border-edge bg-surface/60 p-3 text-xs text-fg"
    >
      <p className="font-semibold">
        Your trip in the {meta.day_label ?? "simulated day"} rehearsal
        <span className="font-normal text-fg-soft">
          {" "}
          · {meta.from} → {meta.to} {PROFILE_WORDS[meta.profile ?? "default"] ?? ""}
        </span>
      </p>
      <fieldset className="min-w-0 border-0 p-0">
        <legend className="sr-only">Departures in the rehearsal, every 10 minutes</legend>
        <div className="flex gap-px overflow-x-auto pb-1">
          {sweep.map((c) => {
            const st = OUTCOME_STYLE[c.outcome] ?? OUTCOME_STYLE.no_way;
            const asked = c.leave === meta.leave;
            const hour = c.leave.endsWith(":00");
            return (
              <div key={c.leave} className="flex shrink-0 flex-col items-center gap-0.5">
                <button
                  type="button"
                  aria-label={`${cellSentence(c)}${asked ? " The time you asked about." : ""}`}
                  aria-pressed={c.leave === sel?.leave}
                  tabIndex={c.leave === sel?.leave ? 0 : -1}
                  title={cellSentence(c)}
                  onClick={() => pick(c)}
                  onKeyDown={(e) => {
                    // one tab stop for the strip; arrow keys move between departures
                    const i = sweep.indexOf(c);
                    const next =
                      e.key === "ArrowRight"
                        ? sweep[i + 1]
                        : e.key === "ArrowLeft"
                          ? sweep[i - 1]
                          : undefined;
                    if (!next) return;
                    e.preventDefault();
                    setPicked(next.leave);
                    const el = (e.currentTarget.parentElement?.parentElement?.querySelectorAll(
                      "button",
                    ) ?? [])[i + (e.key === "ArrowRight" ? 1 : -1)] as
                      | HTMLButtonElement
                      | undefined;
                    el?.focus();
                  }}
                  className={`grid h-7 w-4 place-items-center rounded-sm text-[10px] leading-none text-white ${
                    c.leave === sel?.leave ? "ring-2 ring-fg ring-offset-1 ring-offset-surface" : ""
                  }`}
                  style={{
                    backgroundColor: st.color,
                    opacity: asked || c.leave === sel?.leave ? 1 : 0.8,
                  }}
                >
                  <span aria-hidden="true">{st.glyph}</span>
                </button>
                <span aria-hidden="true" className="h-3 text-[9px] text-fg-soft">
                  {hour ? c.leave.slice(0, 2) : asked ? "▲" : ""}
                </span>
              </div>
            );
          })}
        </div>
      </fieldset>
      {sel && (
        <p aria-live="polite" className="text-fg">
          {cellSentence(sel)}
          {replay.isPending && <span className="text-fg-soft"> Rehearsing on the map…</span>}
          {replay.isError && <span className="text-fg-soft"> Could not rehearse that one.</span>}
        </p>
      )}
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-fg-soft">
        {present.map((o) => (
          <li key={o} className="flex items-center gap-1">
            <span
              aria-hidden="true"
              className="inline-grid size-3 place-items-center rounded-sm text-[8px] text-white"
              style={{ backgroundColor: OUTCOME_STYLE[o]?.color }}
            >
              {OUTCOME_STYLE[o]?.glyph}
            </span>
            {OUTCOME_STYLE[o]?.words}
          </li>
        ))}
      </ul>
      <p className="text-fg-soft">
        A rehearsal on the township model, not a forecast.
        {meta.unchecked ? ` This trip crossed ${meta.unchecked} unchecked stretches.` : ""}
        {canReplay ? " Tap a time to rehearse it on the map." : ""}
      </p>
    </section>
  );
}
