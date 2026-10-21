"""AC-L7: no brand or model names in the asset scripts, specs, manifests or committed glbs.

Docs and the demo-polish spec are excluded (they hold the banned list itself). The web half
of the scan (`apps/web/src/**`) is a vitest.
"""

import json
import re
import struct
from pathlib import Path

import pytest
from tl_assets import specs

ROOT = Path(__file__).resolve().parents[3]
SCRIPTS = ROOT / "assets" / "blender" / "tl_assets"
CITY = ROOT / "apps" / "web" / "public" / "city"
# spec section 8.1 AC-L7, case-insensitive substrings
BANNED = (
    "myvi",
    "axia",
    "bezza",
    "saga",
    "alza",
    "vios",
    "hilux",
    "persona",
    "x50",
    "proton",
    "perodua",
    "toyota",
    "honda",
    "yamaha",
    "ex5",
    "y15",
)
_RX = re.compile("|".join(BANNED), re.IGNORECASE)


def _hits(text: str) -> list[str]:
    return sorted({m.group(0).lower() for m in _RX.finditer(text)})


def _glb_json(path: Path) -> str:
    data = path.read_bytes()
    (length,) = struct.unpack_from("<I", data, 12)
    return data[20 : 20 + length].decode("utf-8")


def test_the_scan_finds_a_banned_name():
    assert _hits("vehicles__Myvi__LOD0") == ["myvi"]
    assert _hits("compact_hatch small_sedan kapchai delivery_moto bicycle") == []


@pytest.mark.parametrize(
    "path", sorted(p for p in SCRIPTS.rglob("*") if p.suffix in (".py", ".json")), ids=str
)
def test_asset_scripts_name_no_brand(path: Path):
    assert _hits(path.read_text(encoding="utf-8")) == [], path


def test_spec_ids_name_no_brand():
    for s in [*specs.ASSETS.values(), *specs.TEST_ASSETS.values()]:
        assert _hits(s.id) == [], s.id
        for v in s.variants:
            assert _hits(v.id) == [], (s.id, v.id)


def test_committed_manifests_and_glbs_name_no_brand():
    files = sorted(CITY.rglob("*.json")) if CITY.exists() else []
    if not files:
        pytest.skip("no manifest committed yet")
    for p in files:
        json.loads(p.read_text(encoding="utf-8"))
        assert _hits(p.read_text(encoding="utf-8")) == [], p
    for p in sorted(CITY.rglob("*.glb")):
        assert _hits(_glb_json(p)) == [], p
