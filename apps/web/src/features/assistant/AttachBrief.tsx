import { useRef } from "react";

/**
 * Composer paperclip (developer lens, spec D5): a hidden file input. Choosing a file only reports
 * its name; the file is never read, uploaded or stored. On send the panel sends the fixed brief.
 */
export function AttachBrief({
  onPick,
  disabled,
}: {
  onPick: (fileName: string) => void;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        aria-label="Attach a brief"
        title="Attach a brief"
        disabled={disabled}
        onClick={() => input.current?.click()}
        className="grid size-9 shrink-0 place-items-center rounded-xl text-fg-soft transition-colors hover:bg-surface hover:text-fg disabled:opacity-40"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="size-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M20 11.5l-8.2 8.2a5 5 0 0 1-7.1-7.1l8.5-8.5a3.4 3.4 0 0 1 4.8 4.8l-8.4 8.4a1.7 1.7 0 0 1-2.4-2.4l7.7-7.7" />
        </svg>
      </button>
      <input
        ref={input}
        type="file"
        hidden
        data-testid="attach-brief-input"
        aria-label="Brief file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f.name);
          // only the name is kept: drop the browser's handle on the file
          e.target.value = "";
        }}
      />
    </>
  );
}

/** A file chip: the file's name with a PDF badge; removable in the composer. */
export function BriefChip({ name, onRemove }: { name: string; onRemove?: () => void }) {
  return (
    <span
      data-testid="brief-chip"
      className="inline-flex max-w-full items-center gap-2 rounded-xl border border-edge bg-surface px-2 py-1.5 text-xs font-semibold text-fg"
    >
      <b
        aria-hidden="true"
        className="grid h-7 w-6 shrink-0 place-items-center rounded bg-[#b42828] text-[9px] text-white"
      >
        PDF
      </b>
      <span className="truncate">{name}</span>
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove ${name}`}
          onClick={onRemove}
          className="grid size-6 place-items-center rounded-full text-fg-soft hover:text-fg"
        >
          <span aria-hidden="true">✕</span>
        </button>
      )}
    </span>
  );
}
