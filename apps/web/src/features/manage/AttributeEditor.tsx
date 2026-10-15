import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import type { ClaimRow } from "../places/placeModel";
import { specFor } from "../tickets/attributeCatalogue";
import {
  type AttrForm,
  EDIT_STATUSES,
  type EditStatus,
  errorMessage,
  initialAttrForm,
  optionLabel,
  SOURCE_TYPES,
  toPayload,
  validate,
} from "../tickets/attributeForm";
import { ApiError, saveAttribute } from "../tickets/manageApi";

const inputCls =
  "min-h-11 w-full rounded-md border border-line bg-card px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60";

export function AttributeEditor({
  elementId,
  row,
  token,
  onClose,
  onSaved,
}: {
  elementId: string;
  row: ClaimRow;
  token: string;
  /** Called on Cancel; the parent returns focus to the Edit button. */
  onClose: () => void;
  /** Called after a successful save and refetch; the parent shows confirmation. */
  onSaved: () => void;
}) {
  const [form, setForm] = useState<AttrForm>(() => initialAttrForm(row.raw, row.status, row.attr));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const id = `ae-${elementId}-${row.attr}`;
  const invalid = validate(form);
  const isUnknown = form.status === "unknown";

  const set = <K extends keyof AttrForm>(k: K, v: AttrForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (invalid || saving) return;
    setSaving(true);
    setError(null);
    try {
      await saveAttribute(elementId, row.attr, toPayload(form), token);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["place", elementId] }),
        qc.invalidateQueries({ queryKey: ["layer"] }),
        qc.invalidateQueries({ queryKey: ["audit", elementId] }),
      ]);
      onSaved();
    } catch (err) {
      setError(
        err instanceof ApiError ? errorMessage(err.status, err.detail) : errorMessage(undefined),
      );
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      aria-label={`Edit ${row.label}`}
      className="mt-2 space-y-3 rounded-lg border border-line bg-brand-tint p-3"
    >
      <div>
        <label htmlFor={`${id}-s`} className="mb-1 block text-sm font-medium">
          Status
        </label>
        <select
          id={`${id}-s`}
          className={inputCls}
          value={form.status}
          disabled={saving}
          onChange={(e) => {
            const status = e.target.value as EditStatus;
            setForm((f) => ({ ...f, status, raw: status === "unknown" ? "" : f.raw }));
          }}
        >
          {EDIT_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor={`${id}-v`} className="mb-1 block text-sm font-medium">
          Value
        </label>
        {form.kind === "boolean" ? (
          <select
            id={`${id}-v`}
            className={inputCls}
            value={form.raw || "unknown"}
            disabled={saving || isUnknown}
            onChange={(e) => set("raw", e.target.value === "unknown" ? "" : e.target.value)}
          >
            <option value="yes">Yes</option>
            <option value="no">No</option>
            <option value="unknown">Unknown</option>
          </select>
        ) : form.kind === "enum" ? (
          <select
            id={`${id}-v`}
            className={inputCls}
            value={form.raw}
            disabled={saving || isUnknown}
            onChange={(e) => set("raw", e.target.value)}
          >
            <option value="">Choose a value…</option>
            {specFor(row.attr, null).options.map((o) => (
              <option key={o} value={o}>
                {optionLabel(o)}
              </option>
            ))}
          </select>
        ) : (
          <input
            id={`${id}-v`}
            className={inputCls}
            type={form.kind === "number" ? "number" : "text"}
            step={form.kind === "number" ? "any" : undefined}
            inputMode={form.kind === "number" ? "decimal" : undefined}
            value={form.raw}
            disabled={saving || isUnknown}
            aria-describedby={isUnknown ? `${id}-vh` : undefined}
            onChange={(e) => set("raw", e.target.value)}
          />
        )}
        {isUnknown && (
          <p id={`${id}-vh`} className="mt-1 text-xs text-ink-soft">
            Unknown clears the value.
          </p>
        )}
      </div>

      <div>
        <label htmlFor={`${id}-t`} className="mb-1 block text-sm font-medium">
          Source type
        </label>
        <select
          id={`${id}-t`}
          className={inputCls}
          required
          value={form.sourceType}
          disabled={saving}
          onChange={(e) => set("sourceType", e.target.value)}
        >
          <option value="">Choose a source…</option>
          {SOURCE_TYPES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor={`${id}-n`} className="mb-1 block text-sm font-medium">
          Note (optional)
        </label>
        <input
          id={`${id}-n`}
          className={inputCls}
          value={form.note}
          disabled={saving}
          onChange={(e) => set("note", e.target.value)}
        />
      </div>

      {error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!!invalid || saving}
          className="min-h-11 rounded-md bg-brand px-4 text-sm font-medium text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          {saving ? "Saving…" : "Save"}
          <span className="sr-only"> {row.label}</span>
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="min-h-11 rounded-md border border-line bg-card px-4 text-sm disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-brand"
        >
          Cancel<span className="sr-only"> editing {row.label}</span>
        </button>
      </div>
    </form>
  );
}
