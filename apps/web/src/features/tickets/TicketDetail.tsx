import { BeforeAfter } from "./BeforeAfter";
import { ImpactCard } from "./ImpactCard";
import { OutcomeForm } from "./OutcomeForm";
import type { Ticket } from "./ticketModel";

export function TicketDetail({ ticket }: { ticket: Ticket }) {
  return (
    <article aria-label="Ticket detail" className="rounded-xl border border-edge bg-surface p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-fg-soft">
        {ticket.reasonLabel}
      </p>
      <h2 className="mt-1 text-xl font-semibold text-fg">{ticket.fact}</h2>
      <p className="text-sm text-fg-soft">{ticket.place}</p>
      <dl className="mt-4 grid gap-2 text-sm">
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
      {!ticket.isRejected && <ImpactCard ticketId={ticket.id} />}
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
