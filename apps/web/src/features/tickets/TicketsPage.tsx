import { useEffect, useMemo, useState } from "react";
import { Button } from "../../ui/Button";
import { TicketDetail } from "./TicketDetail";
import { TicketList } from "./TicketList";
import { groupTickets } from "./ticketModel";
import { useTickets } from "./useTickets";

export function TicketsPage() {
  const { tickets, isPending, isError, refetch } = useTickets();
  const { toCheck, checked } = useMemo(() => groupTickets(tickets), [tickets]);
  const [picked, setPicked] = useState<string | null>(null);
  // On narrow screens the detail replaces the list once a ticket is picked.
  const [showDetail, setShowDetail] = useState(false);

  const selected = tickets.find((t) => t.id === picked) ?? toCheck[0] ?? checked[0] ?? null;
  const selectedId = selected?.id ?? null;
  // Pin an auto-picked ticket so saving it doesn't make the selection jump to the next one.
  useEffect(() => {
    if (picked === null && selectedId !== null) setPicked(selectedId);
  }, [picked, selectedId]);

  if (isPending) return <p className="p-6 text-fg-soft">Loading tickets…</p>;
  if (isError)
    return (
      <div className="p-6">
        <p className="text-fg">Could not load tickets.</p>
        <Button variant="outline" onClick={refetch}>
          Try again
        </Button>
      </div>
    );

  return (
    <div className="mx-auto grid min-h-0 max-w-6xl lg:h-full lg:overflow-auto gap-6 p-4 lg:grid-cols-[minmax(280px,380px)_minmax(0,1fr)]">
      <div
        className={`${showDetail ? "hidden lg:block" : ""} lg:glass lg:self-start lg:rounded-2xl lg:p-4`}
      >
        <TicketList
          toCheck={toCheck}
          checked={checked}
          selectedId={selected?.id ?? null}
          onSelect={(id) => {
            setPicked(id);
            setShowDetail(true);
          }}
        />
      </div>
      <div className={showDetail ? "" : "hidden lg:block"}>
        <Button variant="outline" className="mb-3 lg:hidden" onClick={() => setShowDetail(false)}>
          Back to list
        </Button>
        {selected ? <TicketDetail ticket={selected} /> : null}
      </div>
    </div>
  );
}
