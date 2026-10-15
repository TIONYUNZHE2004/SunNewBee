import type { Ticket } from "./ticketModel";

/** What the ticket said before, and what staff recorded after it was checked. */
export function BeforeAfter({ ticket }: { ticket: Ticket }) {
  const r = ticket.resolution;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <section className="rounded-lg border border-dashed border-edge bg-raised p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-soft">Before</h3>
        <p className="mt-1 text-sm text-fg">
          {ticket.current ? `${ticket.current} · ` : ""}Not checked yet
        </p>
      </section>
      <section className="rounded-lg border border-edge bg-accent p-4 text-on-accent">
        <h3 className="text-xs font-semibold uppercase tracking-wide">Now</h3>
        <p className="mt-1 text-sm">
          Verified on {r?.date ?? ""}
          {r?.value ? `: ${r.value}` : ""}
        </p>
      </section>
    </div>
  );
}
