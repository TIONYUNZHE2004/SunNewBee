import { create } from "zustand";

const SHOW = "tl.camera.alwaysShow";
const HINT = "tl.camera.hint";
const read = (k: string) => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* per-viewer convenience only */
  }
};

interface CameraUi {
  alwaysShow: boolean;
  hintDismissed: boolean;
  setAlwaysShow: (v: boolean) => void;
  dismissHint: () => void;
}

export const useCameraUi = create<CameraUi>((set) => ({
  alwaysShow: read(SHOW) === "true",
  hintDismissed: read(HINT) === "dismissed",
  setAlwaysShow: (v) => {
    write(SHOW, String(v));
    set({ alwaysShow: v });
  },
  dismissHint: () => {
    write(HINT, "dismissed");
    set({ hintDismissed: true });
  },
}));
