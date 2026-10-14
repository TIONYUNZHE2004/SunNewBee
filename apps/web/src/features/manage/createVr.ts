import type { QueryClient } from "@tanstack/react-query";
import { ApiError, type EvidenceUploaded, type ResolveBody, type VrCreated } from "./manageApi";

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

export class PhotoUploadError extends Error {
  constructor(cause: unknown) {
    super("photo upload failed", { cause });
  }
}

/** Upload the photo first, then resolve with its evidence id. A failed upload never resolves. */
export async function submitResolution(
  deps: {
    upload: (f: File) => Promise<EvidenceUploaded>;
    resolve: (b: ResolveBody) => Promise<void>;
  },
  photo: File | null,
  body: ResolveBody,
): Promise<void> {
  // A photo is only attached to Verify or Correct; the API refuses it on a reject.
  if (!photo || body.action === "reject") return deps.resolve(body);
  let up: EvidenceUploaded;
  try {
    up = await deps.upload(photo);
  } catch (e) {
    throw new PhotoUploadError(e);
  }
  return deps.resolve({ ...body, evidence_id: up.evidence_id });
}

export function uploadErrorMessage(err: unknown): string {
  const e = err instanceof PhotoUploadError ? err.cause : err;
  const tail = " The request was not resolved.";
  if (e instanceof ApiError) {
    if (e.status === 401 || e.status === 503) return `Staff token required or invalid.${tail}`;
    if (e.status === 413) return `The photo is over the 5 MB limit.${tail}`;
    if (e.detail) return `The photo could not be uploaded: ${e.detail.replace(/\.$/, "")}.${tail}`;
  }
  return `The photo could not be uploaded. Please try again.${tail}`;
}
