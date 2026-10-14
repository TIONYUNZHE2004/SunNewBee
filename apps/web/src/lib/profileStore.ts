import type { Profile } from "../features/scene/sceneStore";

const KEY = "tl.profile";
const PROFILES: Profile[] = ["default", "stroller", "wheelchair", "older_adult_rest", "drive"];

type Store = Pick<Storage, "getItem" | "setItem">;
const browserStore = (): Store | undefined => {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
};

export function loadProfile(store: Store | undefined = browserStore()): Profile {
  try {
    const v = store?.getItem(KEY);
    return PROFILES.includes(v as Profile) ? (v as Profile) : "default";
  } catch {
    return "default";
  }
}

export function saveProfile(p: Profile, store: Store | undefined = browserStore()): void {
  try {
    store?.setItem(KEY, p);
  } catch {
    /* storage unavailable: ignore */
  }
}

export const PROFILE_LABELS: Record<Profile, string> = {
  default: "Walking",
  stroller: "Stroller",
  wheelchair: "Wheelchair",
  older_adult_rest: "Older adult (rest stops)",
  drive: "Driving",
};
export const PROFILE_IDS = PROFILES;
