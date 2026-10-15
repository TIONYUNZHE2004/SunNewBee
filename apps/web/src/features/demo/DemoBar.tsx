import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useSite } from "../../lib/api";
import { useChatDraft } from "../chat/chatDraftStore";
import { useScene } from "../scene/sceneStore";
import { parseDemoParam } from "./demoParam";
import { demoReducer, initialDemoState } from "./demoReducer";
import { HERO_SCRIPT } from "./heroScript";
import { dwellMs, runAction, UNAVAILABLE_NOTE } from "./runAction";

const TOTAL = HERO_SCRIPT.length;
const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
/** Space already activates a focused button or link, so the shortcut must not double up. */
const isActivatable = (t: EventTarget | null) =>
  t instanceof HTMLElement && /^(BUTTON|A)$/.test(t.tagName);

/** Mounted once in the app shell. Renders nothing unless the page was opened with `?demo=hero`. */
export function DemoBar() {
  const { search } = useLocation();
  // Read once: the param is gone after the walkthrough navigates to /manage and back.
  const [active, setActive] = useState(() => parseDemoParam(search) === "hero");
  return active ? <HeroWalkthrough onExit={() => setActive(false)} /> : null;
}

function HeroWalkthrough({ onExit }: { onExit: () => void }) {
  const navigate = useNavigate();
  const site = useSite();
  const spots = site.data?.deep_spots;
  const [state, dispatch] = useReducer(
    (s: typeof initialDemoState, a: Parameters<typeof demoReducer>[2]) => demoReducer(TOTAL, s, a),
    initialDemoState,
  );
  const [unavailable, setUnavailable] = useState(false);
  const ran = useRef<number | null>(null);

  // Run each step's action once when the cursor lands on it (and once site data is known).
  useEffect(() => {
    if (!spots || ran.current === state.index) return;
    ran.current = state.index;
    const step = HERO_SCRIPT[state.index];
    if (!step) return;
    const { applyIntent, setProfile, setScenario } = useScene.getState();
    const result = runAction(step.action, {
      spots,
      applyIntent,
      setProfile,
      setScenario,
      ask: useChatDraft.getState().ask,
      navigate: (to) => navigate(to),
    });
    setUnavailable(result === "unavailable");
  }, [state.index, spots, navigate]);

  // Autoplay.
  useEffect(() => {
    if (!state.playing) return;
    const step = HERO_SCRIPT[state.index];
    const t = setTimeout(() => dispatch({ type: "next" }), step ? dwellMs(step.action) : 7000);
    return () => clearTimeout(t);
  }, [state.playing, state.index]);

  const exit = useCallback(() => {
    onExit();
    navigate("/");
  }, [onExit, navigate]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") return exit();
      if (isTyping(e.target) || (e.key === " " && isActivatable(e.target))) return;
      if (e.key === "ArrowRight") dispatch({ type: "next" });
      else if (e.key === "ArrowLeft") dispatch({ type: "back" });
      else if (e.key === " ") dispatch({ type: "toggle" });
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [exit]);

  const step = HERO_SCRIPT[state.index];
  const btn =
    "min-h-11 rounded-lg border border-line bg-card px-4 text-sm font-medium text-brand hover:bg-brand-tint disabled:opacity-50";
  return (
    <section
      aria-label="Demo walkthrough"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card px-4 py-3 shadow-lg"
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2">
        <p className="text-xs font-medium text-ink-soft">
          Demo {state.index + 1} of {TOTAL}
        </p>
        <p aria-live="polite" className="min-w-0 flex-1 basis-80 text-sm">
          {step?.caption}
          {unavailable ? ` ${UNAVAILABLE_NOTE}` : ""}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={btn}
            disabled={state.index === 0}
            onClick={() => dispatch({ type: "back" })}
          >
            Back
          </button>
          <button type="button" className={btn} onClick={() => dispatch({ type: "toggle" })}>
            {state.playing ? "Pause" : "Play"}
          </button>
          <button
            type="button"
            className={btn}
            disabled={state.index >= TOTAL - 1}
            onClick={() => dispatch({ type: "next" })}
          >
            Next
          </button>
          <button type="button" className={btn} onClick={exit}>
            Exit demo
          </button>
        </div>
      </div>
    </section>
  );
}
