import { forwardRef } from "react";
import { RESIDENT_BACK, RESIDENT_FACTS_HEAD, RESIDENT_PHASES, RESIDENT_SIDE_LONG } from "../copy";
import { BADGE_STYLE } from "../EndCard";
import type { ResidentWalk, SimResident, WalkValue } from "../planTypes";
import { Avatar } from "./Avatar";

/** "Simulated reactions" chip: the end card's SIMULATED pair (≥ 4.5:1, readable in both skins). */
export const SIM_TAG = BADGE_STYLE.SIMULATED;
export const SIM_TAG_CLASS =
  "inline-block rounded-md px-1.5 text-[10px] font-extrabold uppercase tracking-wide";

/** How a walk's value reads (honesty: unknown is "not checked", a gap is a data gap). */
export function walkValueText(v: WalkValue): string {
  if (typeof v === "number") return `${v} min`;
  if (v === "?") return "? Not checked yet";
  if (v === "gap") return "No mapped connection (data gap)";
  return "No route past a known barrier";
}

const walkRow = (w: ResidentWalk) => `${w.label}: ${walkValueText(w.value)}`;

/** The construction-detour fact, for neighbours only (null for the tower). */
export function extraWalkText(r: SimResident): string | null {
  if (r.side !== "neighbour") return null;
  const n = r.facts.extra_walk_min ?? 0;
  if (n <= 0) return "Extra walk during construction: none";
  const to = r.facts.extra_walk_to ? ` to ${r.facts.extra_walk_to}` : "";
  return `Extra walk during construction: ${n} min${to}`;
}

/**
 * One simulated resident (prototype `#detail`; spec D10, D11, AC-W7): back to the list, name, role
 * and side with "Simulated reactions", the facts block (their own routing-engine facts), the three
 * phase lines and the footnote. Every string comes from the plan's residents payload.
 */
export const ResidentDetail = forwardRef<
  HTMLButtonElement,
  { resident: SimResident; total: number; label: string; note: string; onBack: () => void }
>(function ResidentDetail({ resident: r, total, label, note, onBack }, backRef) {
  const extra = extraWalkText(r);
  const headingId = `devsim-resident-${r.id}`;
  return (
    <article
      aria-labelledby={headingId}
      data-testid="devsim-resident-detail"
      data-resident={r.id}
      className="mt-2 rounded-2xl bg-raised px-3 py-2.5 text-[13px] leading-[1.45]"
    >
      <button
        ref={backRef}
        type="button"
        onClick={onBack}
        data-testid="devsim-resident-back"
        className="mb-1 cursor-pointer border-0 bg-transparent p-0 text-xs font-extrabold text-fg-soft hover:text-fg focus-visible:outline-2"
      >
        <span aria-hidden="true">{"← "}</span>
        {RESIDENT_BACK(total)}
      </button>
      <div className="flex items-center gap-2">
        <Avatar colour={r.colour} name={r.name} />
        <h4 id={headingId} className="m-0 text-[15px] font-bold">
          {r.name}
        </h4>
      </div>
      <p className="m-0 mb-1.5 text-xs text-fg-soft">
        {r.role} · {RESIDENT_SIDE_LONG[r.side]}{" "}
        <span
          data-testid="devsim-resident-label"
          className={SIM_TAG_CLASS}
          style={{ background: SIM_TAG.bg, color: SIM_TAG.fg }}
        >
          {label}
        </span>
      </p>
      <div
        data-testid="devsim-resident-facts"
        className="rounded-xl px-2 py-1.5 text-xs"
        style={{ background: "#e3f4ec", color: "#1c1b19" }}
      >
        <b className="block">{RESIDENT_FACTS_HEAD}</b>
        <ul className="m-0 list-none p-0">
          {extra && <li>{extra}</li>}
          {r.facts.walks.map((w) => (
            <li key={w.kind}>{walkRow(w)}</li>
          ))}
        </ul>
        <span className="block text-[11px]">Route profile: {r.facts.profile}</span>
      </div>
      {RESIDENT_PHASES.map(([key, head]) => (
        <section
          key={key}
          data-testid="devsim-resident-phase"
          data-phase={key}
          className="my-1.5 rounded-xl bg-surface px-2 py-1.5"
        >
          <h5 className="m-0 text-[11px] font-bold uppercase tracking-wide text-fg-soft">{head}</h5>
          <p className="m-0">{r.lines[key]}</p>
        </section>
      ))}
      <p data-testid="devsim-resident-note" className="m-0 text-[11px] text-fg-soft">
        {note}
      </p>
    </article>
  );
});
