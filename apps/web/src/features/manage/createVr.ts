import { ApiError, type VrCreated } from "./manageApi";

export const createVrMessage = (r: VrCreated): string =>
  r.created ? `Request filed (demand ${r.demand})` : `Already requested; demand is now ${r.demand}`;

export function createVrError(err: unknown): string {
  if (err instanceof ApiError && (err.status === 401 || err.status === 503))
    return "Staff token required or not configured";
  return "The request could not be filed. Please try again.";
}

/** Side effects after a staff-filed VR: the list and the KPI tiles are stale. */
export async function onCreated(qc: QueryClient): Promise<void> {
  await Promise.all([
    qc.invalidateQueries({ queryKey: ["manage", "vrs"] }),
    qc.invalidateQueries({ queryKey: ["manage", "kpis"] }),
  ]);
}

/** After a resolve the open list, resolved list and the tiles all change. */
export const onResolved = onCreated;
