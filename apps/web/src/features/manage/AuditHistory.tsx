import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, type AuditClaim, type AuditRow, fetchAudit } from "./manageApi";

function fmt(c: AuditClaim): string {
  if (!c) return "none";
  const v = c.value;
  const val =
    v === null || v === undefined ? "unknown" : v === true ? "Yes" : v === false ? "No" : String(v);
  return `${val} (${c.status ?? "unknown"})`;
}

function Rows({ rows }: { rows: AuditRow[] }) {
  return (
    <ol className="space-y-2" aria-label="Edit history, newest first">
      {rows.map((r) => (
        <li key={r.id} className="rounded-md border border-line bg-card px-3 py-2 text-sm">
          <p className="font-medium">
            {r.attribute.replace(/_/g, " ")}: {fmt(r.old)} <span aria-hidden="true">→</span>
            <span className="sr-only"> changed to </span> {fmt(r.new)}
          </p>
          <p className="text-xs text-ink-soft">
            <time dateTime={r.at}>{new Date(r.at).toLocaleString()}</time> · {r.actor} · {r.reason}
            {r.note ? ` · ${r.note}` : ""}
          </p>
        </li>
      ))}
    </ol>
  );
}

/** Disclosure listing audit rows for one element. Fetches only when opened. */
export function AuditHistory({ elementId, token }: { elementId: string; token: string }) {
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["audit", elementId],
    enabled: open,
    retry: false,
    queryFn: () => fetchAudit(elementId, token),
  });
  const status = q.error instanceof ApiError ? q.error.status : undefined;

  return (
    <section className="mt-4">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="audit-panel"
        onClick={() => setOpen(!open)}
        className="min-h-11 w-full rounded-lg border border-line bg-card px-4 text-left text-sm font-medium focus-visible:outline-2 focus-visible:outline-brand"
      >
        History
      </button>
      {open && (
        <div id="audit-panel" className="mt-2">
          {q.isPending ? (
            <p role="status" className="text-sm text-ink-soft">
              Loading history…
            </p>
          ) : q.isError ? (
            <p role="alert" className="text-sm">
              {status === 401 || status === 503
                ? "Staff token required or invalid."
                : "History unavailable."}{" "}
              <button type="button" className="underline" onClick={() => q.refetch()}>
                Retry
              </button>
            </p>
          ) : q.data.length === 0 ? (
            <p className="text-sm text-ink-soft">No edits recorded yet</p>
          ) : (
            <Rows rows={q.data} />
          )}
        </div>
      )}
    </section>
  );
}
