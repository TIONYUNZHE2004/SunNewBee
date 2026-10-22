import { type ReactNode, useId, useState } from "react";
import { Icon } from "../../ui/icons";
import { type AnswerBlock, answerBlocks, type StatusTone, type Step } from "./answerBlocks";

/** Steps shown before "Show all steps" (a long list is collapsed, never cut). */
export const STEPS_SHOWN = 4;

const TONE: Record<StatusTone, { pill: string; dot: string }> = {
  ok: { pill: "border-ok/40 bg-ok/10", dot: "bg-ok" },
  warn: { pill: "border-lantern/40 bg-warn-tint", dot: "bg-lantern" },
  bad: { pill: "border-rose/40 bg-danger-tint", dot: "bg-rose" },
  gap: { pill: "border-dashed border-edge bg-raised", dot: "border border-dashed border-fg-soft" },
};

/** "about 38 m" / "416 m" / "5.9 min" in bold: the numbers a resident scans for. */
function emphasise(text: string): ReactNode[] {
  const parts = text.split(/(\b(?:about\s+)?\d[\d,.]*\s?(?:m|km|min)\b)/);
  return parts.map((p, i) =>
    i % 2 === 1 ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: a fixed split of one string
      <strong key={i} className="font-semibold text-fg">
        {p}
      </strong>
    ) : (
      p
    ),
  );
}

function noteTone(note: string): string {
  const n = note.toLowerCase();
  if (/blocked|flood|cut/.test(n)) return "border-rose/40 bg-danger-tint text-fg";
  if (/not checked|unverified|demo/.test(n)) return "border-lantern/40 bg-warn-tint text-fg";
  return "border-edge bg-raised text-fg-soft";
}

function Steps({ steps }: { steps: Step[] }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const long = steps.length > STEPS_SHOWN + 1;
  return (
    <div className="space-y-1.5">
      <ol id={id} className="relative m-0 list-none space-y-0 p-0">
        {steps.map((s, i) => {
          const hidden = long && !open && i >= STEPS_SHOWN;
          const lastShown = i === steps.length - 1 || (long && !open && i === STEPS_SHOWN - 1);
          return (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: steps are positional
              key={i}
              hidden={hidden}
              className="relative flex gap-3 pb-2.5 last:pb-0"
            >
              {!lastShown && (
                <span
                  aria-hidden="true"
                  className="absolute top-6 bottom-0 left-[0.6875rem] w-px bg-edge"
                />
              )}
              {/* the circled number is drawn by CSS, so copied text reads "1. …", not "11. …" */}
              <span
                aria-hidden="true"
                data-n={s.elided ? "…" : i + 1}
                className={`relative grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold tabular-nums before:content-[attr(data-n)] ${
                  s.elided ? "border border-dashed border-edge text-fg-soft" : "bg-raised text-fg"
                }`}
              />
              <span className="min-w-0 pt-0.5">
                <span className="sr-only">{i + 1}. </span>
                <span className={s.elided ? "italic text-fg-soft" : "text-fg"}>
                  {s.elided ? s.text : emphasise(s.text)}
                </span>
                {s.note && " "}
                {s.note && (
                  <span
                    className={`ml-0.5 inline-flex items-center rounded-full border px-1.5 py-px text-[11px] leading-4 whitespace-nowrap ${noteTone(s.note)}`}
                  >
                    <span className="sr-only">(</span>
                    {s.note}
                    <span className="sr-only">)</span>
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
      {long && (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen(!open)}
          className="ml-9 inline-flex min-h-8 items-center gap-1 rounded-full text-xs font-medium text-fg-soft hover:text-fg"
        >
          {open ? "Show fewer steps" : `Show all ${steps.length} steps`}
          <Icon
            name="chevron"
            className={`size-3.5 transition-transform ${open ? "-rotate-90" : "rotate-90"}`}
          />
        </button>
      )}
    </div>
  );
}

function Block({ b, first }: { b: AnswerBlock; first: boolean }) {
  switch (b.kind) {
    case "status": {
      const t = TONE[b.tone];
      return (
        <p
          data-testid="answer-status"
          className={`m-0 inline-flex max-w-full items-center gap-2 rounded-full border px-2.5 py-1 text-xs ${t.pill}`}
        >
          <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${t.dot}`} />
          <span>
            <span className="text-fg-soft">{b.label}: </span>
            <span className="font-semibold text-fg">{b.value}</span>
          </span>
        </p>
      );
    }
    case "para":
      return (
        <p className={`m-0 ${first ? "text-[0.9375rem] leading-relaxed text-fg" : "text-fg"}`}>
          {emphasise(b.text)}
        </p>
      );
    case "steps":
      return <Steps steps={b.steps} />;
    case "notes":
      return (
        <section
          aria-label={b.title}
          className="space-y-1.5 rounded-xl border border-edge bg-raised/60 px-3 py-2.5"
        >
          {b.title && (
            <h3 className="m-0 text-[11px] font-semibold uppercase tracking-wide text-fg-soft">
              {b.title}:
            </h3>
          )}
          <ul className="m-0 list-none space-y-1 p-0 text-[0.8125rem] leading-snug text-fg">
            {b.items.map((it) => (
              <li key={it} className="flex gap-2">
                <span
                  aria-hidden="true"
                  className="mt-[0.45rem] size-1 shrink-0 rounded-full bg-fg-soft"
                />
                <span>{it}</span>
              </li>
            ))}
          </ul>
        </section>
      );
  }
}

/**
 * The checked answer as readable blocks: status pill, summary, numbered steps (long lists
 * collapsed), "Worth knowing" notes. While it streams the raw text shows with a cursor, so nothing
 * jumps as lines arrive. Every word of the text is rendered (`answerBlocks` is lossless).
 */
export function AnswerText({ text, done }: { text: string; done: boolean }) {
  if (!done)
    return (
      <p className="m-0 whitespace-pre-wrap">
        {text}
        <span
          aria-hidden="true"
          className="ml-0.5 inline-block w-1.5 bg-fg motion-safe:animate-pulse"
        >
          &nbsp;
        </span>
      </p>
    );
  const blocks = answerBlocks(text);
  const firstPara = blocks.findIndex((b) => b.kind === "para");
  return (
    <div data-testid="answer-text" className="space-y-3">
      {blocks.map((b, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: blocks are positional
        <Block key={i} b={b} first={i === firstPara} />
      ))}
    </div>
  );
}
