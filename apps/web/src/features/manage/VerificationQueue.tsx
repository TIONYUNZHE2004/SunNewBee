import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useReducer, useState } from "react";
import { ApiError, fetchOpenVRs, loadToken, resolveVR, saveToken, type VR } from "./manageApi";
import { errorMessage, formReducer, initialForm, needsValue, validateForm } from "./resolveForm";

const inputCls = "min-h-11 w-full rounded-md border border-line bg-card px-3 text-sm";
const btnCls =
  "min-h-11 rounded-md bg-brand px-4 text-sm font-medium text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50";

function ResolveForm({ vr, token, onDone }: { vr: VR; token: string; onDone: () => void }) {
  const [s, dispatch] = useReducer(formReducer, initialForm);
  const qc = useQueryClient();
  const id = `rf-${vr.id}`;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const invalid = validateForm(s);
    if (invalid) return dispatch({ type: "fail", message: invalid });
    dispatch({ type: "submit" });
    try {
      await resolveVR(
        vr.id,
        {
          action: s.action,
          ...(needsValue(s.action) ? { value: s.value.trim() } : {}),
          note: s.note.trim(),
        },
        token,
      );
      await qc.invalidateQueries({ queryKey: ["manage", "vrs"] });
      onDone();
    } catch (err) {
      dispatch({
        type: "fail",
        message: errorMessage(err instanceof ApiError ? err.status : undefined),
      });
    }
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-lg border border-line bg-brand-tint p-3"
      aria-label={`Resolve ${vr.element_id}`}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor={`${id}-a`} className="mb-1 block text-sm font-medium">
            Action
          </label>
          <select
            id={`${id}-a`}
            className={inputCls}
            value={s.action}
            disabled={s.status === "submitting"}
            onChange={(e) => dispatch({ type: "set", field: "action", v: e.target.value })}
          >
            <option value="verify">Verify (data is correct)</option>
            <option value="correct">Correct (set new value)</option>
            <option value="reject">Reject (not an issue)</option>
          </select>
        </div>
        {needsValue(s.action) && (
          <div>
            <label htmlFor={`${id}-v`} className="mb-1 block text-sm font-medium">
              Corrected value
            </label>
            <input
              id={`${id}-v`}
              className={inputCls}
              value={s.value}
              disabled={s.status === "submitting"}
              onChange={(e) => dispatch({ type: "set", field: "value", v: e.target.value })}
            />
          </div>
        )}
        <div className={needsValue(s.action) ? "" : "sm:col-span-2"}>
          <label htmlFor={`${id}-n`} className="mb-1 block text-sm font-medium">
            Note
          </label>
          <input
            id={`${id}-n`}
            className={inputCls}
            value={s.note}
            disabled={s.status === "submitting"}
            onChange={(e) => dispatch({ type: "set", field: "note", v: e.target.value })}
          />
        </div>
      </div>
      {s.error && (
        <p role="alert" className="text-sm font-medium text-[#9b1c1c]">
          {s.error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" className={btnCls} disabled={s.status === "submitting"}>
          {s.status === "submitting" ? "Saving…" : "Submit resolution"}
        </button>
        <button
          type="button"
          className="min-h-11 rounded-md border border-line bg-card px-4 text-sm"
          onClick={onDone}
          disabled={s.status === "submitting"}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export function VerificationQueue() {
  const q = useQuery({ queryKey: ["manage", "vrs"], queryFn: fetchOpenVRs, retry: false });
  const [token, setToken] = useState(loadToken);
  const [open, setOpen] = useState<string | null>(null);
  const rows = q.data ?? [];

  return (
    <section aria-labelledby="vq-h" className="space-y-4">
      <div>
        <h2 id="vq-h" className="text-xl font-semibold">
          Verification queue
        </h2>
        <p className="text-sm text-ink-soft">
          Gaps raised by resident questions and journey tests, ranked by demand.
        </p>
      </div>
      <div className="max-w-sm">
        <label htmlFor="staff-token" className="mb-1 block text-sm font-medium">
          Staff token
        </label>
        <input
          id="staff-token"
          type="password"
          autoComplete="off"
          className={inputCls}
          value={token}
          onChange={(e) => {
            setToken(e.target.value);
            saveToken(e.target.value);
          }}
        />
        <p className="mt-1 text-xs text-ink-soft">Kept for this browser session only.</p>
      </div>

      {q.isPending ? (
        <p role="status" className="text-sm text-ink-soft">
          Loading verification requests…
        </p>
      ) : q.isError ? (
        <p role="alert" className="text-sm">
          Verification requests unavailable.{" "}
          <button type="button" className="underline" onClick={() => q.refetch()}>
            Retry
          </button>
        </p>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-line bg-card p-4 text-sm">
          No open verification requests
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-card">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Open verification requests, highest demand first</caption>
            <thead className="bg-brand-tint">
              <tr>
                {["Demand", "Element", "Attribute", "Reason", "Created", "Action"].map((h) => (
                  <th key={h} scope="col" className="px-3 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((vr) => (
                <RowGroup
                  key={vr.id}
                  vr={vr}
                  open={open === vr.id}
                  token={token}
                  onToggle={() => setOpen(open === vr.id ? null : vr.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function RowGroup({
  vr,
  open,
  token,
  onToggle,
}: {
  vr: VR;
  open: boolean;
  token: string;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="border-t border-line align-top">
        <th scope="row" className="px-3 py-2 font-semibold">
          {vr.demand}
        </th>
        <td className="px-3 py-2">
          {vr.element_id}
          {vr.question_summary && (
            <span className="block text-xs text-ink-soft">{vr.question_summary}</span>
          )}
        </td>
        <td className="px-3 py-2">{vr.attribute}</td>
        <td className="px-3 py-2">{vr.reason.replaceAll("_", " ")}</td>
        <td className="px-3 py-2">{new Date(vr.created_at).toLocaleString()}</td>
        <td className="px-3 py-2">
          <button
            type="button"
            aria-expanded={open}
            className="min-h-11 rounded-md border border-brand px-3 text-brand hover:bg-brand-tint"
            onClick={onToggle}
          >
            {open ? "Close" : "Resolve"}
            <span className="sr-only">
              {" "}
              {vr.element_id} {vr.attribute}
            </span>
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={6} className="px-3 pb-3">
            <ResolveForm vr={vr} token={token} onDone={onToggle} />
          </td>
        </tr>
      )}
    </>
  );
}
