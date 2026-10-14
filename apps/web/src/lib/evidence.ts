export const PLACEHOLDER_SOURCE = "team_survey_placeholder";
export const DEMO_LABEL = "Demo value · not surveyed";

export const isPlaceholderSource = (s: unknown): boolean => s === PLACEHOLDER_SOURCE;

/** How a claim's status chip reads. Placeholder demo facts are never shown as verified or
 * checked, whatever their stored status: no tick icon, no checked date. */
export function claimBadge(
  source: unknown,
  status: { label: string; icon: string },
  verifiedAt: string | null,
): { label: string; icon: string; verifiedAt: string | null; demo: boolean } {
  return isPlaceholderSource(source)
    ? { label: DEMO_LABEL, icon: "", verifiedAt: null, demo: true }
    : { ...status, verifiedAt, demo: false };
}

/** Where to ask the council. Used wherever we say "ask MBSA". */
export const MBSA_CONTACT_URL = "https://www.mbsa.gov.my";
export const COLLECTION_DAY_UNKNOWN = "Collection day: unknown, ask MBSA";

export const CENTRE_SOURCE_LABEL: Record<string, string> = {
  official_pps: "Official PPS",
  osm_candidate: "Candidate (OSM), not an official relief centre",
};

/** Source label for an evacuation centre. An unrecognised source is never promoted to official. */
export const centreSourceLabel = (source: unknown): string =>
  CENTRE_SOURCE_LABEL[String(source)] ?? CENTRE_SOURCE_LABEL.osm_candidate ?? "";
