import createClient from "openapi-fetch";
import type { components, paths } from "./schema";

export type Schemas = components["schemas"];
export type ChatEvent = Schemas["ChatEventDoc"]["event"];
export type SceneIntent = Schemas["SceneIntent"];
export type Site = Schemas["SiteInfo"];
export type SiteBoundary = Schemas["SiteBoundary"];
export type RouteResult = Schemas["RouteResult"];
export type Scenario = Schemas["Scenario"];
export type VerificationRequest = Schemas["VerificationRequest"];
export type { components };

export function makeClient(baseUrl = "/api") {
  return createClient<paths>({ baseUrl });
}

export const client = makeClient();
