import { type KeyboardEvent, useEffect, useRef } from "react";
import { RESIDENT_SIDE, RESIDENTS_BUTTON, RESIDENTS_SUB } from "../copy";
import type { SimResidents } from "../planTypes";
import { Avatar } from "./Avatar";
import { ResidentDetail, SIM_TAG, SIM_TAG_CLASS } from "./ResidentDetail";

export const RESIDENTS_PANEL_ID = "devsim-residents-panel";
const HEADING_ID = "devsim-residents-heading";

/**
 * Simulated residents panel (prototype `#resPanel`; spec D10, §6.2, AC-W7): a non-modal dialog with
 * a labelled heading, a 4-column list of resident buttons and one resident's detail. Escape and
 * Close call `onClose` (the layer returns focus to the button); Back returns to the list.
 * `focusOnOpen` moves focus in when the user opened it (a scripted open never steals focus).
 */
export function ResidentsPanel({
  data,
  selectedId,
  focusOnOpen,
  onSelect,
  onBack,
  onClose,
}: {
  data: SimResidents;
  selectedId: string | null;
  focusOnOpen: boolean;
  onSelect: (id: string) => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const items = useRef(new Map<string, HTMLButtonElement>());
  const lastSelected = useRef<string | null>(null);
  const residents = data.residents;
  const selected = residents.find((r) => r.id === selectedId) ?? null;
  const tower = residents.filter((r) => r.side === "tower").length;

  // Focus in on a user open (mount only).
  // biome-ignore lint/correctness/useExhaustiveDependencies: on open only
  useEffect(() => {
    if (focusOnOpen) headingRef.current?.focus();
  }, []);
  // Focus follows a user's navigation (never a scripted one): Back on a resident, their list item
  // on Back. The clicked control unmounts with the view, so the intent is recorded on click.
  const userNav = useRef(false);
  useEffect(() => {
    if (selectedId) lastSelected.current = selectedId;
    if (!userNav.current) return;
    userNav.current = false;
    if (selectedId) backRef.current?.focus();
    else if (lastSelected.current) items.current.get(lastSelected.current)?.focus();
  }, [selectedId]);
  const select = (id: string) => {
    userNav.current = true;
    onSelect(id);
  };
  const back = () => {
    userNav.current = true;
    onBack();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <div
      id={RESIDENTS_PANEL_ID}
      role="dialog"
      aria-modal="false"
      aria-labelledby={HEADING_ID}
      data-testid="devsim-residents-panel"
      data-beat="residents-panel"
      onKeyDown={onKeyDown}
      className="pointer-events-auto max-h-full w-[min(25rem,calc(100vw-2rem))] overflow-y-auto rounded-[18px] border border-edge bg-surface px-3.5 py-3 text-fg shadow-[0_4px_0_var(--c-edge),0_18px_40px_rgba(44,42,58,.25)]"
    >
      <div className="flex items-center justify-between">
        <h3
          ref={headingRef}
          id={HEADING_ID}
          tabIndex={-1}
          className="m-0 text-base font-bold focus-visible:outline-2"
        >
          {RESIDENTS_BUTTON(residents.length)}
        </h3>
        <button
          type="button"
          aria-label="Close"
          data-testid="devsim-residents-close"
          onClick={onClose}
          className="grid size-7 cursor-pointer place-items-center rounded-full border-0 bg-raised text-fg focus-visible:outline-2"
        >
          <span aria-hidden="true">{"✕"}</span>
        </button>
      </div>
      <p className="mt-0.5 mb-1.5 text-xs text-fg-soft">
        {RESIDENTS_SUB(tower, residents.length - tower)} ·{" "}
        <span
          data-testid="devsim-residents-label"
          className={SIM_TAG_CLASS}
          style={{ background: SIM_TAG.bg, color: SIM_TAG.fg }}
        >
          {data.label}
        </span>
      </p>
      {selected ? (
        <ResidentDetail
          ref={backRef}
          resident={selected}
          total={residents.length}
          label={data.label}
          note={data.note}
          onBack={back}
        />
      ) : (
        <ul
          aria-label="Residents"
          data-testid="devsim-residents-list"
          className="m-0 mt-1.5 grid list-none grid-cols-4 gap-1.5 p-0"
        >
          {residents.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                data-testid="devsim-resident-item"
                data-resident={r.id}
                ref={(el) => {
                  if (el) items.current.set(r.id, el);
                  else items.current.delete(r.id);
                }}
                onClick={() => select(r.id)}
                className="w-full cursor-pointer rounded-xl border-0 bg-raised px-1 py-1.5 text-center text-[11px] leading-tight text-fg hover:outline-2 focus-visible:outline-2"
              >
                <Avatar colour={r.colour} name={r.name} />
                {r.name}
                <small className="block text-fg-soft">{RESIDENT_SIDE[r.side]}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
