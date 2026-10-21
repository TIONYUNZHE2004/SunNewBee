import { useEffect, useRef, useState } from "react";
import type { SimResidents } from "../planTypes";
import { ResidentsButton } from "./ResidentsButton";
import { RESIDENTS_PANEL_ID, ResidentsPanel } from "./ResidentsPanel";
import { buttonVisible, SCRIPTED_RESIDENT, scriptStep } from "./residentsScript";

/**
 * Simulated residents on the map (spec D10, §6.2, §6.3; AC-W7): the button from 33 s, the panel,
 * and the scripted taps at 39 s / 41 s while playing (skipped once the user has touched it).
 * Takes the playhead as props, so the building overlay drives it (wired in with C7/C11).
 */
export function ResidentsLayer({
  data,
  t,
  playing,
  scriptedId = SCRIPTED_RESIDENT,
}: {
  data: SimResidents;
  t: number;
  playing: boolean;
  scriptedId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [userOpened, setUserOpened] = useState(false);
  const touched = useRef(false);
  const prevT = useRef(t);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const id = data.residents.some((r) => r.id === scriptedId) ? scriptedId : null;
    for (const a of scriptStep(prevT.current, t, playing, touched.current, scriptedId)) {
      if (a.kind === "reset") touched.current = false;
      else if (a.kind === "close") {
        setOpen(false);
        setSelected(null);
      } else if (a.kind === "open-panel") {
        setUserOpened(false);
        setOpen(true);
        setSelected(null);
      } else if (a.kind === "open-detail" && id) {
        setUserOpened(false);
        setOpen(true);
        setSelected(id);
      }
    }
    prevT.current = t;
  }, [t, playing, data, scriptedId]);

  if (!buttonVisible(t)) return null;
  const touch = () => {
    touched.current = true;
  };
  const close = () => {
    touch();
    setOpen(false);
    setSelected(null);
    buttonRef.current?.focus();
  };
  return (
    <div data-testid="devsim-residents" className="flex flex-col items-start gap-2">
      <ResidentsButton
        ref={buttonRef}
        count={data.residents.length}
        colours={data.residents.slice(0, 3).map((r) => r.colour)}
        expanded={open}
        controls={RESIDENTS_PANEL_ID}
        onClick={() => {
          touch();
          if (open) close();
          else {
            setUserOpened(true);
            setSelected(null);
            setOpen(true);
          }
        }}
      />
      {open && (
        <ResidentsPanel
          data={data}
          selectedId={selected}
          focusOnOpen={userOpened}
          onSelect={(id) => {
            touch();
            setSelected(id);
          }}
          onBack={() => {
            touch();
            setSelected(null);
          }}
          onClose={close}
        />
      )}
    </div>
  );
}
