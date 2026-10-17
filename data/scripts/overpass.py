# ruff: noqa: E501
"""Polite Overpass client: tiles the bbox, retries with backoff, rotates mirrors, caches to data/cache/."""

import hashlib
import json
import re
import time
from datetime import UTC, datetime
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
# Optional endpoint list (import_osm --endpoint). None = rotate MIRRORS on every attempt (default).
# When set, stay on an endpoint through HTTP errors and move to the next one only after a
# connection-level failure.
ENDPOINTS: list[str] | None = None


class OverpassError(RuntimeError):
    """Base class for Overpass fetch failures the import reports as BLOCKED."""


class BudgetExceeded(OverpassError):
    """Raised instead of making an HTTP request that would exceed MAX_REQUESTS."""


class OverpassFailed(OverpassError):
    """Every attempt failed (HTTP error, connection error or an incomplete response)."""


def _cache_key(ql: str) -> Path:
    return CACHE / (hashlib.sha1(ql.encode()).hexdigest() + ".json")


def query(ql: str, retries: int = 6) -> dict:
    global REQUESTS_MADE
    CACHE.mkdir(exist_ok=True)
    key = _cache_key(ql)
    if key.exists():
        return json.loads(key.read_text(encoding="utf-8"))
    current = 0  # index into ENDPOINTS

    def backoff(attempt: int) -> None:
        if attempt + 1 < retries:  # no pointless wait after the final attempt
            time.sleep(min(60, 5 * 2**attempt))

    for attempt in range(retries):
        if MAX_REQUESTS is not None and REQUESTS_MADE >= MAX_REQUESTS:
            raise BudgetExceeded(f"Overpass request budget of {MAX_REQUESTS} used up")
        pool, i = (ENDPOINTS, current) if ENDPOINTS else (MIRRORS, attempt)
        url = pool[i % len(pool)]
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
            current += 1
            backoff(attempt)
            continue
        if r.status_code == 200:
            try:
                data = r.json()
            except ValueError:
                data = None
            if isinstance(data, dict) and data.get("remark"):
                # 200 + remark = timeout / out of memory with truncated elements: incomplete,
                # so never cached as a complete answer.
                print(f"  overpass incomplete answer from {url}: {error_text(data['remark'])}")
                backoff(attempt)
                continue
            if data is not None:
                key.write_text(r.text, encoding="utf-8", newline="\n")
                meta = {"endpoint": url, "fetched_at": datetime.now(UTC).isoformat()}
                key.with_suffix(".meta.json").write_text(
                    json.dumps(meta), encoding="utf-8", newline="\n"
                )
                print(f"  overpass OK from {url} -> {key.name}")
                return data
        head = error_text(r.text or "")  # e.g. Overpass's runtime-error text
        print(
            f"  overpass {r.status_code} on {url}; backing off (attempt {attempt + 1}/{retries})"
            + (f": {head}" if head else "")
        )
        backoff(attempt)
    raise OverpassFailed(f"Overpass failed after {retries} attempts")


_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}")


def data_date(data: dict, ql: str | None = None) -> str | None:
    """YYYY-MM-DD of the OSM data in an answer: its `osm3s.timestamp_osm_base`, else (for a
    cached answer) the fetch time in `<sha>.meta.json`, else None. Never today's date, so a
    rebuild from the cache is byte-identical on any day."""
    ts = (data.get("osm3s") or {}).get("timestamp_osm_base") if isinstance(data, dict) else None
    if isinstance(ts, str) and _DATE.match(ts):
        return ts[:10]
    meta = _cache_key(ql).with_suffix(".meta.json") if ql is not None else None
    if meta is not None and meta.exists():
        try:
            fetched = json.loads(meta.read_text(encoding="utf-8")).get("fetched_at")
        except ValueError:
            fetched = None
        if isinstance(fetched, str) and _DATE.match(fetched):
            return fetched[:10]
    return None


def fetch_elements(queries) -> tuple[list[dict], str | None]:
    """Elements of every query (in order) and the latest data date across the answers (None
    when no answer carries one)."""
    elements: list[dict] = []
    dates: list[str] = []
    for ql in queries:
        data = query(ql)
        elements.extend(data.get("elements", []))
        d = data_date(data, ql)
        if d is not None:
            dates.append(d)
    return elements, max(dates, default=None)


def error_text(body: str, limit: int = 300) -> str:
    """The readable part of an Overpass error page: tags stripped, from the first "Error"
    (Overpass puts the reason there) or else the whole text, whitespace collapsed."""
    text = " ".join(
        re.sub(r"<[^>]*>", " ", re.sub(r"<head>.*?</head>", " ", body, flags=re.S)).split()
    )
    text = text.replace(" :", ":")
    i = text.find("Error")
    return (text[i:] if i >= 0 else text)[:limit]


def tiles(bbox: tuple[float, float, float, float], n: int = 2):
    """bbox = (s, w, n, e); yields n*n sub-bboxes."""
    s, w, nn, e = bbox
    dy, dx = (nn - s) / n, (e - w) / n
    for i in range(n):
        for j in range(n):
            yield (s + i * dy, w + j * dx, s + (i + 1) * dy, w + (j + 1) * dx)
