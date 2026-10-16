import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { PHOTO_ACCEPT, validatePhoto } from "../../lib/evidence";
import { Button } from "../../ui/Button";
import { optionLabel, specFor } from "./attributeCatalogue";
import { parseValue } from "./attributeForm";
import { ApiError, type ResolveBody, resolveVR, uploadEvidence } from "./manageApi";
import { PHOTO_PRIVACY_NOTE, photoAfterAction } from "./resolveForm";
import { StaffAccess } from "./StaffAccess";
import type { Ticket } from "./ticketModel";
import { useStaffToken } from "./useStaffToken";

type Outcome = ResolveBody["action"];

const DEFAULT_NOTE = "Checked on site";
const NEEDS_STAFF = "Staff access needed";
const ALREADY = "Someone else already resolved this ticket.";

const NUMBER_HINTS: Record<string, string> = {
  step_count: "e.g. 0",
  step_height_cm: "e.g. 4",
  incline_pct: "e.g. 5",
  width_m: "e.g. 1.2",
};
const TEXT_HINTS: Record<string, string> = {
  opening_hours: "e.g. 9am to 5pm, Mon to Sat",
  name: "e.g. Dewan Komuniti",
};

/** Placeholder that matches what the field accepts: numeric for number attributes. */
function hintFor(attribute: string): string {
  const kind = specFor(attribute, null).kind;
  if (kind === "number") return NUMBER_HINTS[attribute] ?? "e.g. 2";
  return TEXT_HINTS[attribute] ?? "Enter the value";
}

export function OutcomeForm({ ticket, onSaved }: { ticket: Ticket; onSaved?: () => void }) {
  const qc = useQueryClient();
  const [token, setToken] = useStaffToken();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Latched so the field does not vanish while the token is being typed.
  const [showAccess, setShowAccess] = useState(!token);
  const spec = specFor(ticket.attribute, null);

  useEffect(() => {
    if (!photo || typeof URL.createObjectURL !== "function") {
      setPhotoUrl(null);
      return;
    }
    const u = URL.createObjectURL(photo);
    setPhotoUrl(u);
    return () => URL.revokeObjectURL?.(u);
  }, [photo]);

  const choose = (o: Outcome) => {
    setOutcome(o);
    setPhoto((p) => photoAfterAction(o, p));
    if (o === "reject") setPhotoError(null);
    setError(null);
  };

  const parsed = outcome === "correct" ? parseValue(spec.kind, value) : undefined;
  const valueOk =
    outcome !== "correct" ||
    (parsed !== null && (spec.kind !== "enum" || spec.options.includes(value.trim())));
  const canSave = !!outcome && valueOk && !!token && !saving;

  const save = async () => {
    if (!outcome || !canSave) return;
    setSaving(true);
    setError(null);
    try {
      const body: ResolveBody = { action: outcome, note: note.trim() || DEFAULT_NOTE };
      if (outcome === "correct" && parsed !== null && parsed !== undefined) body.value = parsed;
      const file = photoAfterAction(outcome, photo);
      if (file) body.evidence_id = (await uploadEvidence(file, token)).evidence_id;
      await resolveVR(ticket.id, body, token);
      await qc.invalidateQueries({ queryKey: ["tickets"] });
      onSaved?.();
    } catch (e) {
      const status = e instanceof ApiError ? e.status : undefined;
      if (status === 401 || status === 403 || status === 503) {
        setShowAccess(true);
        setError(NEEDS_STAFF);
      } else if (status === 409) {
        setError(ALREADY);
        void qc.invalidateQueries({ queryKey: ["tickets"] });
      } else if (status === 413) {
        setError("The photo is over the 5 MB limit.");
      } else {
        setError("Could not save. Please try again.");
      }
    } finally {
      setSaving(false);
    }
  };

  const options: { id: Outcome; label: string; desc: string }[] = [
    ...(ticket.hasCurrent
      ? [{ id: "verify" as const, label: "Confirm", desc: "It's right as recorded" }]
      : []),
    ticket.hasCurrent
      ? { id: "correct", label: "Correct", desc: "It's different. Enter the value" }
      : { id: "correct", label: "Record what you found", desc: "Enter what is there" },
    { id: "reject", label: "Reject", desc: "The ticket isn't valid" },
  ];

  const field =
    "mt-1 min-h-11 w-full rounded-lg border border-edge bg-surface px-3 text-sm text-fg";

  return (
    <div>
      {showAccess && <StaffAccess token={token} setToken={setToken} />}
      <h3 className="text-base font-semibold text-fg">What did you find on site?</h3>
      <div role="radiogroup" aria-label="Outcome" className="mt-3 grid gap-2 sm:grid-cols-3">
        {options.map((o) => {
          const on = outcome === o.id;
          return (
            // biome-ignore lint/a11y/useSemanticElements: card-style radio buttons with a description
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => choose(o.id)}
              className={`min-h-16 rounded-lg border p-3 text-left text-sm transition ${
                on ? "border-accent bg-accent text-on-accent" : "border-edge bg-surface text-fg"
              }`}
            >
              <span className="block font-semibold">{o.label}</span>
              <span className={`block text-xs ${on ? "" : "text-fg-soft"}`}>{o.desc}</span>
            </button>
          );
        })}
      </div>

      {outcome === "correct" && (
        <div className="mt-3">
          <label htmlFor="outcome-value" className="block text-sm font-semibold text-fg">
            Value found on site
          </label>
          {spec.kind === "enum" || spec.kind === "boolean" ? (
            <select
              id="outcome-value"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className={field}
            >
              <option value="">Choose</option>
              {(spec.kind === "boolean" ? ["yes", "no"] : spec.options).map((o) => (
                <option key={o} value={o}>
                  {optionLabel(o)}
                </option>
              ))}
            </select>
          ) : (
            <input
              id="outcome-value"
              type="text"
              inputMode={spec.kind === "number" ? "decimal" : "text"}
              value={value}
              placeholder={hintFor(ticket.attribute)}
              onChange={(e) => setValue(e.target.value)}
              className={field}
            />
          )}
        </div>
      )}

      <div className="mt-3">
        <label htmlFor="outcome-note" className="block text-sm font-semibold text-fg">
          Note (optional)
        </label>
        <input
          id="outcome-note"
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className={field}
        />
      </div>

      {outcome !== "reject" && (
        <div className="mt-3">
          <label
            htmlFor="outcome-photo"
            className="inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-edge px-4 text-sm font-semibold text-fg"
          >
            {photo ? "Change photo" : "Add photo"}
          </label>
          <input
            id="outcome-photo"
            type="file"
            accept={PHOTO_ACCEPT}
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              const msg = validatePhoto(f);
              setPhotoError(msg);
              setPhoto(msg ? null : f);
            }}
          />
          {photoError && <p className="mt-1 text-sm text-fg">{photoError}</p>}
          {photoUrl && (
            <img src={photoUrl} alt="Chosen evidence preview" className="mt-2 h-24 rounded-lg" />
          )}
          <p className="mt-1 text-xs text-fg-soft">{PHOTO_PRIVACY_NOTE}</p>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-fg">
          {error}
        </p>
      )}
      <Button className="mt-4" disabled={!canSave} onClick={() => void save()}>
        Save result
      </Button>
    </div>
  );
}
