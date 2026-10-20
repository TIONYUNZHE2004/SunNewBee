# ruff: noqa: E501
"""T-022: forgiving place-name search, one test per rule (EN and BM)."""

import pytest
from tests_support import TINY
from townshiplens_spatial import tools
from townshiplens_spatial.place_search import canonical, decide, match, name_words, normalise
from townshiplens_spatial.vr_store import VerificationStore
from townshiplens_spatial.world import load_world

SEED = TINY.parents[4] / "data/seed/elmina"
SK = "osm-way-894147407"  # SK Taman Bukit Subang
pytestmark = pytest.mark.skipif(not (SEED / "site.json").exists(), reason="Elmina seed not built")


@pytest.fixture(scope="module")
def ctx():
    return tools.Ctx(world=load_world(SEED), vrs=VerificationStore(":memory:"))


def find(ctx, q):
    rows = tools.find_place(ctx, q).data
    return rows, decide(rows)


# 1. Normalise + Malaysian short forms both ways
def test_normalise_and_short_forms():
    assert normalise("  SK  Taman, Bkt-Subang! ") == "sk taman bkt subang"
    assert canonical("Sekolah Kebangsaan Taman Bukit Subang") == canonical("SK Tmn Bkt Subang")
    assert {"sk", "sekolah", "kebangsaan", "tmn", "bkt"} <= name_words("SK Taman Bukit Subang")


@pytest.mark.parametrize("q", ["SK TAMAN BKT SUBANG", "sekolah kebangsaan taman bukit subang"])
def test_short_and_long_forms_are_exact(ctx, q):
    rows, d = find(ctx, q)
    assert d == "use" and rows[0]["id"] == SK and rows[0]["match"] == "exact"


# 2. Word prefixes, any order
@pytest.mark.parametrize("q", ["sk taman", "sk tam"])
def test_word_prefixes_find_the_school(ctx, q):
    rows, d = find(ctx, q)
    assert d == "use" and rows[0]["id"] == SK and rows[0]["match"] == "words"


@pytest.mark.parametrize("q", ["bukit subang sk", "tmn bukit subang"])
def test_any_order_matches_and_asks_when_two_places_fit(ctx, q):
    rows, d = find(ctx, q)
    names = {r["name"] for r in rows[:2]}
    assert names == {"SK Taman Bukit Subang", "Surau SK Taman Bukit Subang"} and d == "ask"


def test_words_must_all_match():
    assert match("sk taman xyz", ["SK Taman Bukit Subang"]) is None


# 3. Small typos: 1 in 4+ letters, 2 in 8+
@pytest.mark.parametrize("q", ["surau at takwa", "Surau At Tawqa"])
def test_typos_still_find_surau_at_taqwa(ctx, q):
    rows, d = find(ctx, q)
    assert d == "use" and rows[0]["name"] == "Surau At Taqwa" and rows[0]["match"] == "typo"


def test_typo_allowance_by_word_length():
    assert match("takwa", ["Surau At Taqwa"]) == "typo"  # 5 letters, 1 typo
    assert match("tkxwa", ["Surau At Taqwa"]) is None  # 2 typos in 5 letters
    assert match("kebangsxxn", ["Sekolah Kebangsaan"]) == "typo"  # 10 letters, 2 typos
    assert match("sjk", ["SK Desa Aman"]) is None  # 3 letters: no typo allowed


# 4. Rank: exact > words > typo; starts with the typed words; inside Elmina; shorter
def test_rank_prefers_the_name_that_starts_with_the_words(ctx):
    rows, _ = find(ctx, "sk taman")
    assert [r["name"] for r in rows[:2]] == ["SK Taman Bukit Subang", "Surau SK Taman Bukit Subang"]
    assert rows[0]["score"] - rows[1]["score"] >= 0.05


# 5. Decide: use / ask which one / did you mean
def test_two_places_with_one_name_ask_which_one(ctx):
    rows, d = find(ctx, "klinik siti")
    assert d == "ask" and [r["name"] for r in rows[:2]] == ["Klinik Siti", "Klinik Siti"]


def test_no_match_gives_did_you_mean(ctx):
    rows, d = find(ctx, "xyzzy clinic")
    assert d == "did_you_mean" and all(r["match"] == "partial" for r in rows)


def test_nothing_at_all_is_none(ctx):
    assert find(ctx, "my house") == ([], "none")


def test_bm_query_with_short_forms(ctx):
    rows, d = find(ctx, "sek keb tmn bkt subang")
    assert rows[0]["name"] in {"SK Taman Bukit Subang", "Surau SK Taman Bukit Subang"}
    assert d in {"use", "ask"}
