import type { Lens } from "../scene/sceneStore";

/** Plain questions the mock assistant can answer. The persona is sent in the request, not the text. */
export const SUGGESTIONS: Record<Lens, string[]> = {
  access: [
    "Can I get to the lakeside mall with a stroller?",
    "Can I get to the lakeside mall in a wheelchair?",
    "Can I get to the lakeside mall if I am an older adult who needs to rest?",
    "Can I get to the lakeside mall on foot?",
  ],
  flood: [
    "Where is the nearest evacuation centre if the water rises 3 m?",
    "Which routes to the lakeside mall are cut off if the water rises 3 m?",
    "Where is the nearest evacuation centre if the water rises 1 m?",
  ],
  waste: ["Where can I drop off recycling nearby?"],
};

/** The lens whose questions to offer: flood, then waste, then access. */
export function activeLens(visible: Record<Lens, boolean>): Lens {
  if (visible.flood) return "flood";
  if (visible.waste) return "waste";
  return "access";
}

export const suggestionsFor = (lens: Lens): string[] => SUGGESTIONS[lens];

export const WHERE_CAN_I_GO = "Where can I go?";
