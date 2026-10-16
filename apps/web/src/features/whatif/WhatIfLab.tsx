import { useMutation, useQuery } from "@tanstack/react-query";
import type { Schemas } from "@tl/api-client";
import { useState } from "react";
import { api } from "../../lib/api";
import { Button } from "../../ui/Button";
import { type Profile, useScene } from "../scene/sceneStore";
import { actionKey, pct, summaryBars, WHATIF_LEGEND } from "./whatifModel";

type Candidate = Schemas["Candidate"];
type Result = Schemas["WhatIfResponse"];
type Scope = "evacuation" | "suite";

const PROFILES: { id: Profile; label: string }[] = [
  { id: "wheelchair", label: "Wheelchair" },
  { id: "stroller", label: "Stroller" },
  { id: "older_adult_rest", label: "Older adult" },
  { id: "default", label: "Walking" },
];

function stageLabel(id: string): string {
  const m = /^stage_p(\d)m$/.exec(id);
  return m ? `River +${m[1]} m` : "Normal level";
}

/** Staff panel: pick engine-suggested changes and a river stage, run them on a copy of the
 * township, and see what would change. Nothing is saved and the real township never changes. */
export function WhatIfLab() {
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<Profile>("wheelchair");
  const [stage, setStage] = useState<string>("stage_p3m");
  const [scope, setScope] = useState<Scope>("evacuation");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const applyIntent = useScene((s) => s.applyIntent);

  const suggestions = useQuery({
    queryKey: ["what-if-suggestions", profile],
    enabled: open,
    queryFn: async () => {
      const r = await api.GET("/what-if/suggestions", { params: { query: { profile } } });
      if (!r.data) throw new Error("no suggestions");
      return r.data;
    },
  });
  const run = useMutation({
    mutationFn: async (): Promise<Result> => {
      const cands = (suggestions.data?.candidates ?? []).filter((c) =>
        picked.has(actionKey(c.action)),
      );
      const actions: Schemas["WhatIfRequest"]["actions"] = [
        ...(stage ? [{ kind: "set_river_stage" as const, scenario_id: stage }] : []),
        ...cands.map((c) => c.action),
      ];
      const r = await api.POST("/what-if", { body: { actions, profile, scope } });
      if (!r.data) throw new Error("The what-if could not run");
      return r.data;
    },
    onSuccess: (d) => applyIntent({ kind: "whatif.diff", geojson: d.diff_geojson }),
  });

  const toggle = (c: Candidate) => {
    run.reset();
    setPicked((s) => {
      const k = actionKey(c.action);
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  };

  if (!open)
    return (
      <div className="border-b border-edge px-4 py-2">
        <Button variant="outline" onClick={() => setOpen(true)}>
          Open What-if Lab
        </Button>
        <span className="ml-2 text-xs text-fg-soft">Imagine changes on a copy of the township</span>
      </div>
    );

  const res = run.data;
  return (
    <section
      aria-label="What-if Lab"
      className="max-h-[48vh] space-y-3 overflow-y-auto border-b border-edge px-4 py-3 text-sm"
    >
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-fg">What-if Lab</h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="min-h-11 rounded px-2 text-fg-soft hover:bg-raised"
        >
          Close
        </button>
      </div>
      <p className="text-xs text-fg-soft">
        Runs on a copy of the township model. Imagined changes are not real; unverified facts stay
        unverified.
      </p>
      <div className="grid grid-cols-3 gap-2">
        <label className="flex flex-col gap-1 text-xs text-fg-soft">
          Who
          <select
            value={profile}
            onChange={(e) => {
              setProfile(e.target.value as Profile);
              setPicked(new Set());
              run.reset();
            }}
            className="min-h-11 rounded border border-edge bg-raised px-2 text-sm text-fg"
          >
            {PROFILES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-fg-soft">
          River
          <select
            value={stage}
            onChange={(e) => {
              setStage(e.target.value);
              run.reset();
            }}
            className="min-h-11 rounded border border-edge bg-raised px-2 text-sm text-fg"
          >
            <option value="">Normal level</option>
            {(suggestions.data?.river_stages ?? [])
              .filter((s) => s !== "baseline")
              .map((s) => (
                <option key={s} value={s}>
                  {stageLabel(s)}
                </option>
              ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-fg-soft">
          Journeys
          <select
            value={scope}
            onChange={(e) => {
              setScope(e.target.value as Scope);
              run.reset();
            }}
            className="min-h-11 rounded border border-edge bg-raised px-2 text-sm text-fg"
          >
            <option value="evacuation">To nearest centre</option>
            <option value="suite">Everyday trips</option>
          </select>
        </label>
      </div>
      <fieldset className="space-y-1">
        <legend className="text-xs font-semibold tracking-wider text-fg-soft">
          CHANGES SUGGESTED BY THE MODEL
        </legend>
        {suggestions.isLoading && <p className="text-fg-soft">Finding candidates…</p>}
        {suggestions.isError && (
          <p role="alert" className="text-fg">
            Could not load suggestions from the township model.
          </p>
        )}
        {(suggestions.data?.candidates ?? []).map((c) => (
          <label key={actionKey(c.action)} className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              checked={picked.has(actionKey(c.action))}
              onChange={() => toggle(c)}
              className="size-4"
            />
            <span className="text-fg">
              {c.label}
              {c.journeys_using_it ? (
                <span className="text-fg-soft"> · used by {c.journeys_using_it} sample trips</span>
              ) : null}
            </span>
          </label>
        ))}
      </fieldset>
      <Button onClick={() => run.mutate()} disabled={run.isPending}>
        {run.isPending ? "Simulating…" : "Run what-if"}
      </Button>
      {run.isError && <p role="alert">{(run.error as Error).message}</p>}
      {res && (
        <div
          role="note"
          className="space-y-2 rounded-lg border border-dashed border-lilac bg-raised p-3"
        >
          <p className="text-xs font-semibold text-lilac">{WHATIF_LEGEND}</p>
          <ul className="list-inside list-disc text-xs text-fg-soft">
            {res.action_labels.map((l, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: labels can repeat ("unnamed steps")
              <li key={`${i}-${l}`}>{l}</li>
            ))}
          </ul>
          {summaryBars(res.summary, res.scope).map((b) => (
            <div key={b.label}>
              <div className="flex justify-between text-xs text-fg">
                <span>{b.label}</span>
                <span>
                  before {b.today} → what-if {b.whatIf} of {b.total}
                </span>
              </div>
              <div className="mt-1 h-2 rounded bg-edge" aria-hidden="true">
                <div
                  className="h-2 rounded bg-fg-soft"
                  style={{ width: `${pct(b.today, b.total)}%` }}
                />
              </div>
              <div className="mt-0.5 h-2 rounded bg-edge" aria-hidden="true">
                <div
                  className="h-2 rounded bg-lilac"
                  style={{ width: `${pct(b.whatIf, b.total)}%` }}
                />
              </div>
            </div>
          ))}
          <p className="text-xs text-fg-soft">
            {res.summary.changed ?? 0} of {res.summary.total ?? 0} sample journeys change.{" "}
            {res.disclaimer}
          </p>
        </div>
      )}
    </section>
  );
}
