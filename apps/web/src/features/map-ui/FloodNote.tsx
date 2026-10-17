import { useScenarios } from "../../lib/api";
import { useScene } from "../scene/sceneStore";
import { InSlot } from "./mapSlots";

const LINK = "font-medium text-lilac underline underline-offset-2";

/** Shown whenever a river-level scenario is on: indicative, never a forecast or a depth. */
export function FloodNote() {
  const scenarioId = useScene((s) => s.scenarioId);
  const { data } = useScenarios();
  if (!scenarioId || scenarioId === "baseline") return null;
  const sc = data?.find((s) => s.id === scenarioId);
  const label = typeof sc?.stage_m === "number" ? `+${sc.stage_m} m` : (sc?.label ?? scenarioId);
  return (
    <InSlot name="flood">
      <div role="note" className="glass rounded-2xl px-4 py-2 text-sm text-fg sm:rounded-full">
        <p className="m-0">
          <span className="font-medium">
            River {label} · Indicative scenario, not a forecast · Official guidance:
          </span>{" "}
          <a
            className={LINK}
            href="https://www.mbsa.gov.my"
            target="_blank"
            rel="noopener noreferrer"
          >
            MBSA
          </a>
          {" / "}
          <a
            className={LINK}
            href="https://publicinfobanjir.water.gov.my"
            target="_blank"
            rel="noopener noreferrer"
          >
            JPS
          </a>
          {" / "}
          <a
            className={LINK}
            href="https://www.nadma.gov.my"
            target="_blank"
            rel="noopener noreferrer"
          >
            NADMA
          </a>
        </p>
        {sc?.disclaimer && <p className="m-0 mt-1 text-xs text-fg-soft">{sc.disclaimer}</p>}
      </div>
    </InSlot>
  );
}
