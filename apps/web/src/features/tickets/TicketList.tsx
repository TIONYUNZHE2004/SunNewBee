import { useEffect, useRef, useState } from "react";
import { StatusChip } from "../../ui/StatusChip";
import type { Ticket } from "./ticketModel";

type Props = {
  toCheck: Ticket[];
  checked: Ticket[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

function Row({
  t,
  selected,
  maxAsked,
  onSelect,
}: {
  t: Ticket;
  selected: boolean;
  maxAsked: number;
  onSelect: (id: string) => void;
}) {
  return (
    <li>
      <button
        type="button"
        aria-pressed={selected}
        onClick={() => onSelect(t.id)}
        className={`glass flex w-full flex-col gap-1 rounded-xl border p-3 text-left ${
          selected ? "border-accent ring-2 ring-accent" : "border-edge"
        }`}
      >
        <span className="flex items-baseline justify-between gap-2">
          <strong className="text-fg">{t.fact}</strong>
          <span className="text-xs text-fg-soft">{t.ago}</span>
        </span>
        <span className="text-sm text-fg-soft">{t.place}</span>
        {!t.isChecked && !t.isRejected && (
          // biome-ignore lint/a11y/useSemanticElements: styled bar, native meter is not stylable cross-browser
          <span
            role="meter"
            aria-valuemin={0}
            aria-valuenow={t.asked}
            aria-valuemax={maxAsked}
            aria-label={`Asked ${t.asked} ${t.asked === 1 ? "time" : "times"}`}
            className="block h-1.5 w-full overflow-hidden rounded-full bg-fg/10"
          >
            <span
              className="block h-full rounded-full bg-accent"
              style={{ width: `${(t.asked / Math.max(1, maxAsked)) * 100}%` }}
            />
          </span>
        )}
        <span className="flex flex-wrap items-center gap-2 text-xs">
          {t.isRejected ? (
            <StatusChip status="rejected" />
          ) : t.isChecked ? (
            <StatusChip
              status="verified"
              label={t.resolution?.date ? `Verified ${t.resolution.date}` : "Verified"}
            />
          ) : (
            <>
              <span className="rounded bg-bg px-2 py-0.5 text-fg-soft">{t.reasonLabel}</span>
              <span className="rounded-full bg-accent px-2 py-0.5 font-semibold text-on-accent">
                Asked {t.asked}×
              </span>
            </>
          )}
        </span>
      </button>
    </li>
  );
}

type Tab = "to-check" | "checked";

export function TicketList({ toCheck, checked, selectedId, onSelect }: Props) {
  const [tab, setTab] = useState<Tab>(toCheck.length > 0 ? "to-check" : "checked");
  const maxAsked = Math.max(1, ...toCheck.map((t) => t.asked));
  const tabs: { id: Tab; label: string; items: Ticket[] }[] = [
    { id: "to-check", label: "To check", items: toCheck },
    { id: "checked", label: "Checked", items: checked },
  ];
  // After a save the selected ticket moves groups; follow it.
  const selectedGroup: Tab | null = toCheck.some((t) => t.id === selectedId)
    ? "to-check"
    : checked.some((t) => t.id === selectedId)
      ? "checked"
      : null;
  useEffect(() => {
    if (selectedGroup) setTab(selectedGroup);
  }, [selectedGroup]);
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({
    "to-check": null,
    checked: null,
  });
  const go = (id: Tab) => {
    setTab(id);
    tabRefs.current[id]?.focus();
  };
  const onTabKey = (e: React.KeyboardEvent, i: number) => {
    const last = tabs.length - 1;
    const to =
      e.key === "ArrowRight"
        ? (i + 1) % tabs.length
        : e.key === "ArrowLeft"
          ? (i + last) % tabs.length
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? last
              : -1;
    if (to < 0) return;
    e.preventDefault();
    go((tabs[to] as (typeof tabs)[number]).id);
  };
  const current = tabs.find((x) => x.id === tab) ?? (tabs[0] as (typeof tabs)[number]);
  return (
    <section aria-label="Ticket list" className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold text-fg">Gaps to close</h1>
        <p className="text-sm text-fg-soft">
          Residents' questions that hit something nobody has checked yet. Tickets hold only the fact
          and the place, never what a resident wrote (PDPA).
        </p>
      </header>
      <div role="tablist" aria-label="Tickets" className="flex gap-2">
        {tabs.map((x, i) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            id={`tickets-tab-${x.id}`}
            aria-selected={tab === x.id}
            aria-controls="tickets-panel"
            tabIndex={tab === x.id ? 0 : -1}
            ref={(el) => {
              tabRefs.current[x.id] = el;
            }}
            onKeyDown={(e) => onTabKey(e, i)}
            onClick={() => setTab(x.id)}
            className={`flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold ${
              tab === x.id ? "border-accent bg-brand-tint text-fg" : "border-edge text-fg-soft"
            }`}
          >
            {x.label}
            <span className="rounded-full bg-accent px-2 text-xs text-on-accent">
              {x.items.length}
            </span>
          </button>
        ))}
      </div>
      <div role="tabpanel" id="tickets-panel" aria-labelledby={`tickets-tab-${current.id}`}>
        {current.items.length === 0 ? (
          <p className="text-sm text-fg-soft">
            {current.id === "to-check" ? "Nothing left to check." : "Nothing checked yet."}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {current.items.map((t) => (
              <Row
                key={t.id}
                t={t}
                selected={t.id === selectedId}
                maxAsked={maxAsked}
                onSelect={onSelect}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
