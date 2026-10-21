"""Template library for the Development Simulation's forty simulated residents (spec §6.1.6, D11).

Lines are written for the simulation, never by a model at run time. A line is an opener chosen by
(side, phase, tone) plus, for the construction and handover phases, a tail chosen by persona
group; the daily-life line is chosen by (tone) with a persona-group reason. Every key has at
least six variants. The only numbers a template can hold are `{extra}` and `{n}`, filled from that
resident's own facts; `devsim_residents.check_line` rejects anything else. No line says "safe",
names a water level or a depth, forecasts anything, or spells a number out in words.

Keys:
- OPENERS[(side, phase, tone)] for phase "construction" or "handover";
- TAILS[(group, "construction")] and TAILS[(group, "handover", side)];
- DAILY[tone] with tone "pos" (<= 12 min), "neg" (longer), "?" (partly unverified),
  "gap" (no mapped connection) or "blocked" (a known barrier for their profile);
- WHY[(group, tone)] for the daily "pos" / "neg" reason.
"""

from __future__ import annotations

OPENERS: dict[tuple[str, str, str], list[str]] = {
    # Neighbours whose usual walk got >= 2 min longer: {extra} and {to} are facts.
    ("neighbour", "construction", "detour"): [
        "Footpath beside the site closed lah, my walk to {to} is {extra} min longer now.",
        "Must go round the hoarding every day, {extra} min extra to {to}.",
        "The walk to {to} takes {extra} min more since the hoarding went up, haiz.",
        "Every morning I detour around the site, {extra} min more to {to}.",
        "The hoarding closed my shortcut, now {extra} min extra to reach {to}.",
        "Aiyo, {extra} min more just to get to {to} with the footpath closed.",
    ],
    # Neighbours whose walks did not change much: the work itself.
    ("neighbour", "construction", "neg"): [
        "Piling noise from morning until evening, so leceh.",
        "Dust on my car every day since the work started.",
        "Lorries going in and out the whole day, very noisy lah.",
        "The crane swings right past my window, cannot get used to it.",
        "Concrete mixers at the junction again, jam lah.",
        "So much noise lah, even if my usual walks are the same as before.",
    ],
    ("neighbour", "construction", "pos"): [
        "My usual walks are the same as before, the hoarding is not in my way.",
        "Noisy lah, but the footpath on my side is still open.",
        "Not bad, the work stays behind the hoarding.",
        "Can still walk my usual way, the hoarding does not block me.",
        "Quite interesting to watch the tower go up from my road.",
        "The site looks tidy, my walks have not changed.",
    ],
    # Future tower residents, watching it being built.
    ("tower", "construction", "pos"): [
        "We drive past every weekend to see how many floors are up.",
        "Every month I check the progress photos, so excited.",
        "Our unit is still sky only, but can see the tower growing.",
        "Our family is saving up for the renovation while they build.",
        "Showed my family the site, they cannot wait.",
        "The tower grows every time I pass by, best.",
    ],
    ("tower", "construction", "neg"): [
        "Waiting so long for our keys, haiz.",
        "Rainy days slow the work, hope our handover is not late.",
        "We are still paying rent while waiting for our unit, tough lah.",
        "Hard to imagine living there while it is all scaffolding.",
        "Every delay notice makes me worry a bit.",
        "The site is so dusty, hope the area is nicer by handover.",
    ],
    ("tower", "handover", "pos"): [
        "We got our keys at last!",
        "Boxes everywhere, but it feels like home already.",
        "First night in the new unit, the view is best.",
        "We all ran straight to the window when we came in.",
        "The lift is busy with everyone moving in, but we made it.",
        "Our new home is finally ready lah.",
    ],
    ("tower", "handover", "neg"): [
        "Moving day lah, the lift queue was so long.",
        "Boxes still everywhere, penat.",
        "The car park is full of moving lorries, haiz.",
        "Still waiting for the internet to be connected.",
        "So many small defects to list, slowly lah.",
        "Moving in is tiring, my back is aching.",
    ],
    ("neighbour", "handover", "pos"): [
        "Eh, new neighbours ah? Welcome!",
        "The area feels livelier with the new tower.",
        "Hoarding gone, the footpath beside the site is open again.",
        "More people at the mall now, good for the shops.",
        "Nice to see the tower windows light up at night.",
        "The footpath is back, my usual walk is easy again.",
    ],
    ("neighbour", "handover", "neg"): [
        "More cars at the junction now, haiz.",
        "Parking near the mall is harder now.",
        "Moving lorries blocking the road the whole weekend.",
        "The view from my window is all tower now.",
        "The playground is more crowded lah.",
        "The road outside is busier in the evening now.",
    ],
}

TAILS: dict[tuple[str, ...], list[str]] = {
    # Construction: (group, "construction"), for tower and neighbour residents alike.
    ("older", "construction"): [
        "At my age I take things slowly anyway.",
        "I tell my friends about it over teh tarik.",
        "My grandchildren keep asking what they are building.",
        "I still keep to my morning routine.",
        "I just take it easy lah.",
        "My children call to ask about it.",
    ],
    ("parent", "construction"): [
        "The kids keep asking about the crane.",
        "My little one waves at the lorries every day.",
        "I plan the school run around the site now.",
        "The children count the floors from the car.",
        "Must hold the kids' hands near the site gate.",
        "My son wants to be a crane driver now.",
    ],
    ("commuter", "construction"): [
        "I pass the site on my way to work.",
        "My morning drive goes right past the crane.",
        "I see a new floor most weeks on my way home.",
        "I leave a bit earlier for work now.",
        "After work I check how far it has come.",
        "My office friends ask when it will be done.",
    ],
    ("wheelchair", "construction"): [
        "I check the kerbs before I go out.",
        "I plan my route before I leave home.",
        "I hope the new footpaths will have ramps.",
        "My family helps me check the way first.",
        "I go out a bit later when the lorries are gone.",
        "I keep an eye on which paths stay open.",
    ],
    ("general", "construction"): [
        "Everyone in the area talks about it.",
        "The neighbourhood group chat is full of photos.",
        "I am curious what it will look like.",
        "My friends ask me about it all the time.",
        "I watch it from the bus stop sometimes.",
        "It has become a landmark already.",
    ],
    # Handover, tower residents (moving in): (group, "handover", "tower").
    ("older", "handover", "tower"): [
        "At my age, a lift to the front door is a blessing.",
        "My grandchildren already want to sleep over.",
        "I will bring some kuih to meet the neighbours.",
        "Slowly I will unpack, no rush.",
        "My children helped carry everything up.",
        "I like the quiet corridor on our floor.",
    ],
    ("parent", "handover", "tower"): [
        "The kids already found the playground.",
        "My little one made a friend in the lift.",
        "Now to sort out the school run from here.",
        "The children love their new room.",
        "Busy week, but the kids are happy.",
        "Must childproof the windows first.",
    ],
    ("commuter", "handover", "tower"): [
        "Now to figure out the drive to work from here.",
        "Moving in after work every evening, tiring.",
        "I took leave for moving day.",
        "The commute from here looks manageable.",
        "Weekends are for unpacking now.",
        "Will try walking to the mall after work.",
    ],
    ("wheelchair", "handover", "tower"): [
        "I hope the lifts and ramps are all working.",
        "I will try the paths around the tower slowly.",
        "Good if the lobby door is easy to open.",
        "My family set up the unit so I can move around.",
        "First I will learn the way to the lift.",
        "Will see how the paths around here feel.",
    ],
    ("general", "handover", "tower"): [
        "The residents' group chat is busy already.",
        "Curious to see how the area feels at night.",
        "My friends want to visit the new place.",
        "It feels like a new chapter for us.",
        "So many new faces in the lobby.",
        "The view from up here is something else.",
    ],
    # Handover, neighbours (the tower opens beside them): (group, "handover", "neighbour").
    ("older", "handover", "neighbour"): [
        "At my age, new faces are nice to see.",
        "I will bring some kuih to say hello.",
        "Good to have more people around in the evening.",
        "Slowly I will get to know everyone.",
        "My morning walk has company now.",
        "I wave at the new families from my porch.",
    ],
    ("parent", "handover", "neighbour"): [
        "My kids have new friends to play with.",
        "More children at the playground now.",
        "The school run might get busier, we will see.",
        "My little one waves at the tower lights.",
        "Good for the kids to have more friends nearby.",
        "We met a new family at the park already.",
    ],
    ("commuter", "handover", "neighbour"): [
        "My drive to work feels busier at the junction.",
        "I leave a bit earlier again, just in case.",
        "More cars in the morning now.",
        "At least the lorries are gone from my route.",
        "After work the area feels livelier.",
        "My office friends ask if the area is crowded now.",
    ],
    ("wheelchair", "handover", "neighbour"): [
        "I hope the paths around the tower stay clear.",
        "I will try the reopened footpath slowly.",
        "My family checks the new paths with me.",
        "Good if the new kerbs are lowered.",
        "I keep an eye on the paths near the tower.",
        "Will see how the area feels for me now.",
    ],
    ("general", "handover", "neighbour"): [
        "The neighbourhood group chat is busy again.",
        "Curious to see how the area changes.",
        "It feels like a new chapter for Elmina.",
        "Let us see how the evenings feel now.",
        "The area looks quite different already.",
        "More people around, more life lah.",
    ],
}

DAILY: dict[str, list[str]] = {
    "pos": [
        "{place} is only {n} min walk from home, {why}.",
        "{n} min to {place} on foot, {why}.",
        "Can walk to {place} in {n} min, {why}.",
        "Just {n} min walk to {place}, {why}.",
        "From our door to {place} is {n} min, {why}.",
        "{place} in {n} min on foot, {why}.",
    ],
    "neg": [
        "{place} is {n} min walk away, {why}.",
        "{n} min on foot to {place}, {why}.",
        "Takes me {n} min to walk to {place}, {why}.",
        "Walking to {place} takes {n} min, {why}.",
        "{n} min each way to {place}, {why}.",
        "It is {n} min to {place} on foot, {why}.",
    ],
    "?": [
        "The way to {place} is not fully checked for {who} yet, so I ask around first.",
        "Some of the way to {place} is not checked yet for {who}, so I plan ahead.",
        "Not sure about the whole way to {place} for {who}, parts are not checked yet.",
        "Parts of the path to {place} are still unchecked for {who}, so I go with someone.",
        "Can get to {place}, but parts of the way are not checked for {who} yet.",
        "The route to {place} has unchecked bits for {who}, so I take it slow.",
    ],
    "gap": [
        "The map has no mapped way from home to {place} yet, a data gap.",
        "No mapped connection to {place} from here yet, the map is missing a bit.",
        "The map cannot join our place to {place} yet, a gap in the data.",
        "From home to {place} the map has a gap, so I ask my neighbours.",
        "There is no mapped path to {place} from here yet.",
        "The map is still missing the way to {place} from our side.",
    ],
    "blocked": [
        "The mapped way to {place} has a known barrier for {who}.",
        "There is a known barrier on the way to {place} for {who}, so I go another way.",
        "For {who}, the way to {place} has a known barrier on the map.",
        "The map shows a known barrier for {who} on the way to {place}.",
        "Getting to {place} means a known barrier for {who} on the way.",
        "A known barrier for {who} sits on the mapped way to {place}.",
    ],
}

WHY: dict[tuple[str, str], list[str]] = {
    ("older", "pos"): ["nice for my morning walk", "easy for me", "good for my evening stroll"],
    ("older", "neg"): ["a bit far at my age", "so I take a rest halfway", "a bit far for me"],
    ("parent", "pos"): ["the kids love it", "easy with the children", "very convenient for us"],
    ("parent", "neg"): ["too far with the kids", "so we usually drive", "tiring with little ones"],
    ("commuter", "pos"): ["handy after work", "very convenient", "I go there most evenings"],
    ("commuter", "neg"): ["so I usually drive", "a bit far after work", "so I go by car"],
    ("wheelchair", "pos"): ["when the way is clear", "quite manageable for me", "not bad at all"],
    ("wheelchair", "neg"): ["quite far for me", "so my family drives me", "tiring for me"],
    ("general", "pos"): ["very convenient", "not bad at all", "best lah"],
    ("general", "neg"): ["a bit far lah", "so I usually drive", "quite far actually"],
}

WHO = {"wheelchair": "a wheelchair", "stroller": "a stroller", "default": "walking"}
# Which targets a persona group talks about in the daily-life line (one is picked per resident).
TOPICS = {
    "older": ("park", "clinic"),
    "parent": ("school", "park"),
    "commuter": ("mall", "park"),
    "wheelchair": ("mall", "clinic"),
    "general": ("mall", "park"),
}
POS_MAX_MIN = 12  # a daily walk this short is told as a plus (as the mall bubble's rule)
