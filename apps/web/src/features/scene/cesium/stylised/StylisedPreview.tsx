import "cesium/Build/Cesium/Widgets/widgets.css";
import * as Cesium from "cesium";
import { useEffect, useRef, useState } from "react";
import { useCesium, Viewer } from "resium";
import { useTheme } from "../../../../ui/theme";
import { homeView } from "../home";
import { StylisedCity, type StylisedReady } from "./StylisedCity";

/**
 * DEV-ONLY preview of the stylised city at /dev/stylised (registered only when
 * import.meta.env.DEV, so it is not in production builds). A bare viewer with no base imagery, so
 * it makes no billable or keyed requests. Exposes `window.__tlStylised` for the frame-time spike.
 */

interface Stats extends StylisedReady {
  /** ms from navigation start to the first rendered frame with every building primitive ready. */
  firstFrameMs?: number;
  /** ms from buildings data parsed to that frame. */
  dataToFrameMs?: number;
}

declare global {
  interface Window {
    __tlStylised?: {
      stats?: Stats;
      orbit: (seconds: number, range_m: number) => Promise<{ fps: number; p95Ms: number }>;
      look: (range_m: number, pitchDeg?: number, headingDeg?: number) => void;
    };
  }
}

function look(viewer: Cesium.Viewer, range_m: number, pitchDeg = -45, headingDeg = 0) {
  const h = homeView(undefined);
  viewer.camera.lookAt(
    Cesium.Cartesian3.fromDegrees(h.lon, h.lat, 0),
    new Cesium.HeadingPitchRange(
      Cesium.Math.toRadians(headingDeg),
      Cesium.Math.toRadians(pitchDeg),
      range_m,
    ),
  );
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
  viewer.scene.requestRender();
}

function Probe({ onStats }: { onStats: (s: Stats) => void }) {
  const { viewer } = useCesium();
  const stats = useRef<Stats | undefined>(undefined);
  const ready = (info: StylisedReady) => {
    const parsedAt = performance.now() - info.buildMs;
    stats.current = { ...info };
    if (!viewer || viewer.isDestroyed()) return;
    const off = viewer.scene.postRender.addEventListener(() => {
      const prims = viewer.scene.primitives;
      for (let i = 0; i < prims.length; i++) {
        const p = prims.get(i) as { ready?: boolean };
        if (p.ready === false) {
          viewer.scene.requestRender();
          return;
        }
      }
      off();
      const now = performance.now();
      stats.current = { ...info, firstFrameMs: now, dataToFrameMs: now - parsedAt };
      onStats(stats.current);
      if (window.__tlStylised) window.__tlStylised.stats = stats.current;
    });
    viewer.scene.requestRender();
  };

  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    look(viewer, homeView(undefined).range_m);
    window.__tlStylised = {
      stats: stats.current,
      look: (r, p, h) => look(viewer, r, p, h),
      orbit: (seconds, range_m) =>
        new Promise((resolve) => {
          const times: number[] = [];
          const off = viewer.scene.postRender.addEventListener(() => times.push(performance.now()));
          const t0 = performance.now();
          const step = () => {
            const t = performance.now() - t0;
            if (t >= seconds * 1000) {
              off();
              const dts = times.slice(1).map((v, i) => v - times[i]!);
              dts.sort((a, b) => a - b);
              const span = (times[times.length - 1] ?? 0) - (times[0] ?? 0);
              resolve({
                fps: span > 0 ? (dts.length * 1000) / span : 0,
                p95Ms: dts[Math.floor(dts.length * 0.95)] ?? 0,
              });
              return;
            }
            look(viewer, range_m, -35, (t / (seconds * 1000)) * 360);
            requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        }),
    };
    return () => {
      delete window.__tlStylised;
    };
  }, [viewer]);

  return <StylisedCity onReady={ready} />;
}

export default function StylisedPreview() {
  const theme = useTheme((s) => s.theme);
  const toggle = useTheme((s) => s.toggle);
  const [stats, setStats] = useState<Stats | null>(null);
  return (
    <div className="relative h-dvh w-full">
      <div className="absolute left-2 top-2 z-10 flex items-center gap-2 rounded-md border border-line bg-surface/95 px-2 py-1 text-xs text-fg">
        <span>DEV stylised preview</span>
        <button type="button" className="rounded border border-line px-2 py-1" onClick={toggle}>
          {theme === "night" ? "Day" : "Night"}
        </button>
        {stats && (
          <span data-testid="stylised-stats">
            {stats.buildings} buildings · {stats.primitives} primitives · build{" "}
            {Math.round(stats.buildMs)} ms · first frame {Math.round(stats.firstFrameMs ?? 0)} ms
          </span>
        )}
      </div>
      <Viewer
        full={false}
        style={{ width: "100%", height: "100%" }}
        requestRenderMode
        baseLayer={false}
        baseLayerPicker={false}
        timeline={false}
        animation={false}
        geocoder={false}
        homeButton={false}
        sceneModePicker={false}
        navigationHelpButton={false}
        infoBox={false}
        selectionIndicator={false}
        fullscreenButton={false}
      >
        <Probe onStats={setStats} />
      </Viewer>
    </div>
  );
}
