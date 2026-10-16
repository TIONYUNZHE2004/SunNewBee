import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { Button } from "../../ui/Button";
import { useScene } from "../scene/sceneStore";

type Any = Record<string, unknown>;
const num = (x: unknown) => (typeof x === "number" ? x : 0);
const str = (x: unknown) => (typeof x === "string" ? x : "");

/** Test a change before building it: the same simulated day with and without an imagined
 * change (raise a flooded stretch, close a footway, a ramp at busy steps), trip by trip. The
 * suggestions come from the day's own trips; every count is the engine's. */
export function TestChange({ scenario }: { scenario: string }) {
  const applyIntent = useScene((s) => s.applyIntent);
  const clearWhatIf = useScene((s) => s.clearWhatIf);
  const [pick, setPick] = useState(0);
  // the imagined change leaves the map with this tab (or with a switch to another day)
  useEffect(() => () => clearWhatIf(), [clearWhatIf]);
  const changes = useQuery({
    queryKey: ["day-changes", scenario],
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async () => {
      const r = await api.GET("/day/{scenario_id}/changes", {
        params: { path: { scenario_id: scenario } },
      });
      if (!r.data) throw new Error("no changes");
      return r.data;
    },
  });
  const run = useMutation({
    mutationFn: async (action: Any) => {
      const r = await api.POST("/day/{scenario_id}/compare", {
        params: { path: { scenario_id: scenario } },
        body: { actions: [action as never] },
      });
      if (!r.data) throw new Error(r.response.status === 503 ? "busy" : "failed");
      return r.data;
    },
    onSuccess: (d) => applyIntent({ kind: "whatif.diff", geojson: d.changed_geojson as never }),
  });
  const cands = (changes.data?.candidates ?? []) as Any[];
  const d = run.data as unknown as Any | undefined;
  return (
    <div className="space-y-2">
      <p className="text-xs text-fg-soft">
        Run the same day again with an imagined change and see who gains and who loses. Imagined,
        never a plan.
      </p>
      {changes.isFetching && <p className="text-fg-soft">Looking for changes worth testing…</p>}
      {changes.isError && <p role="alert">No changes could be suggested.</p>}
      {cands.length > 0 && (
        <fieldset className="space-y-1">
          <legend className="sr-only">Imagined change</legend>
          {cands.map((c, i) => (
            <label
              key={JSON.stringify(c.action)}
              className="flex items-start gap-2 text-xs text-fg"
            >
              <input
                type="radio"
                name="day-change"
                checked={pick === i}
                onChange={() => setPick(i)}
                className="mt-1"
              />
              <span>
                {str(c.label)}
                <span className="block text-fg-soft">{str(c.why)}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      {cands.length > 0 && (
        <Button onClick={() => run.mutate(cands[pick]?.action as Any)} disabled={run.isPending}>
          {run.isPending ? "Running both days…" : "Compare the day"}
        </Button>
      )}
      {run.isError && (
        <p role="alert">
          {run.error.message === "busy"
            ? "The township model is busy; try again shortly."
            : "The comparison could not run."}
        </p>
      )}
      {d && <Result d={d} />}
    </div>
  );
}

function Result({ d }: { d: Any }) {
  const groups = ((d.groups ?? []) as Any[]).filter((g) => num(g.better_off) || num(g.worse_off));
  const hall = (d.town_hall ?? []) as Any[];
  const voice = (d.voice ?? {}) as Any;
  return (
    <section
      aria-label="Before and after"
      className="space-y-2 rounded border border-dashed border-lilac p-2"
    >
      <p role="note" className="text-xs text-fg">
        {str(d.disclaimer)}
      </p>
      <p className="font-semibold text-fg">{((d.actions ?? []) as string[]).join("; ")}</p>
      <p className="text-fg">
        {num(d.residents_better).toLocaleString()} residents would be better off and{" "}
        {num(d.residents_worse).toLocaleString()} worse off ({num(d.trips_better).toLocaleString()}{" "}
        trips better, {num(d.trips_worse).toLocaleString()} worse).
      </p>
      <p className="text-[10px] text-fg-soft">Compared with {str(d.baseline)}.</p>
      {groups.length > 0 && (
        <table className="w-full text-xs">
          <caption className="sr-only">Residents better or worse off, by group</caption>
          <thead>
            <tr className="text-left text-fg-soft">
              <th className="py-1 font-medium">Group</th>
              <th className="font-medium">Better off</th>
              <th className="font-medium">Worse off</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={str(g.id)} className="border-t border-edge text-fg">
                <td className="py-1">{str(g.label)}</td>
                <td>{num(g.better_off)}</td>
                <td>{num(g.worse_off)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {hall.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-soft">Town hall</h3>
          <ul aria-label="Town hall" className="mt-1 space-y-1">
            {hall.map((x) => (
              <li key={str(x.author)} className="text-xs text-fg">
                <span className="text-fg-soft">
                  {str(x.name)} · {str(x.role)}
                  {x.voice === "ai" ? " · AI voice, checked" : " · template"}:
                </span>{" "}
                {str(x.text)}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[10px] text-fg-soft">Voices: {str(voice.model)}</p>
        </div>
      )}
    </section>
  );
}
