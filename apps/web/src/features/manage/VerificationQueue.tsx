import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useReducer, useState } from "react";
import { PHOTO_ACCEPT, validatePhoto } from "../../lib/evidence";
import { elementName } from "../chat/citationLabel";
import { GapMapLink } from "../gaps/GapMapLink";
import { attributeLabel, optionLabel, specFor } from "./attributeCatalogue";
import { onResolved, PhotoUploadError, submitResolution, uploadErrorMessage } from "./createVr";
import { ApiError, fetchVRs, resolveVR, uploadEvidence, type VR } from "./manageApi";
import {
  buildVrQuery,
  DEFAULT_FILTERS,
  type QueueTab,
  REASONS,
  TAB_LABELS,
  type VrFilters,
  vrQueryKey,
} from "./queueFilters";
import { reasonLabel } from "./queueLabels";
import {
  buildResolveBody,
  currentValueText,
  errorMessage,
  type FormState,
  formReducer,
  hasCurrentValue,
  initialFormFor,
  needsValue,
  PHOTO_PRIVACY_NOTE,
  PHOTO_REJECT_TEXT,
  photoAfterAction,
  photoAllowed,
  VERIFY_DISABLED_TEXT,
  validateForm,
} from "./resolveForm";
import { useQueueNames } from "./useQueueNames";
import { useStaffToken } from "./useStaffToken";

const inputCls = "min-h-11 w-full rounded-md border border-line bg-card px-3 text-sm";
const btnCls =
  "min-h-11 rounded-md bg-brand px-4 text-sm font-medium text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50";

export function ResolveForm({ vr, token, onDone }: { vr: VR; token: string; onDone: () => void }) {
  const [s, dispatch] = useReducer(formReducer, vr.current_value, initialFormFor);
  const qc = useQueryClient();
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoKey, setPhotoKey] = useState(0);
  const id = `rf-${vr.id}`;
  const canVerify = hasCurrentValue(vr.current_value);
  const spec = specFor(vr.attribute, null);
  const choices: [string, string][] | null =
    spec.kind === "boolean"
      ? [
          ["yes", "Yes"],
          ["no", "No"],
        ]
      : spec.kind === "enum"
        ? spec.options.map((o): [string, string] => [o, optionLabel(o)])
        : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const invalid =
      validateForm(s, vr.attribute) ?? validatePhoto(photoAfterAction(s.action, photo));
    if (invalid) return dispatch({ type: "fail", message: invalid });
    dispatch({ type: "submit" });
    try {
      await submitResolution(
        {
          upload: (f) => uploadEvidence(f, token),
          resolve: (b) => resolveVR(vr.id, b, token),
        },
        photoAfterAction(s.action, photo),
        buildResolveBody(s, vr.attribute),
      );
      await onResolved(qc);
      onDone();
    } catch (err) {
      if (err instanceof PhotoUploadError)
        return dispatch({ type: "fail", message: uploadErrorMessage(err) });
      // 409: someone else resolved it first, so drop the stale row.
      if (err instanceof ApiError && err.status === 409)
        await qc.invalidateQueries({ queryKey: ["manage", "vrs"] });
      dispatch({
        type: "fail",
        message: errorMessage(
          err instanceof ApiError ? err.status : undefined,
          err instanceof ApiError ? err.detail : undefined,
        ),
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
            onChange={(e) => {
              dispatch({ type: "set", field: "action", v: e.target.value });
              setPhoto((p) => photoAfterAction(e.target.value as FormState["action"], p));
              setPhotoKey((k) => k + 1);
            }}
          >
            <option value="verify" disabled={!canVerify}>
              Verify (data is correct)
            </option>
            <option value="correct">Correct (set new value)</option>
            <option value="reject">Reject (not an issue)</option>
          </select>
          {!canVerify && <p className="mt-1 text-xs text-ink-soft">{VERIFY_DISABLED_TEXT}</p>}
        </div>
        {needsValue(s.action) && (
          <div>
            <label htmlFor={`${id}-v`} className="mb-1 block text-sm font-medium">
              Corrected value
            </label>
            {choices ? (
              <select
                id={`${id}-v`}
                className={inputCls}
                value={s.value}
                disabled={s.status === "submitting"}
                onChange={(e) => dispatch({ type: "set", field: "value", v: e.target.value })}
              >
                <option value="">Choose…</option>
                {choices.map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={`${id}-v`}
                className={inputCls}
                inputMode={spec.kind === "number" ? "decimal" : undefined}
                value={s.value}
                disabled={s.status === "submitting"}
                onChange={(e) => dispatch({ type: "set", field: "value", v: e.target.value })}
              />
            )}
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
      {photoAllowed(s.action) ? (
        <div>
          <label htmlFor={`${id}-p`} className="mb-1 block text-sm font-medium">
            Photo evidence (optional)
          </label>
          <input
            key={photoKey}
            id={`${id}-p`}
            type="file"
            accept={PHOTO_ACCEPT}
            className="block w-full text-sm"
            aria-describedby={`${id}-p-help`}
            disabled={s.status === "submitting"}
            onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
          />
          <p id={`${id}-p-help`} className="mt-1 text-xs text-ink-soft">
            JPEG or PNG, up to 5 MB. {PHOTO_PRIVACY_NOTE}
          </p>
        </div>
      ) : (
        <p className="text-xs text-ink-soft">{PHOTO_REJECT_TEXT}</p>
      )}
      {s.error && (
        <p role="alert" className="text-sm font-medium text-danger">
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
  const [filters, setFilters] = useState<VrFilters>(DEFAULT_FILTERS);
  const q = useQuery({
    queryKey: vrQueryKey(filters),
    queryFn: () => fetchVRs(buildVrQuery(filters)),
    retry: false,
    placeholderData: keepPreviousData,
  });
  const set = (patch: Partial<VrFilters>) => setFilters({ ...filters, ...patch });
  const tabs = Object.keys(TAB_LABELS) as QueueTab[];
  const [token, setToken] = useStaffToken();
  const [open, setOpen] = useState<string | null>(null);
  const rows = q.data ?? [];
  const names = useQueueNames();

  return (
    <section aria-labelledby="vq-h" className="space-y-4">
      <div>
        <h2 id="vq-h" className="text-xl font-semibold">
          Verification queue
        </h2>
        <p className="text-sm text-ink-soft">
          Gaps raised by resident questions and journey tests, ranked by demand.
        </p>
        <div className="mt-2">
          <GapMapLink />
        </div>
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
          }}
        />
        <p className="mt-1 text-xs text-ink-soft">Kept for this browser session only.</p>
      </div>

      <fieldset aria-label="Request status" className="flex gap-2">
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={filters.tab === t}
            onClick={() => set({ tab: t })}
            className={`min-h-11 rounded-md border border-line px-4 text-sm font-medium ${filters.tab === t ? "bg-brand text-white" : "bg-card text-brand hover:bg-brand-tint"}`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="vq-reason" className="mb-1 block text-sm font-medium">
            Reason
          </label>
          <select
            id="vq-reason"
            className={inputCls}
            value={filters.reason}
            onChange={(e) => set({ reason: e.target.value })}
          >
            <option value="">All reasons</option>
            {REASONS.map((r) => (
              <option key={r} value={r}>
                {reasonLabel(r)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="vq-attr" className="mb-1 block text-sm font-medium">
            Attribute
          </label>
          <input
            id="vq-attr"
            className={inputCls}
            value={filters.attribute}
            onChange={(e) => set({ attribute: e.target.value })}
            placeholder="e.g. incline_pct"
          />
        </div>
        <div>
          <label htmlFor="vq-el" className="mb-1 block text-sm font-medium">
            Element id
          </label>
          <input
            id="vq-el"
            className={inputCls}
            value={filters.elementId}
            onChange={(e) => set({ elementId: e.target.value })}
          />
        </div>
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
          {filters.tab === "all"
            ? "No verification requests"
            : `No ${filters.tab} verification requests`}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-card">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Verification requests, highest demand first</caption>
            <thead className="bg-brand-tint">
              <tr>
                {[
                  "Demand",
                  "Element",
                  "Attribute",
                  "Current value",
                  "Reason",
                  "Created",
                  "Action",
                ].map((h) => (
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
                  names={names}
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
  names,
  onToggle,
}: {
  vr: VR;
  open: boolean;
  token: string;
  names: Map<string, string>;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="border-t border-line align-top">
        <th scope="row" className="px-3 py-2 font-semibold">
          {vr.demand}
        </th>
        <td className="px-3 py-2">
          {elementName(vr.element_id, names)}
          {elementName(vr.element_id, names) !== vr.element_id && (
            <span className="block text-xs text-ink-soft">{vr.element_id}</span>
          )}
          {vr.question_summary && (
            <span className="block text-xs text-ink-soft">{vr.question_summary}</span>
          )}
        </td>
        <td className="px-3 py-2">
          {attributeLabel(vr.attribute)}
          {attributeLabel(vr.attribute) !== vr.attribute && (
            <span className="block text-xs text-ink-soft">{vr.attribute}</span>
          )}
        </td>
        <td className="px-3 py-2">{currentValueText(vr.current_value)}</td>
        <td className="px-3 py-2">{reasonLabel(vr.reason)}</td>
        <td className="px-3 py-2">{new Date(vr.created_at).toLocaleString()}</td>
        <td className="px-3 py-2">
          {vr.status === "open" || vr.status === "in_progress" ? (
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
          ) : (
            <span>{vr.status.replaceAll("_", " ")}</span>
          )}
        </td>
      </tr>
      {open && (vr.status === "open" || vr.status === "in_progress") && (
        <tr>
          <td colSpan={7} className="px-3 pb-3">
            <ResolveForm vr={vr} token={token} onDone={onToggle} />
          </td>
        </tr>
      )}
    </>
  );
}
