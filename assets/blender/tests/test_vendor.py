"""Third-party asset intake: vendor.json, the files it names and the credits table (pure)."""

import hashlib
import json
from pathlib import Path

from tl_assets.specs import ROLES

ASSETS_DIR = Path(__file__).resolve().parents[1]
ROOT = ASSETS_DIR.parents[1]
VENDOR = ASSETS_DIR / "vendor"
VENDOR_JSON = VENDOR / "vendor.json"
CREDITS = ROOT / "CREDITS.md"
KINDS = ("trees", "furniture", "people", "vehicles", "construction")
SOURCE_SUFFIXES = {".glb", ".gltf", ".fbx", ".obj"}


def _entries() -> list[dict]:
    assert VENDOR_JSON.is_file(), "assets/blender/vendor/vendor.json must exist (starts as [])"
    data = json.loads(VENDOR_JSON.read_text(encoding="utf-8"))
    assert isinstance(data, list)
    return data


def test_entries_have_the_documented_fields():
    for e in _entries():
        assert {"slug", "kind", "url", "author", "licence", "files", "sha256", "role_map"} <= set(e)
        assert e["kind"] in KINDS, e["slug"]
        assert e["files"], e["slug"]
        for f in e["files"]:
            assert f == f"vendor/{e['kind']}/{e['slug']}/source.glb" or f.startswith(
                f"vendor/{e['kind']}/{e['slug']}/"
            ), f


def test_files_exist_and_match_their_sha256():
    for e in _entries():
        assert set(e["sha256"]) == set(e["files"]), e["slug"]
        for f in e["files"]:
            path = ASSETS_DIR / f
            assert path.is_file(), f
            assert hashlib.sha256(path.read_bytes()).hexdigest() == e["sha256"][f], f


def test_every_url_is_credited():
    credits = CREDITS.read_text(encoding="utf-8")
    assert "Third-party assets" in credits
    for e in _entries():
        assert e["url"] in credits, f"{e['slug']}: {e['url']} is not in CREDITS.md"


def test_role_maps_use_known_roles():
    for e in _entries():
        for material, role in e["role_map"].items():
            assert role in ROLES, (e["slug"], material, role)


def test_no_blend_files_anywhere_under_vendor():
    assert not list(VENDOR.rglob("*.blend")) and not list(VENDOR.rglob("*.blend1"))


def test_every_vendor_folder_is_recorded():
    recorded = {(e["kind"], e["slug"]) for e in _entries()}
    found = set()
    for kind_dir in (p for p in VENDOR.iterdir() if p.is_dir()):
        for slug_dir in (p for p in kind_dir.iterdir() if p.is_dir()):
            found.add((kind_dir.name, slug_dir.name))
    assert found <= recorded, f"folders missing from vendor.json: {sorted(found - recorded)}"
    for e in _entries():
        assert (VENDOR / e["kind"] / e["slug"]).is_dir() or not e["files"], e["slug"]
