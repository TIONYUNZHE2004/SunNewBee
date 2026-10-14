# ruff: noqa: E501
"""Polite Overpass client: tiles the bbox, retries with backoff, rotates mirrors, caches to data/cache/."""

import hashlib
import json
import time
from pathlib import Path

import requests

MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
CACHE = Path(__file__).resolve().parents[1] / "cache"

# Counts real (non-cached) HTTP requests made by this process, for etiquette accounting.
REQUESTS_MADE = 0
# Optional hard cap on REQUESTS_MADE (retries included); None = no cap. Cache hits are free.
MAX_REQUESTS: int | None = None


class BudgetExceeded(RuntimeError):
    """Raised instead of making an HTTP request that would exceed MAX_REQUESTS."""


def query(ql: str, retries: int = 6) -> dict:
    global REQUESTS_MADE
    CACHE.mkdir(exist_ok=True)
    key = CACHE / (hashlib.sha1(ql.encode()).hexdigest() + ".json")
    if key.exists():
        return json.loads(key.read_text())
    for attempt in range(retries):
        if MAX_REQUESTS is not None and REQUESTS_MADE >= MAX_REQUESTS:
            raise BudgetExceeded(f"Overpass request budget of {MAX_REQUESTS} used up")
        url = MIRRORS[attempt % len(MIRRORS)]
        REQUESTS_MADE += 1
        try:
            r = requests.post(
                url,
                data={"data": ql},
                timeout=180,
                headers={"User-Agent": "TownshipLens student hackathon (data import)"},
            )
        except requests.RequestException as exc:
            print(f"  overpass error on {url}: {exc}")
            time.sleep(min(60, 5 * 2**attempt))
            continue
        if r.status_code == 200:
            try:
                data = r.json()
            except ValueError:
                data = None
            if data is not None:
                key.write_text(r.text)
                return data
        print(f"  overpass {r.status_code} on {url}; backing off (attempt {attempt + 1}/{retries})")
        time.sleep(min(60, 5 * 2**attempt))
    raise RuntimeError(f"Overpass failed after {retries} attempts")


def tiles(bbox: tuple[float, float, float, float], n: int = 2):
    """bbox = (s, w, n, e); yields n*n sub-bboxes."""
    s, w, nn, e = bbox
    dy, dx = (nn - s) / n, (e - w) / n
    for i in range(n):
        for j in range(n):
            yield (s + i * dy, w + j * dx, s + (i + 1) * dy, w + (j + 1) * dx)
