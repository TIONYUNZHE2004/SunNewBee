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
  onSelect,
}: {
  t: Ticket;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <li>
      <button
        type="button"
        aria-pressed={selected}
        onClick={() => onSelect(t.id)}
        className={`flex w-full flex-col gap-1 rounded-lg border p-3 text-left ${
          selected ? "border-accent bg-raised" : "border-edge bg-surface"
        }`}
      >
        <span className="flex items-baseline justify-between gap-2">
          <strong className="text-fg">{t.fact}</strong>
          <span className="text-xs text-fg-soft">{t.ago}</span>
        </span>
        <span className="text-sm text-fg-soft">{t.place}</span>
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

export function TicketList({ toCheck, checked, selectedId, onSelect }: Props) {
  return (
    <section aria-label="Ticket list" className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold text-fg">Gaps to close</h1>
        <p className="text-sm text-fg-soft">
          Residents' questions that hit something nobody has checked yet. Tickets hold only the fact
          and the place, never what a resident wrote (PDPA).
        </p>
      </header>
      <div>
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-fg">
          To check{" "}
          <span className="rounded-full bg-accent px-2 text-xs text-on-accent">
            {toCheck.length}
          </span>
        </h2>
        {toCheck.length === 0 ? (
          <p className="text-sm text-fg-soft">Nothing left to check.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {toCheck.map((t) => (
              <Row key={t.id} t={t} selected={t.id === selectedId} onSelect={onSelect} />
            ))}
          </ul>
        )}
      </div>
      <div>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-fg">Checked</h2>
        <ul className="flex flex-col gap-2">
          {checked.map((t) => (
            <Row key={t.id} t={t} selected={t.id === selectedId} onSelect={onSelect} />
          ))}
        </ul>
      </div>
    </section>
  );
}
