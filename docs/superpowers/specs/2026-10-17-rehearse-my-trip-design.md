# Rehearse my trip (design, 17 Oct 2026)

**Status:** building on `ai/world-model-2` (overnight session 2). Owner: AI lane.

## Why

Elmina Day (Cycles 10–18) is a staff tool: the planner watches 5,000 synthetic residents live a rehearsed day. The People track is about residents. A resident wants to know about *their own* trip: "I take my kids from home to SK Denai Alam at 7:00 with a stroller. What happens in the storm rehearsal?" This feature runs that one trip through the same rehearsed day, with the same engine, and shows when it gets through and when it doesn't.

## What it does

- **Input:** the day (weekday, storm, event or friday), from and to places (ids from `find_place`), the profile (default, stroller, wheelchair, older adult who rests, or car), and the time to leave (HH:MM).
- **Engine:** `Day.travel()` on the cached rule-based day (`tools._day_result`). The trip uses the same river stages minute by minute, the same staff closures and the same re-planning when the water changes on the way. It is a non-essential trip: if there is no way at the time of leaving, that time has no way. Nothing new is invented.
- **Output:**
  - the trip at the asked time: got there / got there after re-planning / turned back / no way at that time / no mapped connection (data gap), plus the minutes it took against a normal day, the waiting time and how many unchecked stretches it crossed;
  - the flooded streets that cut it: segments on the normal-day route that are flooded at that minute's river stage, by name;
  - a **departure sweep** every 10 minutes around the asked time. Each departure gets an outcome, so the resident sees the window when the trip went through in the rehearsal, when it was cut, and when the way came back.

## Honesty rules (validator, mock and template change together)

- The answer says it is a rehearsal (not a forecast). On a real storm day the resident follows official MBSA, JPS and NADMA guidance.
- **No advice and no safety words:** never "safe", never "you should leave at", never "will". Allowed: "in the rehearsal, a trip leaving at 06:40 got there at 06:58; one leaving at 07:00 found no way until 12:10".
- Every time and number comes from the tool. Clock times are text in the payload, so they are never counted as counts.
- **Lenient routing is stated.** The rehearsal lets unchecked paths be used, as residents do. The answer says how many unchecked stretches the trip crossed. For a checked step-free route the resident asks for the route itself (`plan_route`), whose status rules are unchanged.
- No mapped connection is a data gap, never "not reachable".

## Where it shows

- **Assistant (both modes):** the `rehearse_my_trip` tool plus a server-built `day.trip` scene intent. The answer card shows the departure strip; the map opens the day at the asked time and draws the trip.
- **Resident mode:** a "Rehearse my trip" control (from, to, leave at, day) as an added control; the design is unchanged.

## Not in scope

The way back home, several stops, and real-time data.
