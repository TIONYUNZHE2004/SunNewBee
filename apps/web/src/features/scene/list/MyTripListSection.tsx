import { TripStrip } from "../../day/TripStrip";
import { parseTrip } from "../../day/tripModel";
import { useScene } from "../sceneStore";

/** The list view's account of a resident's own rehearsed trip (Cycle 20): the same departure
 * strip as the answer card, with every departure spelled out as words for screen readers. */
export function MyTripListSection() {
  const myTrip = useScene((s) => s.myTrip);
  const trip = parseTrip(myTrip?.geojson);
  if (!trip?.meta.sweep?.length) return null;
  return (
    <section
      aria-labelledby="mytrip-h"
      className="rounded-lg border border-dashed border-lilac bg-card p-4"
    >
      <h2 id="mytrip-h" className="text-xl font-semibold">
        Your trip · rehearsal
      </h2>
      {trip.meta.cut_by?.length ? (
        <p className="mt-1 text-sm text-ink-soft">
          Flooded at the time you leave (indicative): {trip.meta.cut_by.join(", ")}.
        </p>
      ) : null}
      <div className="mt-2">
        <TripStrip meta={trip.meta} />
      </div>
    </section>
  );
}
