import type { ChatEvent, components } from "@tl/api-client";
import type { ClosureImpact, MarathonResult } from "../closures/closureSimModel";
import type { TripMeta } from "../day/tripModel";
import type { JourneyPlan } from "../journey/timeline";

export type Citation = components["schemas"]["Citation"];
export type Uncertainty = components["schemas"]["Uncertainty"];
export type Disclaimer = components["schemas"]["Disclaimer"];
export type SceneIntent = components["schemas"]["SceneIntent"];
export type VerificationRequested = components["schemas"]["VerificationRequested"];
export type AnswerCheck = components["schemas"]["AnswerCheck"];

export interface ToolChip {
  id: string;
  name: string;
  done: boolean;
  /** tool.call args, for the plain-words step label (ids and queries only). */
  args?: Record<string, unknown>;
}

export interface AssistantMessage {
  role: "assistant";
  id: string;
  text: string;
  /** Provisional summary while the model writes (answer.draft); replaced by the checked text. */
  draft: string;
  draftAttempt: number;
  /** One validator verdict per answer attempt (answer.check). */
  checks: AnswerCheck[];
  tools: ToolChip[];
  citations: Citation[];
  uncertainty?: Uncertainty;
  disclaimer?: Disclaimer;
  vrs: VerificationRequested[];
  error?: string;
  answerStatus?: string;
  route?: {
    id: string;
    status?: string;
    distanceM?: number;
    minutes?: number;
    /** The route line ([lon, lat] pairs) the server attached, for the answer's route sketch. */
    coords?: [number, number][];
  };
  scenarioId?: string;
  /** A rehearsed trip's departures and outcome (day.trip intent meta), for the strip. */
  trip?: TripMeta;
  /** The answer came with a playable trip (journey.play); `plan` is this answer's own trip, so its Watch button never plays another answer's. */
  journey?: { routeId: string; startTime: string; plan: JourneyPlan };
  /** A management closure simulation (closure.show): the result card under the answer. */
  closure?: ClosureImpact;
  /** A proposed marathon course (marathon.show): the course card under the answer. */
  marathon?: MarathonResult;
  /** done.model; "...+template" means the checked data was worded without the AI. */
  model?: string;
  done: boolean;
}

export interface UserMessage {
  role: "user";
  id: string;
  text: string;
}

export type ChatMessage = UserMessage | AssistantMessage;

export const emptyAssistant = (id: string): AssistantMessage => ({
  role: "assistant",
  id,
  text: "",
  draft: "",
  draftAttempt: 0,
  checks: [],
  tools: [],
  citations: [],
  vrs: [],
  done: false,
});

/** Pure reducer: fold one SSE event into the assistant message. scene.intent is handled by the caller. */
export function reduceChatEvent(m: AssistantMessage, ev: ChatEvent): AssistantMessage {
  switch (ev.type) {
    case "text.delta":
      return { ...m, text: m.text + ev.delta };
    case "answer.draft":
      // A new attempt (after the validator sent one back) starts a fresh draft.
      return ev.attempt === m.draftAttempt
        ? { ...m, draft: m.draft + ev.delta }
        : { ...m, draft: ev.delta, draftAttempt: ev.attempt };
    case "answer.check":
      return { ...m, checks: [...m.checks, ev], draft: ev.ok ? m.draft : "" };
    case "tool.call":
      return {
        ...m,
        tools: [...m.tools, { id: ev.id, name: ev.name, done: false, args: ev.args ?? {} }],
      };
    case "tool.result":
      return { ...m, tools: m.tools.map((t) => (t.id === ev.id ? { ...t, done: true } : t)) };
    case "citation":
      return { ...m, citations: [...m.citations, ev] };
    case "uncertainty":
      return { ...m, uncertainty: ev };
    case "disclaimer":
      return { ...m, disclaimer: ev };
    case "verification.requested":
      return { ...m, vrs: [...m.vrs, ev] };
    case "error":
      return { ...m, error: ev.message };
    case "done":
      return { ...m, done: true, answerStatus: ev.answer_status, model: ev.model };
    default:
      return m;
  }
}

/** [lon, lat] pairs of a LineString (or the first line of a MultiLineString); undefined otherwise. */
export function lineCoords(g: unknown): [number, number][] | undefined {
  const geo = g as { type?: string; coordinates?: unknown } | null | undefined;
  const raw =
    geo?.type === "LineString"
      ? geo.coordinates
      : geo?.type === "MultiLineString"
        ? (geo.coordinates as unknown[] | undefined)?.[0]
        : undefined;
  if (!Array.isArray(raw)) return undefined;
  const pts = raw.filter(
    (p): p is [number, number] =>
      Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]),
  );
  return pts.length >= 2 ? pts.map(([x, y]) => [x, y]) : undefined;
}

/** Fold a scene intent into the message: the route summary and scenario the answer is about. */
export function reduceIntent(m: AssistantMessage, i: SceneIntent): AssistantMessage {
  if (i.kind === "route.highlight" && i.route_id)
    return {
      ...m,
      route: {
        id: i.route_id,
        status: i.route_status ?? undefined,
        distanceM: i.distance_m ?? undefined,
        minutes: i.est_minutes ?? undefined,
        coords: lineCoords(i.geojson),
      },
    };
  if (i.kind === "flood.set_level" && i.scenario_id) return { ...m, scenarioId: i.scenario_id };
  if (i.kind === "closure.show" && i.closure) return { ...m, closure: i.closure };
  if (i.kind === "marathon.show" && i.marathon) return { ...m, marathon: i.marathon };
  if (i.kind === "journey.play" && i.journey)
    return {
      ...m,
      journey: {
        routeId: i.journey.route_id,
        startTime: i.journey.start_time,
        plan: i.journey,
      },
    };
  if (i.kind === "day.trip" && i.geojson) {
    // a resident's own rehearsed trip: the strip shows the engine's departures (Cycle 20)
    const meta = (i.geojson as { meta?: TripMeta }).meta;
    if (meta) return { ...m, trip: meta };
  }
  return m;
}

/** "I can't answer that yet" is a normal outcome, shown calmly; a transport error is not. */
export const isRefusal = (m: AssistantMessage): boolean =>
  !m.error && m.answerStatus === "cannot_answer";

/** The AI's answers were all sent back and the reply was built from the checked data alone. */
export const isTemplateFallback = (m: AssistantMessage): boolean =>
  m.done && (m.model ?? "").endsWith("+template");
