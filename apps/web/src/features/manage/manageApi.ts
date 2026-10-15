import type { Schemas } from "@tl/api-client";
import type { AttrPayload } from "./attributeForm";

// Plain fetch with local types: briefings/resolve are not in the generated schema yet.
export type VR = {
  id: string;
  element_id: string;
  attribute: string;
  reason: string;
  status: string;
  demand: number;
  question_summary?: string | null;
  created_at: string;
  resolved_at?: string | null;
  resolution?: Record<string, unknown> | null;
  /** The claim's current value (null when none), so staff see what Verify confirms. */
  current_value?: unknown;
};

export type PlaceRef = { id: string; name: string; kind: string };
export type Island = {
  id: string;
  node_count: number;
  sample_node_ids?: string[];
  sample_place_ids?: string[];
};
export type CentreReach = {
  centre: { id: string; name: string; source: "official_pps" | "osm_candidate" };
  reachable: boolean;
  route_status: string;
  route_id?: string | null;
  distance_m?: number | null;
};
export type Briefing = {
  scenario: { id: string; label: string; stage_m?: number | null };
  affected: {
    scenario_id: string;
    likely: PlaceRef[];
    possible: PlaceRef[];
    isolated_components: Island[];
    disclaimer: string;
    likely_edge_ids?: string[];
    possible_edge_ids?: string[];
    likely_place_ids?: string[];
    possible_place_ids?: string[];
  };
  centres: CentreReach[];
  disclaimer: string;
  near_place?: string | null;
  near_place_name?: string | null;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    public detail?: string,
  ) {
    super(`HTTP ${status}`);
  }
}

const KEY = "tl.staffToken";
export function loadToken(): string {
  try {
    return sessionStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}
export function saveToken(v: string): void {
  try {
    if (v) sessionStorage.setItem(KEY, v);
    else sessionStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: keep in memory only */
  }
}

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(`/api${path}`, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new ApiError(r.status);
  return (await r.json()) as T;
}

export type Kpis = Schemas["Kpis"];
export type VrCreated = Schemas["VerificationRequested"];

export const fetchKpis = () => getJson<Kpis>("/kpis");
export const fetchVRs = (query: string) => getJson<VR[]>(`/verification-requests${query}`);

export async function createVR(
  body: { target_id: string; attribute: string; reason?: string },
  token: string,
): Promise<VrCreated> {
  const r = await fetch("/api/verification-requests", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Staff-Token": token,
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new ApiError(r.status, await readDetail(r));
  return (await r.json()) as VrCreated;
}

export const fetchBriefing = (scenarioId: string, profile: string) =>
  getJson<Briefing>(
    `/briefings/flood?scenario_id=${encodeURIComponent(scenarioId)}&profile=${encodeURIComponent(profile)}`,
  );

export type ResolveBody = {
  action: "verify" | "correct" | "reject";
  value?: string | number | boolean;
  note: string;
  evidence_id?: string;
};

export async function resolveVR(id: string, body: ResolveBody, token: string): Promise<void> {
  const r = await fetch(`/api/verification-requests/${encodeURIComponent(id)}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Staff-Token": token },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new ApiError(r.status, await readDetail(r));
}

export type EvidenceUploaded = Schemas["EvidenceUploaded"];

/** Multipart upload; the browser sets the boundary, so no Content-Type here. */
export async function uploadEvidence(file: File, token: string): Promise<EvidenceUploaded> {
  const form = new FormData();
  form.append("file", file);
  const r = await fetch("/api/evidence", {
    method: "POST",
    headers: { Accept: "application/json", "X-Staff-Token": token },
    body: form,
  });
  if (!r.ok) throw new ApiError(r.status, await readDetail(r));
  return (await r.json()) as EvidenceUploaded;
}

export type SimReport = Schemas["SimReport"];
export type SimSummary = Schemas["SimSummary"];
export type SimGap = Schemas["SimGap"];

export const fetchSimRuns = (limit = 5) => getJson<SimSummary[]>(`/simulations?limit=${limit}`);
export type SimRun = Schemas["SimRun"];

export const fetchSimRun = (runId: string) =>
  getJson<SimRun>(`/simulations/${encodeURIComponent(runId)}`);

/** A finished run's report; a run that is not done has none. */
export async function fetchSimReport(runId: string): Promise<SimReport> {
  const run = await fetchSimRun(runId);
  if (!run.report) throw new ApiError(409, `run is ${run.status}`);
  return run.report;
}

/** Start a run. The server answers 202 with the run id and works in the background; a run
 * already in progress answers 409 with its id, which the caller follows instead. */
export async function startSimulation(
  body: { scenario_id: string | null; profiles: string[] },
  token: string,
): Promise<{ run_id: string; alreadyRunning: boolean }> {
  const r = await fetch("/api/simulations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Staff-Token": token,
    },
    body: JSON.stringify({
      ...(body.scenario_id ? { scenario_id: body.scenario_id } : {}),
      profiles: body.profiles,
    }),
  });
  if (r.status === 409) {
    const b = (await r.json().catch(() => null)) as { run_id?: string } | null;
    if (b?.run_id) return { run_id: b.run_id, alreadyRunning: true };
  }
  if (r.status !== 202) throw new ApiError(r.status);
  const b = (await r.json()) as { run_id: string };
  return { run_id: b.run_id, alreadyRunning: false };
}

export type AuditClaim = {
  value?: unknown;
  status?: string;
  evidence_type?: string | null;
} | null;
export type AuditRow = {
  id: number;
  at: string;
  actor: string;
  element_id: string;
  attribute: string;
  old: AuditClaim;
  new: AuditClaim;
  reason: string;
  note: string | null;
};

/** FastAPI `detail` is a string, or a list of {msg} for validation errors. */
async function readDetail(r: Response): Promise<string | undefined> {
  try {
    const j = (await r.json()) as { detail?: unknown };
    if (typeof j.detail === "string") return j.detail;
    if (Array.isArray(j.detail)) {
      const m = j.detail.map((d) => (d as { msg?: string }).msg).filter(Boolean);
      return m.length ? m.join("; ") : undefined;
    }
  } catch {
    /* no body */
  }
  return undefined;
}

export async function saveAttribute(
  elementId: string,
  key: string,
  body: AttrPayload,
  token: string,
): Promise<void> {
  const r = await fetch(
    `/api/elements/${encodeURIComponent(elementId)}/attributes/${encodeURIComponent(key)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Staff-Token": token },
      body: JSON.stringify(body),
    },
  );
  if (!r.ok) throw new ApiError(r.status, await readDetail(r));
}

export async function fetchAudit(elementId: string, token: string): Promise<AuditRow[]> {
  const r = await fetch(`/api/audit?element_id=${encodeURIComponent(elementId)}`, {
    headers: { Accept: "application/json", "X-Staff-Token": token },
  });
  if (!r.ok) throw new ApiError(r.status, await readDetail(r));
  return (await r.json()) as AuditRow[];
}
