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
  };
  centres: CentreReach[];
  disclaimer: string;
};

export class ApiError extends Error {
  constructor(public status: number) {
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

export const fetchOpenVRs = () => getJson<VR[]>("/verification-requests?status=open");

export const fetchBriefing = (scenarioId: string, profile: string) =>
  getJson<Briefing>(
    `/briefings/flood?scenario_id=${encodeURIComponent(scenarioId)}&profile=${encodeURIComponent(profile)}`,
  );

export type ResolveBody = { action: "verify" | "correct" | "reject"; value?: string; note: string };

export async function resolveVR(id: string, body: ResolveBody, token: string): Promise<void> {
  const r = await fetch(`/api/verification-requests/${encodeURIComponent(id)}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Staff-Token": token },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new ApiError(r.status);
}
