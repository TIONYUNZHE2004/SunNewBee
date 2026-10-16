import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { plural } from "../whatif/whatifModel";

const STATUS: Record<string, string> = {
  confirmed: "confirmed",
  partly_unverified: "partly unverified",
  blocked: "blocked",
  no_data: "no mapped connection",
};
const word = (s?: string) => (s ? (STATUS[s] ?? s.replace(/_/g, " ")) : "—");

/** What this check would change (open ticket) or changed (resolved), by rollout on the township
 * world model. Staff-facing planning estimate; residents never see these numbers. */
export function ImpactCard({ ticketId }: { ticketId: string }) {
  const q = useQuery({
    queryKey: ["ticket-impact", ticketId],
    staleTime: 30_000,
    retry: false,
    queryFn: async () => {
      const r = await api.GET("/verification-requests/{vr_id}/impact", {
        params: { path: { vr_id: ticketId } },
      });
      if (!r.data) throw new Error("no impact");
      return r.data;
    },
  });
  if (q.isPending)
    return <p className="text-xs text-fg-soft">Checking what this would change on the model…</p>;
  if (q.isError || !q.data) return null;
  const d = q.data;
  if (d.mode === "none") return null;
  const own = d.own;
  return (
    <section
      aria-label="What this check changes"
      className="mt-4 space-y-2 rounded-lg border border-dashed border-lilac bg-raised p-3 text-sm"
    >
      <h3 className="text-xs font-semibold uppercase tracking-wide text-lilac">
        {d.mode === "would" ? "What this check would change" : "What this check changed"}
      </h3>
      {d.mode === "would" ? (
        <p className="text-fg">
          If it passes, {plural(d.became_confirmed ?? 0, "sampled journey")} of {d.sampled} would
          become confirmed; if it fails, {d.lost_route ?? 0} would lose their route.
        </p>
      ) : (
        <p className="text-fg">
          This check changed {plural(d.changed ?? 0, "sampled journey")} of {d.sampled} (compared
          with leaving it unchecked); {d.became_confirmed ?? 0} became confirmed.
        </p>
      )}
      {own && (
        <p className="text-fg-soft">
          The question this came from ({own.from_name} → {own.to_name}):{" "}
          {d.mode === "would"
            ? `now ${word(own.statuses.now)}; if it passes ${word(own.statuses.pass)}${
                own.statuses.pass !== "confirmed" && d.own_other_checks
                  ? ` (${plural(d.own_other_checks, "other unchecked fact")} still on that route)`
                  : ""
              }; if it fails ${word(own.statuses.fail)}.`
            : `before ${word(own.statuses.before)}, now ${word(own.statuses.now)}.`}
        </p>
      )}
      {typeof d.belief_q === "number" && (
        <p className="text-xs text-fg-soft">
          Model estimate that a fact like this passes: {Math.round(d.belief_q * 100)}%
          {typeof d.belief_q_before === "number"
            ? ` (was ${Math.round(d.belief_q_before * 100)}% before this check)`
            : ""}
          . {d.note}
        </p>
      )}
    </section>
  );
}
