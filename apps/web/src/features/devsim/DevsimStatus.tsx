import { ERROR_COPY, LOADING_COPY } from "./copy";
import { type DevsimStatus as Status, useDevsim } from "./devsimStore";
import { beginDevsim, NOT_AVAILABLE } from "./intent";

const btn =
  "inline-flex min-h-9 items-center justify-center rounded-full border border-edge bg-raised px-3 text-sm font-semibold text-fg hover:border-fg/25 focus-visible:outline-2";

/** Fetches the plan again for the brief the failed simulation was started with. */
export function retryDevsim(fetchFn: typeof fetch = fetch): Promise<void> {
  const brief = useDevsim.getState().briefText ?? "";
  return beginDevsim({ kind: "development.play", brief_text: brief }, fetchFn);
}

/**
 * The simulation's state before it has a plan (loading, unavailable, error), with a way out: Close
 * ends the simulation (markers and the map come back), and an error offers Try again (the same
 * brief, fetched again). Close also cancels a fetch that hangs (the late plan is dropped).
 */
export function DevsimStatusNotice({
  status,
  onClose,
  className,
}: {
  /** loading, unavailable or error (any other status reads as loading). */
  status: Status;
  onClose?: () => void;
  className: string;
}) {
  const msg =
    status === "unavailable" ? NOT_AVAILABLE : status === "error" ? ERROR_COPY : LOADING_COPY;
  const close = onClose ?? (() => useDevsim.getState().stop());
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <p
        role={status === "loading" ? "status" : "alert"}
        data-testid="devsim-status"
        className="m-0 text-sm text-fg"
      >
        {msg}
      </p>
      {status === "error" && (
        <button type="button" className={btn} onClick={() => void retryDevsim()}>
          Try again
        </button>
      )}
      <button type="button" className={btn} aria-label="Close simulation" onClick={close}>
        Close
      </button>
    </div>
  );
}
