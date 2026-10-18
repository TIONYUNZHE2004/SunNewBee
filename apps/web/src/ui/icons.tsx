export type IconName =
  | "walk"
  | "stroller"
  | "wheelchair"
  | "older"
  | "car"
  | "flood"
  | "recycle"
  | "pin"
  | "route"
  | "check"
  | "ticket"
  | "compass"
  | "chevron"
  | "send"
  | "camera"
  | "close"
  | "map"
  | "chat";

const PATHS: Record<IconName, string> = {
  walk: "M13 4a1.5 1.5 0 1 0 0 .01M10 21l2-6 3 3v3M9 12l2-3 3 1 2 3M8 9l3-1",
  stroller:
    "M4 5h4l3 7h8a5 5 0 0 0-5-5h-2M7 19a1.5 1.5 0 1 0 0 .01M17 19a1.5 1.5 0 1 0 0 .01M6 12h13",
  wheelchair: "M11 4a1.5 1.5 0 1 0 0 .01M11 7v6h5l2 5M8 11a6 6 0 1 0 8 6",
  older: "M10 4a1.5 1.5 0 1 0 0 .01M9 21l1-6 2 2v4M8 10l3-2 2 3 2 1M16 12v9",
  car: "M5 16V12l2-5h10l2 5v4M5 16h14M7 19a1 1 0 1 0 0 .01M17 19a1 1 0 1 0 0 .01M5 12h14",
  flood:
    "M3 15c2 0 2-1.5 4.5-1.5S10 15 12 15s2.5-1.5 4.5-1.5S19 15 21 15M3 19c2 0 2-1.5 4.5-1.5S10 19 12 19s2.5-1.5 4.5-1.5S19 19 21 19M12 3l4 6h-8z",
  recycle:
    "M7 19H4l2.5-4.5M17 19h3l-2.5-4.5M12 4l1.5 2.5M9 8l3-5 3 5M8 19h8M5.5 12 9 7M18.5 12 15 7",
  pin: "M12 21s-6-5.5-6-10a6 6 0 1 1 12 0c0 4.5-6 10-6 10zM12 11a2 2 0 1 0 0 .01",
  route:
    "M6 19a2 2 0 1 0 0 .01M18 5a2 2 0 1 0 0 .01M6 17V9a3 3 0 0 1 3-3h4M18 7v8a3 3 0 0 1-3 3h-4",
  check: "M5 12l4 4 10-10",
  ticket: "M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4zM14 7v10",
  compass: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15 9l-2 5-4 1 2-5z",
  chevron: "M9 6l6 6-6 6",
  send: "M4 12l16-8-6 16-2-6z",
  camera: "M4 8h4l2-2h4l2 2h4v11H4zM12 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  close: "M6 6l12 12M18 6 6 18",
  map: "M9 4 3 6.5v13.5L9 17.5l6 2.5 6-2.5V4l-6 2.5zM9 4v13.5M15 6.5V20",
  chat: "M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4 3.5V16H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM8.5 10.5h.01M12 10.5h.01M15.5 10.5h.01",
};

export function Icon({ name, className = "size-5" }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
