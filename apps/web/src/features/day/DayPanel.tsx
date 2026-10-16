import { useEffect, useMemo, useState } from "react";
import { useDay, useDayScenarios } from "../../lib/api";
import { Button } from "../../ui/Button";
import { useScene } from "../scene/sceneStore";
import { binAt, DAY_END, DAY_LEGEND, DAY_START, feedUntil, hhmm, stageAt } from "./dayModel";

const STATUS: Record<string, string> = {
  on_time: "on time",
  late: "late",
  cancelled: "couldn't go",
  turned_back: "turned back",
  stranded: "stuck",
  data_gap: "no mapped way",
};
const TABS = ["Overview", "Residents", "Feed", "How it was made"] as const;
type Tab = (typeof TABS)[number];
const MIN_PER_TICK = 1.8; // 18 hours of the day in about a minute at 1x

type Any = Record<string, unknown>;
const num = (x: unknown) => (typeof x === "number" ? x : 0);
const str = (x: unknown) => (typeof x === "string" ? x : "");

function stageLabel(sid: string | null) {
  if (!sid) return "River at its normal level";
  const m = sid.match(/stage_p(\d+)m/);
  return m ? `River +${m[1]} m (indicative scenario)` : sid;
}

/** Management panel: Elmina Day, 5,000 synthetic residents living a day on the township
 * model. The clock drives the map (moving residents, the river level) and the feed; every
 * number is the engine's. A rehearsal, not a forecast. */
export function DayPanel() {
  const day = useScene((s) => s.day);
  const setDay = useScene((s) => s.setDay);
  const setDayStage = useScene((s) => s.setDayStage);
  const applyIntent = useScene((s) => s.applyIntent);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("Overview");
  const shown = open || day.on;
  const scenarios = useDayScenarios(shown);
  const q = useDay(day.scenario, shown);
  const d = q.data as unknown as Any | undefined;
  const sc = (d?.scenario ?? {}) as Any;
  const stages = (sc.stages ?? []) as [number, string | null][];

  // the clock
  useEffect(() => {
    if (!day.on || !day.playing) return;
    const id = window.setInterval(() => {
      const t = useScene.getState().day.t + MIN_PER_TICK;
      if (t >= DAY_END) setDay({ t: DAY_END, playing: false });
      else setDay({ t });
    }, 100);
    return () => window.clearInterval(id);
  }, [day.on, day.playing, setDay]);

  // the river level follows the clock while the day plays on the map
  const stage = stageAt(stages, day.t);
  useEffect(() => {
    if (day.on && d) setDayStage(stage);
  }, [day.on, d, stage, setDayStage]);

  const start = () => {
    const before = useScene.getState().scenarioId;
    setDay({ on: true, playing: true, before, t: day.t >= DAY_END ? DAY_START : day.t });
  };
  const close = () => {
    setOpen(false);
    if (day.on) setDayStage(day.before);
    setDay({ on: false, playing: false, focus: null });
  };

  if (!shown)
    return (
      <div className="border-b border-edge px-4 py-2">
        <Button variant="outline" onClick={() => setOpen(true)}>
          Simulate a day
        </Button>
        <span className="ml-2 text-xs text-fg-soft">
          5,000 synthetic residents live a day on Elmina's map
        </span>
      </div>
    );

  const headline = (d?.headline ?? {}) as Any;
  const bin = binAt(
    (d?.timeline ?? []) as {
      t: number;
      walking: number;
      driving: number;
      waiting: number;
      rain: boolean;
    }[],
    day.t,
  );
  const spotlight = (d?.spotlight ?? {}) as Any;

  return (
    <section
      aria-label="Simulate a day"
      className="max-h-[60vh] space-y-3 overflow-y-auto border-b border-edge px-4 py-3 text-sm"
    >
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-fg">Elmina Day · synthetic residents</h2>
        <button
          type="button"
          onClick={close}
          className="min-h-11 rounded px-2 text-fg-soft hover:bg-raised"
        >
          Close
        </button>
      </div>
      <p role="note" className="rounded border border-dashed border-lilac p-2 text-xs text-fg">
        {str(d?.disclaimer) || DAY_LEGEND}
      </p>
      <fieldset className="flex flex-wrap gap-2">
        <legend className="sr-only">Which day</legend>
        {(scenarios.data ?? []).map((s) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={s.id === day.scenario}
            onClick={() => setDay({ scenario: s.id, t: DAY_START + 60, focus: null })}
            className={`min-h-11 rounded-full border px-3 text-xs ${
              s.id === day.scenario
                ? "border-accent bg-accent text-on-accent"
                : "border-edge bg-raised text-fg"
            }`}
          >
            {s.label}
          </button>
        ))}
      </fieldset>
      {q.isFetching && <p className="text-fg-soft">Simulating 5,000 residents…</p>}
      {q.isError && <p role="alert">The day could not be simulated.</p>}
      {d && (
        <>
          <p className="text-xs text-fg-soft">{str(sc.summary)}</p>
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-2xl text-fg" role="timer" aria-label="Clock">
              {hhmm(day.t)}
            </span>
            <Button onClick={() => (day.on && day.playing ? setDay({ playing: false }) : start())}>
              {day.on && day.playing ? "Pause" : day.on ? "Play" : "Play on the map"}
            </Button>
            <span className="text-xs text-fg">
              {stageLabel(stage)}
              {bin?.rain ? " · heavy rain" : ""}
            </span>
          </div>
          <input
            type="range"
            aria-label="Time of day"
            min={DAY_START}
            max={DAY_END}
            step={5}
            value={Math.round(day.t)}
            onChange={(e) => setDay({ t: Number(e.target.value), on: true, playing: false })}
            className="w-full"
          />
          <p aria-live="polite" className="text-xs text-fg">
            At {hhmm(day.t)}: {bin?.walking ?? 0} walking, {bin?.driving ?? 0} driving,{" "}
            {bin?.waiting ?? 0} waiting for the water.
          </p>
          <div role="tablist" aria-label="Day views" className="flex flex-wrap gap-1">
            {TABS.map((x) => (
              <button
                key={x}
                type="button"
                role="tab"
                aria-selected={tab === x}
                onClick={() => setTab(x)}
                className={`min-h-11 rounded px-2 text-xs ${
                  tab === x ? "bg-raised font-semibold text-fg" : "text-fg-soft hover:bg-raised"
                }`}
              >
                {x}
              </button>
            ))}
          </div>
          {tab === "Overview" && <Overview d={d} headline={headline} />}
          {tab === "Residents" && (
            <Residents
              people={(spotlight.residents ?? []) as Any[]}
              focus={day.focus}
              onFocus={(id, coord) => {
                setDay({ focus: id });
                if (coord) applyIntent({ kind: "camera.fly_to", center: coord, range_m: 700 });
              }}
            />
          )}
          {tab === "Feed" && <Feed feed={(spotlight.feed ?? []) as Any[]} t={day.t} />}
          {tab === "How it was made" && <About d={d} voice={(spotlight.voice ?? {}) as Any} />}
        </>
      )}
    </section>
  );
}

function Overview({ d, headline }: { d: Any; headline: Any }) {
  const groups = (d.groups ?? []) as Any[];
  const school = (d.school ?? {}) as Any;
  const health = (d.health ?? {}) as Any;
  const places = ((d.places ?? []) as Any[]).slice(0, 5);
  return (
    <div className="space-y-3">
      <p className="text-fg">
        {num(headline.trips).toLocaleString()} trips: {num(headline.on_time).toLocaleString()} on
        time, {num(headline.late)} late, {num(headline.cancelled).toLocaleString()} couldn't go,{" "}
        {num(headline.turned_back)} turned back, {num(headline.stranded)} stuck at day's end,{" "}
        {num(headline.data_gap)} with no mapped way (a data gap).
      </p>
      <table className="w-full text-xs">
        <caption className="sr-only">Residents by group, worst outcome of their day</caption>
        <thead>
          <tr className="text-left text-fg-soft">
            <th className="py-1 font-medium">Group</th>
            <th className="font-medium">Residents</th>
            <th className="font-medium">On time</th>
            <th className="font-medium">Late</th>
            <th className="font-medium">Couldn't go</th>
            <th className="font-medium">Turned back</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={str(g.id)} className="border-t border-edge text-fg">
              <td className="py-1">{str(g.label)}</td>
              <td>{num(g.residents)}</td>
              <td>{num(g.on_time)}</td>
              <td>{num(g.late)}</td>
              <td>{num(g.cancelled)}</td>
              <td>{num(g.turned_back)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-fg">
        School: {num(school.pupils)} pupils; {num(school.on_time)} on time, {num(school.late)} late,{" "}
        {num(school.cancelled)} couldn't get there, {num(school.turned_back)} turned back.
      </p>
      <p className="text-fg">
        {num(health.residents_walking_20_min).toLocaleString()} of{" "}
        {num(health.residents).toLocaleString()} residents walked 20 minutes or more.
      </p>
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-soft">
          Busiest places
        </h3>
        <ul className="mt-1 space-y-1">
          {places.map((p) => (
            <li key={str(p.place_id)} className="text-fg">
              {str(p.name)}: {num(p.visits)} visits, up to {num(p.peak)} at once
              {typeof p.peak_at === "number" ? ` (${hhmm(p.peak_at)})` : ""}
              {num(p.met_neighbours) ? `, ${num(p.met_neighbours)} met a neighbour` : ""}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function worst(facts: Any): string {
  const order = ["stranded", "cancelled", "turned_back", "late", "data_gap", "on_time"];
  const sts = ((facts.trips ?? []) as Any[]).map((t) => str(t.status));
  return order.find((s) => sts.includes(s)) ?? "stayed home";
}

function Residents({
  people,
  focus,
  onFocus,
}: {
  people: Any[];
  focus: string | null;
  onFocus: (id: string, coord: number[] | null) => void;
}) {
  const sel = people.find((p) => p.id === focus);
  return (
    <div className="space-y-2">
      <p className="text-xs text-fg-soft">
        Synthetic residents with a voice. Pick one to follow them on the map.
      </p>
      <ul className="grid gap-1 sm:grid-cols-2">
        {people.map((p) => {
          const w = worst((p.facts ?? {}) as Any);
          return (
            <li key={str(p.id)}>
              <button
                type="button"
                aria-pressed={p.id === focus}
                onClick={() => onFocus(str(p.id), (p.home_coord as number[]) ?? null)}
                className={`min-h-11 w-full rounded border px-2 py-1 text-left text-xs ${
                  p.id === focus ? "border-accent bg-raised" : "border-edge"
                }`}
              >
                <span className="font-medium text-fg">{str(p.name)}</span>
                <span className="block text-fg-soft">
                  {str(p.role)} · {STATUS[w] ?? w}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {sel && (
        <article
          aria-label={`${str(sel.name)}'s day`}
          className="space-y-1 rounded border border-edge p-2"
        >
          <h3 className="font-semibold text-fg">
            {str(sel.name)}, {num(sel.age)} · {str(sel.role)}
          </h3>
          <ul className="space-y-1">
            {((sel.diary ?? []) as Any[]).map((l) => (
              <li key={`${str(l.trip)}-${str(l.text).slice(0, 12)}`} className="text-fg">
                {str(l.text)}{" "}
                <span className="text-[10px] text-fg-soft">
                  {l.voice === "ai" ? "AI voice, checked" : "template"}
                </span>
              </li>
            ))}
          </ul>
          {((sel.decisions ?? []) as Any[]).map((x) => (
            <p key={str(x.key)} className="text-xs text-fg-soft">
              Decided at {hhmm(num(x.t))}:{" "}
              {str(((x.options ?? []) as Any[]).find((o) => o.id === x.chosen)?.label)}
              {x.reason ? ` · "${str(x.reason)}"` : ""}
            </p>
          ))}
        </article>
      )}
    </div>
  );
}

function Feed({ feed, t }: { feed: Any[]; t: number }) {
  type Item = Any & { id: string; t: number; replies: Any[] };
  const shown = feedUntil<Item>(
    feed.map((p) => ({ ...p, id: str(p.id), t: num(p.t), replies: (p.replies ?? []) as Any[] })),
    t,
  );
  if (!shown.length)
    return <p className="text-xs text-fg-soft">Nothing posted yet at {hhmm(t)}.</p>;
  return (
    <ul aria-label="Community feed" className="space-y-2">
      {shown.map((p) => (
        <li
          key={p.id}
          className={`rounded border p-2 ${p.author === "township" ? "border-dashed border-lilac" : "border-edge"}`}
        >
          <p className="text-xs text-fg-soft">
            {hhmm(p.t)} · {str(p.name)}
            {p.author === "township" ? "" : ` · ${str(p.role)}`}
            {p.voice === "ai"
              ? " · AI voice, checked"
              : p.voice === "template"
                ? " · template"
                : ""}
          </p>
          <p className="text-fg">{str(p.text)}</p>
          {(p.replies as Any[]).map((r) => (
            <p
              key={`${str(r.author)}-${num(r.t)}`}
              className="mt-1 border-l-2 border-edge pl-2 text-xs text-fg"
            >
              <span className="text-fg-soft">{str(r.name)}:</span> {str(r.text)}
            </p>
          ))}
        </li>
      ))}
    </ul>
  );
}

function About({ d, voice }: { d: Any; voice: Any }) {
  const pop = (d.population ?? {}) as Any;
  return (
    <div className="space-y-2 text-xs text-fg">
      <p>
        {num(pop.residents).toLocaleString()} synthetic residents in{" "}
        {num(pop.households).toLocaleString()} households, placed in real OpenStreetMap homes:{" "}
        {num(pop.wheelchair_users)} wheelchair users, {num(pop.parents_with_strollers)} parents with
        a stroller, {num(pop.older_needing_rest)} older residents who need rests.
      </p>
      <ul className="list-disc space-y-1 pl-4">
        {((pop.sources ?? []) as Any[]).map((s) => (
          <li key={str(s.fact)}>
            {str(s.fact)} <span className="text-fg-soft">({str(s.source)})</span>
          </li>
        ))}
        {((d.assumptions ?? []) as string[]).map((a) => (
          <li key={a}>{a}</li>
        ))}
      </ul>
      <p className="text-fg-soft">
        {str(voice.note)} Voices: {str(voice.model)}
        {voice.recorded_at ? `, recorded ${str(voice.recorded_at).slice(0, 10)}` : ""}.
      </p>
    </div>
  );
}
