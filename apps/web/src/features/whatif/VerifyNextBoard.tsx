import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../lib/api";
import { Button } from "../../ui/Button";
import type { Profile } from "../scene/sceneStore";
import { groupBySite, plural } from "./whatifModel";

const PROFILES: { id: Profile; label: string }[] = [
  { id: "wheelchair", label: "Wheelchair" },
  { id: "stroller", label: "Stroller" },
  { id: "older_adult_rest", label: "Older adult" },
];

/** Survey plan on /tickets: which unchecked facts to verify first so the most sample journeys
 * would be confirmed (if the facts pass). Numbers are the world model's, never estimated here. */
export function VerifyNextBoard({ onTicket }: { onTicket: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<Profile>("wheelchair");
  const [scope, setScope] = useState<"evacuation" | "suite">("evacuation");
  const [budget, setBudget] = useState(15);
  const plan = useQuery({
    queryKey: ["verify-next", profile, scope, budget],
    enabled: open,
    staleTime: 60_000,
    queryFn: async () => {
      const r = await api.GET("/verify-next", { params: { query: { profile, scope, budget } } });
      if (!r.data) throw new Error("Could not build a survey plan");
      return r.data;
    },
  });

  if (!open)
    return (
      <div className="mb-4 rounded-lg border border-edge bg-raised p-3">
        <p className="text-sm font-semibold text-fg">Verify next</p>
        <p className="mb-2 text-xs text-fg-soft">
          Which checks would confirm the most journeys? Planned on the township model.
        </p>
        <Button variant="outline" onClick={() => setOpen(true)}>
          Plan a survey
        </Button>
      </div>
    );

  const d = plan.data;
  return (
    <section
      aria-label="Verify next"
      className="mb-4 space-y-3 rounded-lg border border-edge bg-raised p-3 text-sm"
    >
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-fg">Verify next · survey plan</h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="min-h-11 rounded px-2 text-fg-soft hover:bg-surface"
        >
          Close
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <label className="flex flex-col gap-1 text-xs text-fg-soft">
          Who
          <select
            value={profile}
            onChange={(e) => setProfile(e.target.value as Profile)}
            className="min-h-11 rounded border border-edge bg-surface px-2 text-sm text-fg"
          >
            {PROFILES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-fg-soft">
          Journeys
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as "evacuation" | "suite")}
            className="min-h-11 rounded border border-edge bg-surface px-2 text-sm text-fg"
          >
            <option value="evacuation">To nearest centre</option>
            <option value="suite">Everyday trips</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-fg-soft">
          Checks
          <select
            value={budget}
            onChange={(e) => setBudget(Number(e.target.value))}
            className="min-h-11 rounded border border-edge bg-surface px-2 text-sm text-fg"
          >
            {[5, 10, 15, 25, 40].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>
      {plan.isFetching && <p className="text-fg-soft">Planning on the township model…</p>}
      {plan.isError && <p role="alert">{(plan.error as Error).message}</p>}
      {d && !plan.isFetching && (
        <>
          <p role="note" className="rounded border border-dashed border-lilac p-2 text-fg">
            {d.facts.length === 0
              ? "No set of checks within this budget would confirm a sample journey."
              : `If these ${d.facts.length} checks at ${plural(
                  groupBySite(d.facts).length,
                  "place",
                )} pass, ${d.summary.confirmed_after ?? 0} of ${
                  d.summary.total ?? 0
                } sample journeys would have a confirmed route (today: ${
                  d.summary.confirmed_before ?? 0
                }).`}
          </p>
          <ol className="space-y-1">
            {groupBySite(d.facts).map((g, i) => (
              <li key={g.elementId} className="flex min-h-11 items-center justify-between gap-2">
                <span className="text-fg">
                  {i + 1}. {g.where}: check {g.checks.join(", ")}
                  <span className="text-fg-soft">
                    {" "}
                    · needed by {plural(g.journeys, "sample journey")}
                  </span>
                </span>
                {g.ticketIds[0] ? (
                  <button
                    type="button"
                    onClick={() => onTicket(g.ticketIds[0] as string)}
                    className="min-h-11 shrink-0 rounded border border-edge px-2 text-xs text-fg hover:border-accent"
                  >
                    Open ticket
                  </button>
                ) : null}
              </li>
            ))}
          </ol>
          <p className="text-xs text-fg-soft">{d.disclaimer}</p>
        </>
      )}
    </section>
  );
}
