import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useScenarios } from "../../lib/api";
import { originName } from "../../lib/placeQuery";
import { centreReachLabel, routeStatusLabel } from "../../lib/routeStatus";
import { DisclaimerBanner } from "../flood/DisclaimerBanner";
import type { Profile } from "../scene/sceneStore";
import { Assumptions } from "./Assumptions";
import { buildAdvisory, LANGS, type Lang } from "./advisory";
import { comparisonRows } from "./comparison";
import { type Briefing, fetchBriefing } from "./manageApi";

export function summariseBriefing(b: Briefing) {
  return {
    likely: b.affected.likely.length,
    possible: b.affected.possible.length,
    islands: b.affected.isolated_components.length,
    reachable: b.centres.filter((c) => c.reachable).length,
  };
}

const PROFILES: [Profile, string][] = [
  ["default", "Default"],
  ["stroller", "Stroller"],
  ["wheelchair", "Wheelchair"],
  ["older_adult_rest", "Older adult (rest stops)"],
  ["drive", "Drive"],
];
const selCls = "min-h-11 rounded-md border border-line bg-card px-3 text-sm";

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-line bg-card p-3">
      <p className="text-2xl font-semibold">{value}</p>
      <p className="text-sm text-ink-soft">{label}</p>
    </div>
  );
}

/** Two columns: normal river level vs the chosen scenario. Counts only, never a depth. */
export function ComparisonTable({
  baseline,
  scenario,
  scenarioLabel,
  origin,
  baselineState = "ready",
  onRetryBaseline,
}: {
  baseline: Briefing | undefined;
  /** Why `baseline` is missing: still loading, or failed (offers a retry). */
  baselineState?: "loading" | "error" | "ready";
  onRetryBaseline?: () => void;
  scenario: Briefing;
  scenarioLabel: string;
  /** Place the centre rows were measured from (the API's near_place). */
  origin?: { id?: string | null; name?: string | null };
}) {
  const from = origin?.name || originName(origin?.id);
  if (!baseline && baselineState === "loading")
    return (
      <p role="status" className="text-sm text-ink-soft">
        Loading the normal river level…
      </p>
    );
  if (!baseline)
    return (
      <p role="status" className="text-sm text-ink-soft">
        Normal river level unavailable, so no comparison is shown.
        {onRetryBaseline && (
          <>
            {" "}
            <button type="button" className="underline" onClick={onRetryBaseline}>
              Retry
            </button>
          </>
        )}
      </p>
    );
  const rows = comparisonRows(baseline, scenario);
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-card">
      <table className="w-full text-left text-sm">
        <caption className="p-3 text-left font-medium">
          Normal river level compared with the scenario (indicative)
          <span className="block text-xs font-normal text-ink-soft">
            Centre rows are from {from}, demo start point.
          </span>
        </caption>
        <thead className="bg-brand-tint">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              Measure
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Normal river level
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              {scenarioLabel}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-line">
              <th scope="row" className="px-3 py-2 font-medium">
                {r.label}
                {r.key === "reachable" && (
                  <span className="block text-xs font-normal text-ink-soft">
                    from {from}, demo start point
                  </span>
                )}
              </th>
              <td className="px-3 py-2">{r.baseline}</td>
              <td className="px-3 py-2">{r.scenario}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PlaceList({
  title,
  items,
}: {
  title: string;
  items: { id: string; name: string; kind: string }[];
}) {
  return (
    <div>
      <h4 className="text-sm font-medium">{title}</h4>
      {items.length === 0 ? (
        <p className="text-sm text-ink-soft">None</p>
      ) : (
        <ul className="list-disc pl-5 text-sm">
          {items.map((p) => (
            <li key={p.id}>
              {p.name} <span className="text-ink-soft">({p.kind})</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Advisory({ b }: { b: Briefing }) {
  const [lang, setLang] = useState<Lang>("en");
  const [texts, setTexts] = useState<Partial<Record<Lang, string>>>({});
  const s = summariseBriefing(b);
  const base = { scenarioLabel: b.scenario.label, likely: s.likely, possible: s.possible };
  const text = texts[lang] ?? buildAdvisory(lang, base);
  const taId = useId();

  function onKey(e: React.KeyboardEvent, i: number) {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = LANGS[(i + d + LANGS.length) % LANGS.length];
    if (!n) return;
    setLang(n.id);
    document.getElementById(`adv-tab-${n.id}`)?.focus();
  }

  return (
    <div className="space-y-2 rounded-lg border border-line bg-card p-3">
      <div role="tablist" aria-label="Advisory language" className="flex gap-1">
        {LANGS.map((l, i) => (
          <button
            key={l.id}
            id={`adv-tab-${l.id}`}
            type="button"
            role="tab"
            aria-selected={lang === l.id}
            aria-controls={`adv-panel`}
            tabIndex={lang === l.id ? 0 : -1}
            onClick={() => setLang(l.id)}
            onKeyDown={(e) => onKey(e, i)}
            className={`min-h-11 rounded-md px-3 text-sm font-medium ${lang === l.id ? "bg-brand text-white" : "text-brand hover:bg-brand-tint"}`}
          >
            {l.label}
          </button>
        ))}
      </div>
      <div id="adv-panel" role="tabpanel" aria-labelledby={`adv-tab-${lang}`}>
        <label htmlFor={taId} className="mb-1 block text-sm font-semibold">
          DRAFT – for staff editing; not sent
        </label>
        <textarea
          id={taId}
          rows={9}
          lang={lang === "zh" ? "zh" : lang === "ms" ? "ms" : "en"}
          className="w-full rounded-md border border-line p-3 text-sm"
          value={text}
          onChange={(e) => setTexts({ ...texts, [lang]: e.target.value })}
        />
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="min-h-11 rounded-md border border-line px-3 text-sm"
            disabled={texts[lang] === undefined}
            onClick={() => setTexts({ ...texts, [lang]: undefined })}
          >
            Reset to template
          </button>
          <p className="text-xs text-ink-soft">
            This page cannot send messages. Copy the text into the official channel.
          </p>
        </div>
      </div>
    </div>
  );
}

export function FloodBriefing() {
  const scenarios = useScenarios();
  const [scenarioId, setScenarioId] = useState("stage_p3m");
  const [profile, setProfile] = useState<Profile>("default");
  const [showDraft, setShowDraft] = useState(false);
  const q = useQuery({
    queryKey: ["manage", "briefing", scenarioId, profile],
    queryFn: () => fetchBriefing(scenarioId, profile),
    retry: false,
  });
  const base = useQuery({
    queryKey: ["manage", "briefing", "baseline", profile],
    queryFn: () => fetchBriefing("baseline", profile),
    retry: false,
  });
  const options = (scenarios.data ?? []).filter((s) => s.id !== "baseline");
  const b = q.data;
  const s = b ? summariseBriefing(b) : null;

  return (
    <section aria-labelledby="fb-h" className="space-y-4">
      <h2 id="fb-h" className="text-xl font-semibold">
        Flood briefing
      </h2>
      <div className="flex flex-wrap gap-4">
        <div>
          <label htmlFor="fb-sc" className="mb-1 block text-sm font-medium">
            Scenario
          </label>
          <select
            id="fb-sc"
            className={selCls}
            value={scenarioId}
            onChange={(e) => setScenarioId(e.target.value)}
          >
            {!options.some((o) => o.id === scenarioId) && (
              <option value={scenarioId}>{scenarioId}</option>
            )}
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="fb-pr" className="mb-1 block text-sm font-medium">
            Mobility profile
          </label>
          <select
            id="fb-pr"
            className={selCls}
            value={profile}
            onChange={(e) => setProfile(e.target.value as Profile)}
          >
            {PROFILES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
      </div>

      {q.isPending ? (
        <p role="status" className="text-sm text-ink-soft">
          Loading briefing…
        </p>
      ) : q.isError || !b || !s ? (
        <p role="alert" className="text-sm">
          Briefing unavailable.{" "}
          <button type="button" className="underline" onClick={() => q.refetch()}>
            Retry
          </button>
        </p>
      ) : (
        <>
          <DisclaimerBanner text={b.disclaimer} />
          <ComparisonTable
            baseline={base.data}
            baselineState={base.isError ? "error" : base.isPending ? "loading" : "ready"}
            onRetryBaseline={() => base.refetch()}
            scenario={b}
            scenarioLabel={b.scenario.label}
            origin={{ id: b.near_place, name: b.near_place_name }}
          />
          <Assumptions selected={profile} />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Likely cut off" value={s.likely} />
            <Tile label="Possibly cut off" value={s.possible} />
            <Tile label="Isolated areas" value={s.islands} />
            <Tile label="Reachable centres" value={s.reachable} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <PlaceList title="Places likely cut off" items={b.affected.likely} />
            <PlaceList title="Places possibly cut off" items={b.affected.possible} />
          </div>
          <div>
            <h3 className="text-sm font-medium">Isolated areas</h3>
            {b.affected.isolated_components.length === 0 ? (
              <p className="text-sm text-ink-soft">None</p>
            ) : (
              <ul className="list-disc pl-5 text-sm">
                {b.affected.isolated_components.map((c) => (
                  <li key={c.id}>
                    {c.id}: {c.node_count} path nodes
                    {c.sample_place_ids?.length ? `, incl. ${c.sample_place_ids.join(", ")}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="overflow-x-auto rounded-lg border border-line bg-card">
            <table className="w-full text-left text-sm">
              <caption className="p-3 text-left font-medium">
                Evacuation centres and reachability
              </caption>
              <thead className="bg-brand-tint">
                <tr>
                  {["Centre", "Source", "Reachable", "Route status", "Distance"].map((h) => (
                    <th key={h} scope="col" className="px-3 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.centres.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-3 text-ink-soft">
                      No centres listed.
                    </td>
                  </tr>
                )}
                {b.centres.map((c) => (
                  <tr key={c.centre.id} className="border-t border-line">
                    <th scope="row" className="px-3 py-2 font-medium">
                      {c.centre.name}
                    </th>
                    <td className="px-3 py-2">
                      {c.centre.source === "official_pps" ? "Official PPS" : "Candidate"}
                    </td>
                    <td className="px-3 py-2">{centreReachLabel(c)}</td>
                    <td className="px-3 py-2">{routeStatusLabel(c.route_status)}</td>
                    <td className="px-3 py-2">
                      {c.distance_m != null ? `${Math.round(c.distance_m)} m` : "–"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            aria-expanded={showDraft}
            aria-controls="adv-wrap"
            className="min-h-11 rounded-md bg-brand px-4 text-sm font-medium text-white hover:bg-brand-dark"
            onClick={() => setShowDraft(!showDraft)}
          >
            Draft resident advisory
          </button>
          {showDraft && (
            <div id="adv-wrap">
              <Advisory b={b} />
            </div>
          )}
        </>
      )}
    </section>
  );
}
