"""Test setup: `assets/blender` and the repo root on sys.path; Blender tests are opt-in."""

import os
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
ASSETS_DIR = HERE.parent
ROOT = ASSETS_DIR.parents[1]
for p in (ASSETS_DIR, ROOT):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

DEFAULT_BLENDER = "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe"


def blender_path() -> str:
    return os.environ.get("BLENDER") or DEFAULT_BLENDER


def pytest_collection_modifyitems(config, items):
    enabled = os.environ.get("TL_BLENDER_TESTS") == "1"
    found = Path(blender_path()).is_file()
    if enabled and found:
        return
    reason = (
        "headless Blender tests are opt-in (TL_BLENDER_TESTS=1)"
        if not enabled
        else f"Blender not found at {blender_path()}"
    )
    skip = pytest.mark.skip(reason=reason)
    for item in items:
        if item.get_closest_marker("blender") is not None:
            item.add_marker(skip)
