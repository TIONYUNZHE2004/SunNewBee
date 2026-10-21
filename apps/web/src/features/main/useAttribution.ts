import { useSite } from "../../lib/api";
import { quietAttribution, useDevsimActive } from "../devsim/floodQuiet";

const FALLBACK_ATTRIBUTION = "© OpenStreetMap contributors (ODbL)";

/**
 * Map data attribution line (OSM ODbL etc.), shared by the Shell strip and the phone sheet. While a
 * Development Simulation runs, the flood-scenario clause is dropped (D11); licence lines stay.
 */
export function useAttribution() {
  const site = useSite();
  const devsim = useDevsimActive();
  const lines = site.data?.attribution;
  if (!lines) return FALLBACK_ATTRIBUTION;
  return (devsim ? quietAttribution(lines) : lines).join(" · ");
}
