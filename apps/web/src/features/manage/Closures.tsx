import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { ApiError, createClosure, endClosure, fetchClosures } from "../tickets/manageApi";
import { useStaffToken } from "../tickets/useStaffToken";
import {
  buildCreateBody,
  CLOSURE_REASONS,
  CLOSURE_SOURCE,
  type Closure,
  type ClosureFields,
  closureDate,
  closureState,
  EMPTY_FIELDS,
  TZ_NAME,
} from "./closureModel";

const inputCls = "min-h-11 w-full rounded-md border border-line bg-card px-3 text-sm";
const btnCls =
  "min-h-11 rounded-md bg-brand px-4 text-sm font-medium text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50";

export const closuresKey = ["manage", "closures"] as const;

export function closureError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401 || err.status === 503) return "Staff token required or not configured";
    if (err.status === 404) return err.detail ?? "That element or closure no longer exists";
    if (err.status === 409) return "That closure has already ended";
    if (err.status === 422) return err.detail ?? "Check the form and try again";
  }
  return "The change could not be saved. Please try again.";
}

type PlaceHit = { id: string; name: string };

/** Place search (public GET /places) that fills the element id. */
function PlacePicker({ onPick }: { onPick: (p: PlaceHit) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<PlaceHit[] | null>(null);
  const [failed, setFailed] = useState(false);
  async function search() {
    setFailed(false);
    if (!q.trim()) return setHits(null);
    try {
      const r = await fetch(`/api/places?q=${encodeURIComponent(q.trim())}`);
      if (!r.ok) throw new Error(String(r.status));
      const j = (await r.json()) as { data?: PlaceHit[] };
      setHits(j.data ?? []);
    } catch {
      setFailed(true);
    }
  }
  return (
    <div>
      <label htmlFor="cl-search" className="mb-1 block text-sm font-medium">
        Search places
      </label>
      <div className="flex gap-2">
        <input
          id="cl-search"
          className={inputCls}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void search();
            }
          }}
        />
        <button
          type="button"
          onClick={() => void search()}
          className="min-h-11 rounded-md border border-brand px-4 text-sm font-medium text-brand hover:bg-brand-tint"
        >
          Search
        </button>
      </div>
      {failed && (
        <p role="alert" className="mt-1 text-sm text-ink">
          Search failed. Enter the element id instead.
        </p>
      )}
      {hits && (
        <ul aria-label="Place results" className="mt-2 flex flex-wrap gap-2">
          {hits.length === 0 && <li className="text-sm text-ink-soft">No matching places</li>}
          {hits.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(h);
                  setHits(null);
                }}
                className="min-h-11 rounded-md border border-line bg-card px-3 text-sm hover:bg-brand-tint"
              >
                {h.name}
                <span className="sr-only"> ({h.id})</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ClosureForm({ token, onCreated }: { token: string; onCreated?: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState<ClosureFields>(EMPTY_FIELDS);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const set = (patch: Partial<ClosureFields>) => setF((p) => ({ ...p, ...patch }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setDone(null);
    const built = buildCreateBody(f);
    if ("error" in built) return setError(built.error);
    setError(null);
    setBusy(true);
    try {
      const c = await createClosure(built.body, token);
      await qc.invalidateQueries({ queryKey: closuresKey });
      await qc.invalidateQueries({ queryKey: ["layer"] });
      setF(EMPTY_FIELDS);
      setPicked(null);
      setDone(`Closure reported for ${c.element_name ?? c.element_id}.`);
      onCreated?.();
    } catch (err) {
      setError(closureError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      aria-label="Report a closure"
      className="space-y-3 rounded-lg border border-line bg-card p-4"
    >
      <h3 className="text-lg font-semibold">Report a closure</h3>
      <PlacePicker
        onPick={(p) => {
          set({ elementId: p.id });
          setPicked(p.name);
        }}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="cl-el" className="mb-1 block text-sm font-medium">
            Element id
          </label>
          <input
            id="cl-el"
            className={inputCls}
            value={f.elementId}
            onChange={(e) => {
              set({ elementId: e.target.value });
              setPicked(null);
            }}
            aria-describedby="cl-el-help"
          />
          <p id="cl-el-help" className="mt-1 text-xs text-ink-soft">
            {picked ? `Selected: ${picked}` : "A path segment or place id, or pick one above."}
          </p>
        </div>
        <div>
          <label htmlFor="cl-reason" className="mb-1 block text-sm font-medium">
            Reason
          </label>
          <select
            id="cl-reason"
            className={inputCls}
            value={f.reason}
            onChange={(e) => set({ reason: e.target.value })}
          >
            {CLOSURE_REASONS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="cl-start" className="mb-1 block text-sm font-medium">
            Starts ({TZ_NAME})
          </label>
          <input
            id="cl-start"
            type="datetime-local"
            className={inputCls}
            value={f.startsAt}
            onChange={(e) => set({ startsAt: e.target.value })}
          />
          <p className="mt-1 text-xs text-ink-soft">
            Times are Malaysia time (Asia/Kuala_Lumpur). Leave empty to start now.
          </p>
        </div>
        <div>
          <label htmlFor="cl-end" className="mb-1 block text-sm font-medium">
            Ends ({TZ_NAME})
          </label>
          <input
            id="cl-end"
            type="datetime-local"
            className={inputCls}
            value={f.endsAt}
            onChange={(e) => set({ endsAt: e.target.value })}
          />
          <p className="mt-1 text-xs text-ink-soft">Leave empty for further notice.</p>
        </div>
      </div>
      <div>
        <label htmlFor="cl-note" className="mb-1 block text-sm font-medium">
          Note (optional)
        </label>
        <input
          id="cl-note"
          className={inputCls}
          maxLength={300}
          value={f.note}
          onChange={(e) => set({ note: e.target.value })}
        />
        <p className="mt-1 text-xs text-ink-soft">
          Shown publicly as a staff report. Do not include personal details.
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm font-medium text-ink">
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="text-sm font-medium text-ink">
          {done}
        </p>
      )}
      <button type="submit" disabled={busy || !token} className={btnCls}>
        {busy ? "Saving…" : "Report closure"}
      </button>
      {!token && <p className="text-xs text-ink-soft">Enter the staff token above to save.</p>}
    </form>
  );
}

const STATE_LABEL = { active: "Active", scheduled: "Scheduled", ended: "Ended" } as const;

export function ClosureList({
  items,
  token,
  onEnded,
}: {
  items: Closure[];
  token: string;
  onEnded?: () => void;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function end(c: Closure) {
    setBusy(c.id);
    setError(null);
    try {
      await endClosure(c.id, token);
      await qc.invalidateQueries({ queryKey: closuresKey });
      await qc.invalidateQueries({ queryKey: ["layer"] });
      onEnded?.();
    } catch (err) {
      setError(closureError(err));
      if (err instanceof ApiError && err.status === 409)
        await qc.invalidateQueries({ queryKey: closuresKey });
    } finally {
      setBusy(null);
    }
  }
  if (items.length === 0) return <p className="text-ink-soft">No closures reported.</p>;
  return (
    <>
      {error && (
        <p role="alert" className="mb-2 text-sm font-medium text-ink">
          {error}
        </p>
      )}
      <ul aria-label="Closures" className="space-y-2">
        {items.map((c) => {
          const st = closureState(c);
          return (
            <li
              key={c.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-line bg-card px-4 py-3"
            >
              <div className="text-sm">
                <p className="font-medium">
                  {c.element_name ?? c.element_id}{" "}
                  <span className="rounded border border-line px-1.5 py-0.5 text-xs font-normal">
                    {STATE_LABEL[st]}
                  </span>
                </p>
                <p>{c.label}</p>
                <p className="text-ink-soft">
                  {CLOSURE_SOURCE}. From {closureDate(c.starts_at)}
                  {c.ends_at ? ` to ${closureDate(c.ends_at)}` : ", until further notice"}.
                </p>
                {c.note && <p className="text-ink-soft">Note: {c.note}</p>}
                <p className="text-xs text-ink-soft">
                  {c.element_id} ({c.id})
                </p>
              </div>
              {st !== "ended" && (
                <button
                  type="button"
                  disabled={!token || busy === c.id}
                  onClick={() => void end(c)}
                  className="min-h-11 rounded-md border border-brand px-4 text-sm font-medium text-brand hover:bg-brand-tint disabled:cursor-not-allowed disabled:opacity-50"
                >
                  End now<span className="sr-only"> {c.element_name ?? c.element_id}</span>
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** Management tab: staff-reported closures. They are reports, not verified facts. */
export function Closures() {
  const [token, setToken] = useStaffToken();
  const q = useQuery({
    queryKey: [...closuresKey, Boolean(token)],
    queryFn: async () => {
      const [now, other] = await Promise.all([
        fetchClosures(true, token || undefined),
        fetchClosures(false, token || undefined),
      ]);
      return [...now, ...other];
    },
  });
  const items = q.data ?? [];
  return (
    <section aria-labelledby="cl-h" className="space-y-4">
      <div>
        <h2 id="cl-h" className="text-xl font-semibold">
          Closures
        </h2>
        <p className="text-sm text-ink-soft">
          A closure marks a path or place as not passable for everyone while it is in force. It is a
          staff report, shown to residents as "{CLOSURE_SOURCE}".
        </p>
      </div>
      <div className="max-w-sm">
        <label htmlFor="cl-token" className="mb-1 block text-sm font-medium">
          Staff token
        </label>
        <input
          id="cl-token"
          type="password"
          autoComplete="off"
          className={inputCls}
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
      </div>
      <ClosureForm token={token} />
      {q.isPending ? (
        <p role="status" className="text-ink-soft">
          Loading…
        </p>
      ) : q.isError ? (
        <div role="alert" className="rounded-lg border border-line bg-danger-tint p-3 text-sm">
          <p className="font-medium">We could not load the closures.</p>
          <button type="button" onClick={() => q.refetch()} className={`${btnCls} mt-2`}>
            Retry
          </button>
        </div>
      ) : (
        <ClosureList items={items} token={token} />
      )}
    </section>
  );
}
