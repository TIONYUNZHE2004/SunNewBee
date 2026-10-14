import { useMemo } from "react";
import { useLayer } from "../../lib/api";
import { pointFeatures } from "../scene/geo";
import { useScene } from "../scene/sceneStore";

export function useElementNames(): Map<string, string> {
  const profile = useScene((s) => s.profile);
  const scenarioId = useScene((s) => s.scenarioId);
  const access = useLayer("access", profile, scenarioId);
  const flood = useLayer("flood", profile, scenarioId);
  return useMemo(
    () =>
      new Map(
        [...pointFeatures(access.data), ...pointFeatures(flood.data)].map((p) => [p.id, p.name]),
      ),
    [access.data, flood.data],
  );
}
