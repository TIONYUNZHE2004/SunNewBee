import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { impactLines, reachLine } from "./impactModel";

/** What this check would change (open ticket) or changed (resolved), by rollout on the township
 * world model. Staff-facing planning estimate; residents never see these numbers. The ticket's
 * state is in the query key, so resolving a ticket never leaves a stale "would" card. */
export function ImpactCard({ ticketId, isOpen }: { ticketId: string; isOpen: boolean }) {
  const q = useQuery({
    queryKey: ["ticket-impact", ticketId, isOpen],
    staleTime: 30_000,
    retry: false,
    queryFn: async () => {
      const r = await api.GET("/verification-requests/{vr_id}/impact", {
        params: { path: { vr_id: ticketId } },
      });
      if (!r.data) throw new Error(r.response.status === 503 ? "busy" : "no impact");
      return r.data;
    },
  });
  if (q.isPending)
    return (
      <p role="status" className="mt-4 text-xs text-fg-soft">
        Checking what this would change on the model…
      </p>
    );
  if (q.isError)
    return q.error.message === "busy" ? (
      <p role="status" className="mt-4 text-xs text-fg-soft">
        The township model is busy, so the impact is not shown yet.{" "}
        <button type="button" onClick={() => q.refetch()} className="underline">
          Try again
        </button>
      </p>
    ) : null;
  const d = q.data;
  const l = impactLines(d);
  if (!l)
    return (
      <>
        {!isOpen && d.note ? <p className="mt-4 text-xs text-fg-soft">{d.note}</p> : null}
        <Reach ticketId={ticketId} />
      </>
    );
  return (
    <>
      <section
        aria-label="What this check changes"
        className="mt-4 space-y-2 rounded-lg border border-dashed border-lilac bg-raised p-3 text-sm"
      >
        <h3 className="text-xs font-semibold uppercase tracking-wide text-lilac">{l.title}</h3>
        <p className="text-fg">{l.headline}</p>
        <p className="text-xs text-fg-soft">{l.sample}</p>
        {l.own && <p className="text-fg-soft">{l.own}</p>}
        {l.belief && <p className="text-xs text-fg-soft">{l.belief}</p>}
      </section>
      <Reach ticketId={ticketId} />
    </>
  );
}

/** Who the ticket's path or place matters to, from the weekday rehearsal (Cycle 23). */
function Reach({ ticketId }: { ticketId: string }) {
  const q = useQuery({
    queryKey: ["ticket-reach", ticketId],
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const r = await api.GET("/verification-requests/{vr_id}/reach", {
        params: { path: { vr_id: ticketId }, query: { day: "weekday" } },
      });
      if (!r.data) throw new Error("no reach");
      return r.data;
    },
  });
  const l = reachLine(q.data);
  if (!l) return null;
  return (
    <section
      aria-label="Who this check matters to"
      className="mt-3 space-y-1 rounded-lg border border-dashed border-lilac bg-raised p-3 text-sm"
    >
      <h3 className="text-xs font-semibold uppercase tracking-wide text-lilac">{l.title}</h3>
      <p className="text-fg">{l.text}</p>
      {l.who && <p className="text-fg-soft">{l.who}</p>}
      <p className="text-xs text-fg-soft">
        Synthetic residents on the township model, not real people and not a forecast. Their trips
        may use unchecked paths, as residents do: this check confirms or rules out a stretch they
        rely on.
      </p>
    </section>
  );
}
