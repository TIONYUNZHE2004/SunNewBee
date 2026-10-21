import { useState } from "react";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/icons";
import { CitationList } from "../chat/CitationList";
import { type AssistantMessage, isRefusal, isTemplateFallback } from "../chat/chatReducer";
import { describeUncertainty, groupUncertainty } from "../chat/uncertainty";
import { useElementNames } from "../chat/useElementNames";
import { TripStrip } from "../day/TripStrip";
import { OwnJourneyControls } from "../journey/OwnJourneyControls";
import { WatchTripButton } from "../journey/WatchTripButton";
import { AnswerText } from "./AnswerText";
import { RouteSummary } from "./RouteSummary";
import { toolStep } from "./toolSteps";

export function AnswerCard({ m, onRetry }: { m: AssistantMessage; onRetry: () => void }) {
  const names = useElementNames();
  const [checksOpen, setChecksOpen] = useState(false);
  const checksRunning = m.tools.some((t) => !t.done);
  const drafting = !m.text && !m.error && m.draft.length > 0;
  const thinking = !m.done && !m.text && !m.error && !drafting;
  const refusal = isRefusal(m);
  const tone = m.error
    ? "border-rose bg-danger-tint"
    : refusal
      ? "border-dashed border-lilac bg-surface"
      : "border-edge bg-surface";
  const uncertain =
    m.uncertainty && m.uncertainty.level !== "none"
      ? groupUncertainty(describeUncertainty(m.uncertainty.items as Record<string, string>[]))
      : [];
  const links = (m.disclaimer?.links ?? [])
    .map((l) => ({ href: l.url ?? l.href, label: l.label ?? l.title ?? l.name }))
    .filter((l) => l.href && /^https?:\/\//.test(l.href));

  const checksList = (
    <ol
      aria-label="Checks the assistant ran"
      className="relative m-0 list-none space-y-1.5 border-l border-edge py-0.5 pl-4 text-xs text-fg-soft"
    >
      {m.tools.map((t) => (
        <li
          key={t.id}
          className="relative flex items-center gap-1.5 motion-safe:animate-[fadeIn_200ms_ease-out]"
        >
          {t.done ? (
            <span
              aria-hidden="true"
              className="absolute -left-[1.3rem] grid size-3.5 place-items-center rounded-full bg-ok text-[0.55rem] leading-none text-on-status"
            >
              ✓
            </span>
          ) : (
            <span
              aria-hidden="true"
              className="absolute -left-[1.3rem] inline-block size-3.5 rounded-full border-2 border-fg-soft border-t-transparent bg-surface motion-safe:animate-spin"
            />
          )}
          <span className={t.done ? "" : "text-fg"}>{toolStep(t, names)}</span>
          <span className="sr-only">{t.done ? " done" : " running"}</span>
        </li>
      ))}
    </ol>
  );

  return (
    <article
      data-done={m.done || m.error ? "true" : "false"}
      className={`space-y-3 rounded-2xl border p-4 text-sm leading-relaxed text-fg motion-safe:animate-[fadeIn_240ms_ease-out] ${tone}`}
    >
      {refusal && (
        <p className="m-0 inline-block rounded-full border border-dashed border-lilac px-2.5 py-0.5 text-xs font-medium text-lilac">
          Can't answer that yet
        </p>
      )}
      {drafting && (
        <div aria-live="polite" className="space-y-1">
          <p className="text-xs text-fg-soft">Draft · checking against the township data…</p>
          <p className="whitespace-pre-wrap italic text-fg-soft">{m.draft}</p>
        </div>
      )}
      {thinking && (
        <p className="m-0 flex items-center gap-2 text-fg-soft">
          <span aria-hidden="true" className="flex gap-1">
            <span className="size-1.5 rounded-full bg-fg-soft motion-safe:animate-pulse" />
            <span className="size-1.5 rounded-full bg-fg-soft motion-safe:animate-pulse [animation-delay:150ms]" />
            <span className="size-1.5 rounded-full bg-fg-soft motion-safe:animate-pulse [animation-delay:300ms]" />
          </span>
          Checking the data<span aria-hidden="true">…</span>
        </p>
      )}
      {m.text && <AnswerText text={m.text} done={m.done} />}
      {m.text && <RouteSummary m={m} />}
      {m.text && m.journey && (
        <div className="space-y-2">
          <WatchTripButton plan={m.journey.plan} />
          <OwnJourneyControls plan={m.journey.plan} />
        </div>
      )}
      {m.text && m.trip && <TripStrip meta={m.trip} />}
      {m.tools.length > 0 &&
        (checksRunning ? (
          checksList
        ) : (
          <div data-collapsible="" className="space-y-1">
            <button
              type="button"
              aria-expanded={checksOpen}
              onClick={() => setChecksOpen(!checksOpen)}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-full text-xs text-fg-soft hover:text-fg"
            >
              <span
                aria-hidden="true"
                className="grid size-4 place-items-center rounded-full bg-ok text-[0.6rem] leading-none text-on-status"
              >
                ✓
              </span>
              {m.tools.length} {m.tools.length === 1 ? "check" : "checks"}
              <Icon
                name="chevron"
                className={`size-3.5 transition-transform ${checksOpen ? "rotate-90" : ""}`}
              />
            </button>
            {checksOpen && checksList}
          </div>
        ))}
      {(m.checks.length > 0 || isTemplateFallback(m)) && (
        <ol aria-label="Answer checks" className="m-0 list-none space-y-1 p-0 text-xs text-fg-soft">
          {m.checks.map((c) => (
            <li key={c.attempt} className="flex items-start gap-1.5">
              <span aria-hidden="true">{c.ok ? "✓" : "↺"}</span>
              <span>
                {c.ok
                  ? "Answer checked against the township data"
                  : `Sent back for a rewrite: ${(c.issues ?? []).join("; ")}`}
              </span>
            </li>
          ))}
          {isTemplateFallback(m) && (
            <li className="flex items-start gap-1.5">
              <span aria-hidden="true">✓</span>
              <span>Answer built from the checked data without AI wording</span>
            </li>
          )}
        </ol>
      )}
      {uncertain.length > 0 && (
        <div
          role="note"
          className="flex gap-2.5 rounded-xl border border-dashed border-lilac/60 bg-warn-tint px-3 py-2.5 text-fg"
        >
          <span
            aria-hidden="true"
            className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border border-dashed border-lilac text-[0.6rem] font-semibold text-lilac"
          >
            ?
          </span>
          <span>
            <strong className="font-semibold">Not verified · </strong>
            {uncertain.join("; ")}
          </span>
        </div>
      )}
      {m.disclaimer && (
        <div role="note" className="rounded-xl border border-edge bg-raised px-3 py-2.5 text-fg">
          <span aria-hidden="true" className="font-semibold text-lantern">
            ≈{" "}
          </span>
          {m.disclaimer.text}
          {links.length > 0 && (
            <span className="mt-1 block text-fg-soft">
              Official sources:{" "}
              {links.map((l, i) => (
                <span key={l.href}>
                  {i > 0 && ", "}
                  <a className="underline" href={l.href} target="_blank" rel="noopener noreferrer">
                    {l.label ?? l.href}
                  </a>
                </span>
              ))}
            </span>
          )}
        </div>
      )}
      {m.citations.length > 0 && (
        <section aria-label="Evidence">
          <CitationList citations={m.citations} names={names} />
        </section>
      )}
      {m.vrs.length > 0 && (
        <p className="flex items-center gap-1.5 text-fg-soft">
          <Icon name="ticket" className="size-4" />
          {m.vrs.length === 1 ? "A check has" : `${m.vrs.length} checks have`} been requested from
          the township team.
        </p>
      )}
      {m.error && (
        <div role="alert" className="space-y-2">
          <p>{m.error}</p>
          <Button variant="outline" onClick={onRetry}>
            Try again
          </Button>
        </div>
      )}
    </article>
  );
}
