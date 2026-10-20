"""Forgiving place-name search (T-022): "type it sloppy, still found".

1. Normalise: lower case, no punctuation, single spaces; Malaysian short forms both ways
   (sk = sekolah kebangsaan, smk, sjk, sra, tmn = taman, jln = jalan, kg = kampung, sek, bkt).
2. Word prefixes in any order: every typed word starts some word of the name ("sk tam",
   "bukit subang sk" -> SK Taman Bukit Subang).
3. Small typos: 1 wrong letter in a word of 4+ letters, 2 in 8+ ("surau at takwa").
4. Rank: exact > all words > with typos; ties: the name starts with the typed words, the place
   is inside City of Elmina (base/boundary.geojson), the shorter name.
The decision (use it / ask which / did you mean) belongs to the caller: `decide`.
"""

import json
import re
import unicodedata
from functools import cache
from pathlib import Path

# Short form -> long form. Long forms are matched as whole word sequences.
SHORT_FORMS = {
    "smk": "sekolah menengah kebangsaan",
    "sjk": "sekolah jenis kebangsaan",
    "sra": "sekolah rendah agama",
    "sk": "sekolah kebangsaan",
    "sek": "sekolah",
    "tmn": "taman",
    "jln": "jalan",
    "kg": "kampung",
    "kpg": "kampung",
    "bkt": "bukit",
}
_LONG = sorted(((v.split(), k) for k, v in SHORT_FORMS.items()), key=lambda t: -len(t[0]))

EXACT, WORDS, TYPO, PARTIAL = "exact", "words", "typo", "partial"
SCORE = {EXACT: 1.0, WORDS: 0.88, TYPO: 0.85}


def normalise(text: str) -> str:
    text = unicodedata.normalize("NFKC", text or "").casefold()
    text = re.sub(r"[^\w\s㐀-鿿]", " ", text)
    return " ".join(text.split())


def name_words(name: str) -> set[str]:
    """The words of a name plus its short forms and long forms (both ways)."""
    words = normalise(name).split()
    out = set(words)
    for i in range(len(words)):
        for long, short in _LONG:
            if words[i : i + len(long)] == long:
                out.add(short)
        if words[i] in SHORT_FORMS:
            out.update(SHORT_FORMS[words[i]].split())
    return out


def canonical(text: str) -> str:
    """Normalised text with long forms replaced by their short form (for exact comparison)."""
    words = normalise(text).split()
    out, i = [], 0
    while i < len(words):
        for long, short in _LONG:
            if words[i : i + len(long)] == long:
                out.append(short)
                i += len(long)
                break
        else:
            out.append(words[i])
            i += 1
    return " ".join(out)


def _edits(a: str, b: str) -> int:
    """Levenshtein distance, with an adjacent swap counted as one edit."""
    prev2, prev = None, list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cost = 0 if ca == cb else 1
            v = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
            if prev2 is not None and i > 1 and j > 1 and ca == b[j - 2] and a[i - 2] == cb:
                v = min(v, prev2[j - 2] + 1)
            cur.append(v)
        prev2, prev = prev, cur
    return prev[-1]


def _allowed_typos(word: str) -> int:
    return 2 if len(word) >= 8 else 1 if len(word) >= 4 else 0


def word_match(q: str, words: set[str]) -> str | None:
    """WORDS when `q` starts some name word, TYPO when it does so within the typo allowance."""
    if any(w.startswith(q) for w in words) and (len(q) >= 2 or q in words):
        return WORDS
    k = _allowed_typos(q)
    if k and any(
        _edits(q, w) <= k or (len(w) > len(q) and _edits(q, w[: len(q)]) <= k)
        for w in words
        if abs(len(w) - len(q)) <= k or len(w) > len(q)
    ):
        return TYPO
    return None


_FILLER = {"the", "a", "an"}


def _names(names: list[str]) -> list[str]:
    """A leading "Elmina" is optional: "Urban Park" is Elmina Urban Park."""
    out = [n for n in names if n]
    for n in list(out):
        words = n.split()
        if len(words) >= 3 and words[0].casefold() == "elmina":
            out.append(" ".join(words[1:]))
    return out


def _query_tokens(query: str) -> list[str]:
    tokens = normalise(query).split()
    return [t for t in tokens if t not in _FILLER] or tokens


def match(query: str, names: list[str]) -> str | None:
    """How well a typed query matches one of a place's names (name + aliases)."""
    tokens = _query_tokens(query)
    cq = canonical(" ".join(tokens))
    if not cq:
        return None
    names = _names(names)
    if any(cq == canonical(n) for n in names):
        return EXACT
    best = None
    for n in names:
        words = name_words(n)
        kinds = [word_match(t, words) for t in tokens]
        if all(kinds):
            kind = TYPO if TYPO in kinds else WORDS
            if best is None or (best == TYPO and kind == WORDS):
                best = kind
    return best


def starts_with(query: str, name: str) -> bool:
    """The name's first words start with the typed words, in order ("sk tam" -> "SK Taman …";
    short forms count both ways; a leading "Elmina" is optional)."""
    q = canonical(" ".join(_query_tokens(query))).split()
    return any(
        len(n) >= len(q) > 0
        and all(word_match(a, name_words(b)) == WORDS for a, b in zip(q, n, strict=False))
        for n in (canonical(x).split() for x in _names([name]))
    )


def score(query: str, kind: str, name: str) -> float:
    """Exact 1.0; all words 0.88-0.95; with typos 0.85-0.87 (+ start-of-name and coverage)."""
    if kind == EXACT:
        return 1.0
    cover = min(1.0, len(canonical(query)) / max(1, len(canonical(name))))
    if kind == WORDS:  # 0.88-0.95: always 0.05 under an exact match
        return round(SCORE[WORDS] + 0.06 * starts_with(query, name) + 0.01 * cover, 3)
    return round(SCORE[TYPO] + 0.01 * starts_with(query, name) + 0.01 * cover, 3)  # 0.85-0.87


# ----------------------------------------------------------------------------- Elmina bias
@cache
def _boundary(data_dir: str) -> tuple:
    path = Path(data_dir) / "base" / "boundary.geojson"
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return ()
    rings = []
    for f in doc.get("features", []):
        g = f.get("geometry") or {}
        polys = g.get("coordinates", [])
        if g.get("type") == "Polygon":
            polys = [polys]
        for poly in polys if g.get("type") in ("Polygon", "MultiPolygon") else []:
            if poly:
                rings.append(tuple(tuple(pt[:2]) for pt in poly[0]))
    return tuple(rings)


def _inside_ring(pt, ring) -> bool:
    x, y = pt
    inside = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1], strict=True):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / ((y2 - y1) or 1e-12) + x1:
            inside = not inside
    return inside


def in_township(world, coord) -> bool:
    rings = _boundary(str(getattr(world, "data_dir", "")))
    return any(_inside_ring(tuple(coord[:2]), r) for r in rings)


def rank_key(world, query: str, kind: str, place) -> tuple:
    order = {EXACT: 0, WORDS: 1, TYPO: 2, PARTIAL: 3}[kind]
    return (
        order,
        not starts_with(query, place.name),
        not in_township(world, place.coord),
        len(place.name),
        place.id,
    )


# ----------------------------------------------------------------------------- decision
CLOSE = 0.03  # under the 0.06 start-of-name bonus: "sk taman" picks the school


def decide(results: list[dict]) -> str:
    """'use' (one clear winner), 'ask' (2-3 equally good), 'did_you_mean' (only a partial or
    weak match) or 'none'. `results` are find_place rows (score, match), best first."""
    good = [r for r in results if r.get("match") in (EXACT, WORDS, TYPO)]
    if not good:
        return "did_you_mean" if results else "none"
    top = good[0]
    rivals = [
        r
        for r in good[1:]
        if r.get("match") == top.get("match") and top["score"] - r["score"] < CLOSE
    ]
    return "ask" if rivals else "use"
