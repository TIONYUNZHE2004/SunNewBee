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

/** Where to ask the council. Used wherever we say "ask MBSA". mbsa.gov.my is the council's
 * official domain (confirmed by the coordinator); the project docs link an mbsa.gov.my
 * collection page as the source. */
export const MBSA_CONTACT_URL = "https://www.mbsa.gov.my";
export const COLLECTION_DAY_UNKNOWN = "Collection day: unknown, ask MBSA";

export const CENTRE_SOURCE_LABEL: Record<string, string> = {
  official_pps: "Official PPS",
  osm_candidate: "Candidate (OSM), not an official relief centre",
};

/** Source label for an evacuation centre. An unrecognised source is never promoted to official. */
export const centreSourceLabel = (source: unknown): string =>
  CENTRE_SOURCE_LABEL[String(source)] ?? CENTRE_SOURCE_LABEL.osm_candidate ?? "";

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const PHOTO_TYPES = ["image/jpeg", "image/png"] as const;
export const PHOTO_ACCEPT = PHOTO_TYPES.join(",");

/** Client-side check before upload (the server re-checks by magic bytes). A photo is optional. */
export function validatePhoto(f: Pick<File, "type" | "size"> | null | undefined): string | null {
  if (!f) return null;
  if (!(PHOTO_TYPES as readonly string[]).includes(f.type))
    return "Photo must be a JPEG or PNG image.";
  if (f.size === 0) return "The photo file is empty.";
  if (f.size > MAX_PHOTO_BYTES)
    return `Photo is ${(f.size / 1024 / 1024).toFixed(1)} MB; the limit is 5 MB. Choose a smaller photo.`;
  return null;
}

/** The API serves photos at /evidence/<id>; the web app reaches it under /api. Anything else
 * (other hosts, odd paths) is not rendered. */
export function photoSrc(url: unknown): string | null {
  return typeof url === "string" && /^\/evidence\/[A-Za-z0-9_-]+$/.test(url) ? `/api${url}` : null;
}

const attrLabel = (a: string) => {
  const s = a.replace(/_/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export const photoAlt = (element: string, attribute: string): string =>
  `Photo evidence for ${element} · ${attrLabel(attribute)}`;
