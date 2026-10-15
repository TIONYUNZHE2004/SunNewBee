import { useScenarios } from "../../lib/api";
import { useScene } from "../scene/sceneStore";

const LINK = "font-medium text-lilac underline underline-offset-2";

/** Shown whenever a river-level scenario is on: indicative, never a forecast or a depth. */
export function FloodNote() {
  const scenarioId = useScene((s) => s.scenarioId);
  const { data } = useScenarios();
  if (!scenarioId || scenarioId === "baseline") return null;
  const sc = data?.find((s) => s.id === scenarioId);
  const label = typeof sc?.stage_m === "number" ? `+${sc.stage_m} m` : (sc?.label ?? scenarioId);
  return (
    <div
      role="note"
      className="absolute bottom-4 left-4 z-10 max-w-sm rounded-xl border border-flood bg-surface/95 px-3 py-2 text-sm text-fg shadow-md"
    >
      <p className="m-0 font-medium">River {label} · indicative scenario, not a forecast</p>
      <p className="m-0 mt-1">
        For official guidance see{" "}
        <a
          className={LINK}
          href="https://www.mbsa.gov.my"
          target="_blank"
          rel="noopener noreferrer"
        >
          MBSA
        </a>
        ,{" "}
        <a
          className={LINK}
          href="https://publicinfobanjir.water.gov.my"
          target="_blank"
          rel="noopener noreferrer"
        >
          JPS
        </a>{" "}
        and{" "}
        <a
          className={LINK}
          href="https://www.nadma.gov.my"
          target="_blank"
          rel="noopener noreferrer"
        >
          NADMA
        </a>
        .
      </p>
      {sc?.disclaimer && <p className="m-0 mt-1 text-xs text-fg-soft">{sc.disclaimer}</p>}
    </div>
  );
}
