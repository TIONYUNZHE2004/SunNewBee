import { create } from "zustand";

export type TripEnd = "from" | "to";
export type LonLat = [number, number];

/** "Rehearse my trip": which end the resident is choosing on the map, and the points chosen.
 * Points stay in this tab's memory only; they are sent once, in a request body, never saved. */
export const useTripPick = create<{
  /** The "Rehearse my trip" card is open (opened from its chip beside Travelling as). */
  open: boolean;
  setOpen: (open: boolean) => void;
  picking: TripEnd | null;
  points: Partial<Record<TripEnd, LonLat>>;
  setPicking: (end: TripEnd | null) => void;
  setPoint: (end: TripEnd, p: LonLat | null) => void;
  clear: () => void;
}>((set) => ({
  open: false,
  setOpen: (open) => set(open ? { open } : { open, picking: null, points: {} }),
  picking: null,
  points: {},
  setPicking: (picking) => set({ picking }),
  setPoint: (end, p) =>
    set((s) => {
      const points = { ...s.points };
      if (p) points[end] = p;
      else delete points[end];
      return { points, picking: null };
    }),
  clear: () => set({ picking: null, points: {} }),
}));

/** A point as the API expects it ("lon,lat", about 10 cm precision). */
export const pointText = (p: LonLat) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
