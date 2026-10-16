import { useSite } from "../../lib/api";

const FALLBACK_ATTRIBUTION = "© OpenStreetMap contributors (ODbL)";

/** Map data attribution line (OSM ODbL etc.), shared by the Shell strip and the phone sheet. */
export function useAttribution() {
  const site = useSite();
  return site.data?.attribution?.join(" · ") ?? FALLBACK_ATTRIBUTION;
}
