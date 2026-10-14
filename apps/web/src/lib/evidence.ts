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
