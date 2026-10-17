import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { api, useDayScenarios } from "../../lib/api";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/icons";
import { InSlot } from "../map-ui/mapSlots";
import { useScene } from "../scene/sceneStore";
import { TripStrip } from "./TripStrip";
import { minutesOf, PROFILE_WORDS, type TripMeta, tripFromApi } from "./tripModel";
import { pointText, type TripEnd, useTripPick } from "./tripPickStore";

type Place = { id: string; name: string };

/** One end of the trip: a mapped place (searched by name) or a point tapped on the map. */
function EndField({
  end,
  label,
  place,
  onPlace,
}: {
  end: TripEnd;
  label: string;
  place: Place | null;
  onPlace: (p: Place | null) => void;
}) {
  const id = useId();
  const [q, setQ] = useState(place?.name ?? "");
  const picking = useTripPick((s) => s.picking === end);
  const point = useTripPick((s) => s.points[end]);
  const setPicking = useTripPick((s) => s.setPicking);
  const setPoint = useTripPick((s) => s.setPoint);
  const found = useQuery({
    queryKey: ["places", q],
    enabled: q.trim().length >= 2 && q !== place?.name,
    queryFn: async () => {
      const r = await api.GET("/places", { params: { query: { q } } });
      return ((r.data?.data as Place[] | undefined) ?? []).slice(0, 6);
    },
  });
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs font-medium text-fg">
        {label}
      </label>
      {point ? (
        <p className="flex items-center justify-between gap-2 rounded-lg border border-edge bg-raised px-3 py-2 text-xs text-fg">
          A point you chose on the map (not saved)
          <button
            type="button"
            className="min-h-11 rounded px-2 text-fg-soft underline"
            onClick={() => setPoint(end, null)}
          >
            Change
          </button>
        </p>
      ) : (
        <>
          <input
            id={id}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              onPlace(null);
            }}
            placeholder="Type a place, e.g. SK Denai Alam"
            autoComplete="off"
            className="min-h-11 w-full rounded-lg border border-edge bg-raised px-3 text-sm text-fg outline-none placeholder:text-fg-soft focus:border-accent"
          />
          {!place && (found.data?.length ?? 0) > 0 && (
            <ul aria-label={`Places matching ${q}`} className="space-y-0.5">
              {found.data?.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="min-h-9 w-full rounded px-2 text-left text-xs text-fg hover:bg-raised"
                    onClick={() => {
                      onPlace(p);
                      setQ(p.name);
                    }}
                  >
                    {p.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            aria-pressed={picking}
            className="min-h-9 text-xs text-fg-soft underline"
            onClick={() => setPicking(picking ? null : end)}
          >
            {picking ? "Tap the map now… (cancel)" : "or tap a point on the map"}
          </button>
        </>
      )}
    </div>
  );
}

/** "Rehearse my trip" (Cycle 20): a resident runs their own trip through a rehearsed day of the
 * township model and sees, departure by departure, when it got through. Facts from the
 * rehearsal only; it is not a forecast or advice. */
export function TripPlanner() {
  const open = useTripPick((s) => s.open);
  const setOpen = useTripPick((s) => s.setOpen);
  const [from, setFrom] = useState<Place | null>(null);
  const [to, setTo] = useState<Place | null>(null);
  const [leave, setLeave] = useState("07:30");
  const [day, setDayId] = useState("storm");
  const profile = useScene((s) => s.profile);
  const setMyTrip = useScene((s) => s.setMyTrip);
  const setDay = useScene((s) => s.setDay);
  const points = useTripPick((s) => s.points);
  const picking = useTripPick((s) => s.picking);
  const days = useDayScenarios(open);
  const [meta, setMeta] = useState<TripMeta | null>(null);

  useEffect(() => {
    if (!picking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") useTripPick.getState().setPicking(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [picking]);

  const run = useMutation({
    mutationFn: async () => {
      const r = await api.POST("/day/{scenario_id}/trip", {
        params: { path: { scenario_id: day } },
        body: {
          from_id: points.from ? null : (from?.id ?? null),
          to_id: points.to ? null : (to?.id ?? null),
          from_point: points.from ? pointText(points.from) : null,
          to_point: points.to ? pointText(points.to) : null,
          profile,
          leave_at: leave,
        },
      });
      if (!r.data) {
        const detail = (r.error as { detail?: unknown } | undefined)?.detail;
        throw new Error(typeof detail === "string" ? detail : "Could not rehearse that trip.");
      }
      return r.data as unknown as Record<string, unknown>;
    },
    onSuccess: (d) => {
      const g = tripFromApi(d);
      setMeta(d.status === "rehearsed" ? g.meta : null);
      if (d.status !== "rehearsed") return;
      setMyTrip(g);
      const t = minutesOf(leave);
      setDay({ on: true, playing: false, scenario: day, ...(t ? { t } : {}) });
    },
  });
  const noData = run.data && run.data.status !== "rehearsed";
  const ready = (from || points.from) && (to || points.to) && minutesOf(leave) !== null;

  if (!open) return null;

  return (
    <section
      aria-label="Rehearse my trip"
      className="max-h-[60vh] space-y-3 overflow-y-auto border-b border-edge px-4 py-3 text-sm"
    >
      {picking && (
        <InSlot name="hint">
          <p className="glass rounded-full px-4 py-2 text-sm text-fg">
            Tap the map where your trip {picking === "from" ? "starts" : "ends"} · Esc to cancel
          </p>
        </InSlot>
      )}
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-fg">Rehearse my trip</h2>
        <button
          type="button"
          className="min-h-11 rounded px-2 text-fg-soft hover:bg-raised"
          onClick={() => setOpen(false)}
        >
          Close
        </button>
      </div>
      <p role="note" className="rounded border border-dashed border-lilac p-2 text-xs text-fg">
        Runs your trip through a rehearsed day of the township model: not a forecast and not advice.
        On a real storm day, follow official MBSA / JPS / NADMA guidance.
      </p>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) run.mutate();
        }}
      >
        <EndField end="from" label="From" place={from} onPlace={setFrom} />
        <EndField end="to" label="To" place={to} onPlace={setTo} />
        <div className="flex flex-wrap gap-3">
          <label className="space-y-1 text-xs font-medium text-fg">
            <span className="block">Leaving at</span>
            <input
              type="time"
              step={600}
              min="05:00"
              max="22:30"
              value={leave}
              onChange={(e) => setLeave(e.target.value)}
              className="min-h-11 rounded-lg border border-edge bg-raised px-3 text-sm text-fg"
            />
          </label>
          <label className="space-y-1 text-xs font-medium text-fg">
            <span className="block">Rehearsed day</span>
            <select
              value={day}
              onChange={(e) => setDayId(e.target.value)}
              className="min-h-11 rounded-lg border border-edge bg-raised px-3 text-sm text-fg"
            >
              {(days.data ?? [{ id: "storm", label: "Storm at the school run" }]).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-xs text-fg-soft">
          Travelling {PROFILE_WORDS[profile] ?? "on foot"} (change it under Travelling as). Points
          you tap are used for this rehearsal only and are not saved.
        </p>
        <Button type="submit" disabled={!ready || run.isPending}>
          {run.isPending ? "Rehearsing…" : "Rehearse"}
        </Button>
      </form>
      {run.isError && (
        <p role="alert" className="text-xs text-fg">
          {(run.error as Error).message}
        </p>
      )}
      {noData && (
        <p role="status" className="text-xs text-fg">
          No mapped connection for this trip: a data gap in the township model, not a closed road.
        </p>
      )}
      {meta && <TripStrip meta={meta} />}
    </section>
  );
}

/** The entry point beside "Travelling as": opens the "Rehearse my trip" card (no extra row). */
export function TripChip() {
  const open = useTripPick((s) => s.open);
  const setOpen = useTripPick((s) => s.setOpen);
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={() => setOpen(!open)}
      className="inline-flex min-h-11 items-center gap-2 rounded-full border border-edge bg-raised px-3 text-xs font-semibold text-fg hover:border-accent"
    >
      <Icon name="route" className="size-4" />
      Rehearse my trip
    </button>
  );
}
