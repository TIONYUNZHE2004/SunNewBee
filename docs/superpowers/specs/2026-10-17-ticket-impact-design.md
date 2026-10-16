# Ticket impact: what one check would change, and what it changed (Cycle 7 design)

Status: design, 16 Oct 2026, branch `ai/world-model`. This puts value of information on every ticket and makes the team timeline's "close the loop live" ([timeline P2](../../05-team/timeline.md)) visible.

## Intent

Every verification ticket on `/tickets` shows what the township world model says the check means.

**Open ticket:**

> "If it passes, 3 of 21 sampled stroller journeys would become confirmed, including the one this ticket came from. If it fails, 1 would lose its route."

**Resolved ticket:**

> "This check changed 3 of 21 sampled journeys (compared with leaving it unchecked)."

Both also show how the model's belief about this kind of fact moved.

Every number is a rollout on the world model. Nothing is stored, and nothing reaches residents.

## Design

1. **`twm.ForgetFact(element_id, attribute)`.** An internal action, not in the LLM's `Action` vocabulary. It sets the claim back to unknown, for the "before" of a resolved ticket.
2. **`impact.fact_impact(world, element_id, attribute, summary)`.**
   - **Profile and journey:** taken from the ticket summary ("<profile> route <A> -> <B>", with names mapped back to place ids), else wheelchair. The journeys are that profile's first 20 everyday trips plus the ticket's own journey, first.
   - **Open fact:** before (now), pass (`VerifyFact pass`) and fail (`VerifyFact fail`).
   - **Verified fact:** `ForgetFact` (before) compared with now.
   - **Output:** counts that changed status, per direction (became confirmed, lost their route), and the own journey's statuses.
   - **Belief:** q for the path type and attribute, now. For a resolved ticket, also q without this verification.
   - One edge-keyed memo is shared across the three worlds.
3. **`GET /verification-requests/{id}/impact`.** Public, counts only, cached per world version through the world-model slots.
4. **Web.** `ImpactCard` in `TicketDetail`, open or resolved, with "planning estimate" wording for the belief.

## Honesty

- Sample counts are labelled "sampled journeys".
- "Would" is used for open tickets, "changed" only for resolved ones.
- The belief is shown to staff only, as a planning estimate.
- No ticket that is not about a path (`missing_place`) gets an impact; the card says so.
