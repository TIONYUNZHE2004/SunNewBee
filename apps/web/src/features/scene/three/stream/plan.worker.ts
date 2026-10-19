/**
 * The tile-planning Worker (module worker, bundled by Vite): receives the inputs once (`init`),
 * warms the planners' layer caches off the main thread, then plans one tile per `plan` message with
 * the same `planTile` the main thread uses (identical content per key: deterministic planners).
 */
import {
  fromWire,
  type PlanReply,
  type PlanRequest,
  packReply,
  planTile,
  type TileInputs,
  tileFromKey,
  warmPlanners,
} from "./tilePlan";

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<PlanRequest>) => void) | null;
  postMessage(m: PlanReply, transfer?: Transferable[]): void;
};

let inputs: TileInputs | null = null;

ctx.onmessage = (e) => {
  const m = e.data;
  if (m.type === "init") {
    inputs = fromWire(m.inputs);
    warmPlanners(inputs);
    return;
  }
  try {
    if (!inputs) throw new Error("plan before init");
    const t0 = performance.now();
    const content = planTile(inputs, tileFromKey(m.key), m.ring, m.tier);
    const { reply, transfer } = packReply(m.seq, content, performance.now() - t0);
    ctx.postMessage(reply, transfer);
  } catch (err) {
    ctx.postMessage({ seq: m.seq, error: String(err) });
  }
};
