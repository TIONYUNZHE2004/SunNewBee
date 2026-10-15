import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { fetchVRs } from "./manageApi";
import { type Ticket, toTicket } from "./ticketModel";
import { useQueueNames } from "./useQueueNames";

/** One shared fetch of every ticket; the list, detail and Shell count all read it. */
function useAllVRs() {
  return useQuery({ queryKey: ["tickets", "all"], queryFn: () => fetchVRs("?status=all") });
}

export function useTickets(): {
  tickets: Ticket[];
  isPending: boolean;
  isError: boolean;
  refetch: () => void;
} {
  const q = useAllVRs();
  const names = useQueueNames();
  const tickets = useMemo(() => {
    const now = new Date();
    return (q.data ?? []).map((vr) => toTicket(vr, names, now));
  }, [q.data, names]);
  return { tickets, isPending: q.isPending, isError: q.isError, refetch: () => void q.refetch() };
}

/** Number of tickets (verification requests) still needing staff attention. */
export function useOpenTicketCount(): number {
  const q = useAllVRs();
  return (q.data ?? []).filter((v) => v.status === "open" || v.status === "in_progress").length;
}
