import { BeforeAfter } from "./BeforeAfter";
import { ImpactCard } from "./ImpactCard";
import { OutcomeForm } from "./OutcomeForm";
import type { Ticket } from "./ticketModel";

export function TicketDetail({ ticket }: { ticket: Ticket }) {
  return (
    <article
      aria-label="Ticket detail"
      className="rounded-3xl border border-edge bg-surface p-6 shadow-[var(--c-shadow)]"
    >
      <p className="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-fg-soft">
        {ticket.reasonLabel}
      </p>
      <h2 className="mt-1 text-2xl font-semibold tracking-tight text-fg">{ticket.fact}</h2>
      <p className="text-sm text-fg-soft">{ticket.place}</p>
      <dl className="mt-5 grid gap-3 rounded-2xl border border-edge bg-raised p-4 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-fg-soft">Came from a question like</dt>
          <dd className="text-fg">{ticket.kind}</dd>
        </div>
        <div>
          <dt className="text-fg-soft">Times asked</dt>
          <dd className="text-fg">{ticket.asked}</dd>
        </div>
        <div>
          <dt className="text-fg-soft">Recorded value</dt>
          <dd className="text-fg">{ticket.current ?? "Nothing recorded yet"}</dd>
        </div>
      </dl>
      {!ticket.isRejected && <ImpactCard ticketId={ticket.id} isOpen={ticket.isOpen} />}
      <div className="mt-5">
        {ticket.isOpen ? (
          <OutcomeForm key={ticket.id} ticket={ticket} />
        ) : ticket.isRejected ? (
          <p className="text-sm text-fg">
            Rejected on {ticket.resolution?.date ?? ""}. The ticket wasn't valid, so the recorded
            fact stays as it was.
          </p>
        ) : (
          <BeforeAfter ticket={ticket} />
        )}
      </div>
    </article>
  );
}
