import { ApiError, type VrCreated } from "./manageApi";

export const createVrMessage = (r: VrCreated): string =>
  r.created ? `Request filed (demand ${r.demand})` : `Already requested; demand is now ${r.demand}`;

export function createVrError(err: unknown): string {
  if (err instanceof ApiError && (err.status === 401 || err.status === 503))
    return "Staff token required or not configured";
  return "The request could not be filed. Please try again.";
}
