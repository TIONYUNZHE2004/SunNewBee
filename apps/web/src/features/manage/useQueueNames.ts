import { useMemo } from "react";
import { useLayer } from "../../lib/api";
import { useElementNames } from "../chat/useElementNames";
import { useScene } from "../scene/sceneStore";
import { edgeNames } from "./queueLabels";

/** Same names as the chat citations (places), plus segment names from the access layer. */
export function useQueueNames(): Map<string, string> {
  const places = useElementNames();
  const profile = useScene((s) => s.profile);
  const scenarioId = useScene((s) => s.scenarioId);
  const access = useLayer("access", profile, scenarioId);
  return useMemo(() => new Map([...edgeNames(access.data), ...places]), [access.data, places]);
}
