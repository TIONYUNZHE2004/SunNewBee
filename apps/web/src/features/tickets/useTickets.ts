import { useQuery } from "@tanstack/react-query";
import { fetchVRs } from "./manageApi";

/** Number of tickets (verification requests) still needing staff attention. */
export function useOpenTicketCount(): number {
  const q = useQuery({
    queryKey: ["tickets", "open-count"],
    queryFn: () => fetchVRs("?status=open"),
  });
  return q.data?.length ?? 0;
}
