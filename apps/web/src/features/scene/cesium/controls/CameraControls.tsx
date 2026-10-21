import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { useState } from "react";
import { useDevsim } from "../../../devsim/devsimStore";
import { useBehindFullSheet } from "../../../main/usePanelReserve";
import { InSlot } from "../../../map-ui/mapSlots";
import { useCameraHeading } from "./cameraHeadingStore";
import { keyAction, STEP } from "./cameraMath";
import type { CameraOps } from "./cameraOps";
import { useCameraUi } from "./cameraUiStore";

const TEXT_INPUT = /^(INPUT|TEXTAREA|SELECT)$/;

/** Keyboard on the focused map only; never from a text field or with a modifier held. */
export function handleMapKey(e: ReactKeyboardEvent, ops: CameraOps | null) {
  const t = e.target as HTMLElement;
  if (!ops || e.altKey || e.ctrlKey || e.metaKey) return;
  if (TEXT_INPUT.test(t.tagName) || t.isContentEditable) return;
  if (e.key.toLowerCase() === "n") {
    e.preventDefault();
    ops.faceNorth();
    return;
  }
  const a = keyAction(e.key);
  if (!a) return;
  e.preventDefault();
  if (a.kind === "move") ops.move(a.right, a.forward);
  else if (a.kind === "orbit") ops.orbit(a.dHeading, a.dPitch);
  else ops.zoom(a.factor);
}

function Btn({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid size-11 place-items-center rounded-full border border-edge bg-surface/90 text-fg shadow-md backdrop-blur hover:bg-raised"
    >
      <span aria-hidden="true">{children}</span>
    </button>
  );
}

/** The compass reads the heading store, so only these controls re-render on camera moves. */
export function CameraControls({ ops }: { ops: CameraOps | null }) {
  const { alwaysShow, hintDismissed, dismissHint } = useCameraUi();
  const [peek, setPeek] = useState(false);
  const open = alwaysShow || peek;
  const heading = useCameraHeading((s) => s.heading);
  const hidden = useBehindFullSheet();
  // the Development Simulation drives the camera: no drag hint over its stage
  const devsim = useDevsim((s) => s.status !== "idle");
  if (!ops) return null;
  return (
    <>
      {!hintDismissed && !devsim && (
        <InSlot name="hint">
          <div
            role="note"
            className="flex items-center gap-3 rounded-full border border-edge bg-surface/90 px-4 py-2 text-sm text-fg shadow-md backdrop-blur"
          >
            <span>Drag to move · Scroll to zoom · Right-drag to rotate</span>
            <button
              type="button"
              aria-label="Dismiss camera tips"
              onClick={dismissHint}
              className="grid size-8 place-items-center rounded-full hover:bg-fg/10"
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
        </InSlot>
      )}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: hover/focus only reveals more buttons */}
      {/* biome-ignore lint/a11y/useSemanticElements: a fieldset would add a border and legend; this is a toolbar-style group */}
      <div
        role="group"
        aria-label="Camera"
        onMouseEnter={() => setPeek(true)}
        onMouseLeave={() => setPeek(false)}
        onFocus={() => setPeek(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setPeek(false);
        }}
        className={`absolute bottom-[calc(var(--sheet-h,0px)+var(--attr-h,0px)+1rem)] right-[calc(var(--panel-w,0px)+4.5rem)] z-20 flex items-end gap-2${hidden ? " invisible" : ""}`}
      >
        {open && (
          <div className="flex flex-col gap-2 motion-safe:animate-[fadeIn_200ms_ease-out]">
            <Btn label="Home view" onClick={ops.home}>
              ⌂
            </Btn>
            <Btn label="Whole township" onClick={ops.whole}>
              ⤢
            </Btn>
            <Btn label="Zoom in (+)" onClick={() => ops.zoom(STEP.zoomIn)}>
              +
            </Btn>
            <Btn label="Zoom out (−)" onClick={() => ops.zoom(STEP.zoomOut)}>
              −
            </Btn>
          </div>
        )}
        {open && (
          <div className="flex flex-col gap-2">
            <Btn label="Tilt up (R)" onClick={() => ops.orbit(0, STEP.tiltRad)}>
              ⤒
            </Btn>
            <Btn label="Tilt down (F)" onClick={() => ops.orbit(0, -STEP.tiltRad)}>
              ⤓
            </Btn>
            <Btn label="Rotate left (Q)" onClick={() => ops.orbit(-STEP.orbitRad, 0)}>
              ↺
            </Btn>
            <Btn label="Rotate right (E)" onClick={() => ops.orbit(STEP.orbitRad, 0)}>
              ↻
            </Btn>
          </div>
        )}
        <Btn label="Face north (N)" onClick={ops.faceNorth}>
          <span style={{ display: "inline-block", transform: `rotate(${-heading}rad)` }}>➤</span>
        </Btn>
      </div>
    </>
  );
}
