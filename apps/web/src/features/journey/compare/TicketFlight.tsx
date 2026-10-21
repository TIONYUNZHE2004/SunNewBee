import type { ScreenPoint } from "../compareStore";

const ease = (k: number) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);

/** Where the flying card is at progress k in [0, 1]: an arc from `from` to `to` (prototype values). */
export function flightPose(from: ScreenPoint, to: ScreenPoint, k: number) {
  const e = ease(Math.max(0, Math.min(1, k)));
  return {
    x: from.x + (to.x - from.x) * e,
    y: from.y + (to.y - from.y) * e - Math.sin(e * Math.PI) * 60,
    scale: 1 - 0.75 * e,
    opacity: 1 - 0.6 * e,
  };
}

/** The ticket card flying from the unchecked stretch to the Tickets chip (AC-N5, 1.8 s). */
export function TicketFlight({
  title,
  text,
  from,
  to,
  progress,
}: {
  title: string;
  text: string;
  from: ScreenPoint;
  to: ScreenPoint;
  progress: number;
}) {
  const p = flightPose(from, to, progress);
  return (
    <div
      data-beat="ticket-flight"
      className="absolute w-[230px] rounded-xl border-l-[5px] border-[#8b7fd6] bg-surface px-2.5 py-2 text-xs text-fg shadow-[0_10px_30px_rgba(44,42,58,.25)]"
      style={{
        left: p.x,
        top: p.y,
        opacity: p.opacity,
        transform: `translate(-50%, -50%) scale(${p.scale})`,
      }}
    >
      <b className="block text-[12.5px]">{title}</b>
      {text}
    </div>
  );
}
