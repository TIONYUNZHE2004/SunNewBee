"""Belief over unchecked facts: how likely is a fact to pass, before anyone has checked it?

This is the Township World Model's one learned part, kept honest. It is an empirical-Bayes
Beta-Bernoulli model per (path type, attribute):

- **Prior:** pseudo-counts from regional OpenStreetMap tags (`belief_prior.json`, built by
  `data/scripts/build_belief_prior.py`), else Beta(1, 1), which means no information.
- **Update:** every *real* verified claim in the world passes or fails the strictest walking
  limits. Demo values (`team_survey_placeholder`), what-if claims and imported or reported tags
  never count.

**Planning only.** It ranks which facts staff should check first and estimates how many journeys
a survey plan would confirm. It never changes an edge's evaluation and never reaches a resident
answer.
"""

from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .evaluate import _CHECKS
from .world import World

EXCLUDED_EVIDENCE = {"team_survey_placeholder", "whatif"}
# attribute -> (limit key, violates)
CHECKED = {attr: (key, fn) for key, (attr, fn) in _CHECKS.items()}


@dataclass
class Belief:
    alpha: dict[tuple[str, str], float] = field(default_factory=lambda: defaultdict(lambda: 1.0))
    beta: dict[tuple[str, str], float] = field(default_factory=lambda: defaultdict(lambda: 1.0))
    sources: dict[str, int] = field(default_factory=dict)

    def q(self, edge_type: str, attribute: str) -> float:
        """P(an unchecked `attribute` on a `edge_type` path passes): the Beta mean."""
        a, b = self.alpha[(edge_type, attribute)], self.beta[(edge_type, attribute)]
        return a / (a + b)

    def table(self) -> list[dict[str, Any]]:
        keys = sorted(set(self.alpha) | set(self.beta))
        return [
            {
                "edge_type": t,
                "attribute": a,
                "alpha": self.alpha[(t, a)],
                "beta": self.beta[(t, a)],
                "q": round(self.q(t, a), 3),
            }
            for t, a in keys
        ]


def load_prior(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _strictest(world: World, limit_key: str) -> float | None:
    vals = [p.hard[limit_key] for p in world.profiles.values() if limit_key in p.hard]
    if not vals:
        return None
    return min(vals) if limit_key.startswith("max") else max(vals)


def build(world: World, prior: dict | None = None) -> Belief:
    b = Belief()
    obs = 0
    for attr, per in ((prior or {}).get("counts") or {}).items():
        for edge_type, c in per.items():
            b.alpha[(edge_type, attr)] += float(c.get("pass", 0))
            b.beta[(edge_type, attr)] += float(c.get("fail", 0))
            obs += int(c.get("pass", 0)) + int(c.get("fail", 0))
    staff = 0
    for e in world.edges.values():
        for attr, c in e.claims.items():
            if attr not in CHECKED or c.status != "verified" or c.value is None:
                continue
            if (c.evidence_type or "") in EXCLUDED_EVIDENCE:
                continue
            key, violates = CHECKED[attr]
            limit = _strictest(world, key)
            if limit is None:
                continue
            if violates(c.value, limit):
                b.beta[(e.type, attr)] += 1
            else:
                b.alpha[(e.type, attr)] += 1
            staff += 1
    b.sources = {"osm_prior_obs": obs, "staff_verified": staff}
    return b
