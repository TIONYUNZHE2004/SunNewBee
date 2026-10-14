import type { Profile } from "../features/scene/sceneStore";

const KEY = "tl.profile";
const PROFILES: Profile[] = ["default", "stroller", "wheelchair", "older_adult_rest", "drive"];

export function loadProfile(): Profile {
  try {
    const v = localStorage.getItem(KEY);
    return PROFILES.includes(v as Profile) ? (v as Profile) : "default";
  } catch {
    return "default";
  }
}

export function saveProfile(p: Profile): void {
  try {
    localStorage.setItem(KEY, p);
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
