import { type Lens, type Profile, useScene } from "../scene/sceneStore";

export interface Suggestion {
  text: string;
  /** Persona the question is about; tapping the chip switches to it. */
  profile?: Profile;
}

/** Plain questions the mock assistant can answer. The persona is sent in the request, not the text. */
export const SUGGESTIONS: Record<Lens, Suggestion[]> = {
  access: [
    { text: "Can I get to the lakeside mall with a stroller?", profile: "stroller" },
    { text: "Can I get to the lakeside mall in a wheelchair?", profile: "wheelchair" },
    {
      text: "Can I get to the lakeside mall if I am an older adult who needs to rest?",
      profile: "older_adult_rest",
    },
    { text: "Is the walk from the urban park to the lakeside mall easy?", profile: "default" },
  ],
  flood: [
    { text: "Where is the nearest evacuation centre if the water rises 3 m?" },
    { text: "Which routes to the lakeside mall are cut off if the water rises 3 m?" },
    { text: "Where is the nearest evacuation centre if the water rises 1 m?" },
  ],
  waste: [{ text: "Where can I drop off recycling nearby?" }],
};

/** The lens whose questions to offer: flood, then waste, then access. */
export function activeLens(visible: Record<Lens, boolean>): Lens {
  if (visible.flood) return "flood";
  if (visible.waste) return "waste";
  return "access";
}

export const suggestionsFor = (lens: Lens): Suggestion[] => SUGGESTIONS[lens];

export const WHERE_CAN_I_GO = "Where can I go?";

/** Tap a chip: switch the selector to its persona, then send with that profile explicitly. */
export function pickSuggestion(
  s: Suggestion,
  send: (text: string, profile?: Profile) => unknown,
): void {
  if (s.profile) useScene.getState().setProfile(s.profile);
  void send(s.text, s.profile);
}
