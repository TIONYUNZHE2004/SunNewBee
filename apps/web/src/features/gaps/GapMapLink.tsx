import { Link } from "react-router";

/** From the verification queue to the resident page with the Gaps layer on. */
export function GapMapLink() {
  return (
    <Link
      to="/?gaps=1"
      className="inline-flex min-h-11 items-center rounded-md border border-brand px-4 text-sm font-medium text-brand hover:bg-brand-tint"
    >
      See these gaps on the map
    </Link>
  );
}
