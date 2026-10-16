export function LoadingTownship() {
  return (
    <div role="status" className="grid h-full place-items-center">
      <div className="flex flex-col items-center gap-3 text-fg-soft">
        <svg
          width="120"
          height="60"
          viewBox="0 0 120 60"
          aria-hidden="true"
          className="text-accent"
        >
          <path
            d="M5 50h30V25h25v25h30V10h25"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="220"
            className="motion-safe:animate-[trace_1.6s_ease-in-out_infinite]"
          />
        </svg>
        <p className="font-display tracking-[0.22em] text-fg">TOWNSHIPLENS</p>
        <p className="text-sm">Loading the township</p>
      </div>
    </div>
  );
}
