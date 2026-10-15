import type { Profile } from "../scene/sceneStore";

export const TRAVEL_ORDER: Profile[] = [
  "default",
  "stroller",
  "wheelchair",
  "older_adult_rest",
  "drive",
];

export const TRAVEL_LABELS: Record<Profile, string> = {
  default: "Walking",
  stroller: "Stroller",
  wheelchair: "Wheelchair",
  older_adult_rest: "Older adult (rest stops)",
  drive: "Driving",
};
