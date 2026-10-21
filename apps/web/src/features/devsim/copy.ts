/**
 * Copy helpers for the Development Simulation overlays and the text version. All strings come from
 * the plan (spec §4.3, §4.5, D8); these only split them for layout, never rewrite them.
 */

/** "ROUTE ENGINE · +3 min walk · 2,516 → 2,754 m" -> head "ROUTE ENGINE", body the rest. */
export function splitTag(tag: string): { head: string; body: string } {
  const i = tag.indexOf(" · ");
  return i < 0 ? { head: "", body: tag } : { head: tag.slice(0, i), body: tag.slice(i + 3) };
}

/** "Hypothetical development · not an SDP project · 30 storeys · ~500 homes" -> title + detail. */
export function splitLabel(label: string): { title: string; detail: string } {
  const i = label.indexOf(" · ");
  return i < 0
    ? { title: label, detail: "" }
    : { title: label.slice(0, i), detail: label.slice(i + 3) };
}

/**
 * The Brief overview's site label (prototype `parcelTag`): the parcel is OSM landuse=construction
 * beside Lakeside Mall (`plan.site.parcel_id`, spec D3), so it is a mapped fact with its source.
 */
export const SITE_LABEL = {
  source: "OpenStreetMap",
  text: "Construction lot beside Lakeside Mall",
};

/** Copy when the simulation cannot play. */
export const LOADING_COPY = "Preparing the development simulation…";
export const ERROR_COPY = "The development simulation could not be loaded. Try again.";
