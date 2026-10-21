import type { CompareIntent } from "../compareTypes";
import { TOAST_TITLE, toastBody } from "./copy";

/**
 * The survey-ticket toast (spec §5.3, AC-N5): what was queued for staff and how many wheelchair
 * trips checking it would confirm. Nothing without a ticket (`vr` null).
 */
export function TicketToast({
  compare,
  className = "",
}: {
  compare: CompareIntent;
  className?: string;
}) {
  const body = toastBody(compare);
  if (!body) return null;
  return (
    <div
      role="status"
      data-beat="ticket-toast"
      className={`rounded-lg border border-line bg-card px-4 py-3 text-sm ${className}`}
    >
      <b className="block">{TOAST_TITLE}</b> · {body}
    </div>
  );
}
