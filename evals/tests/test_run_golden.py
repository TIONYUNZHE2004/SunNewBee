"""The golden runner's per-case `world` key (D-T3 fix round 1, minor 4)."""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import run_golden as rg  # noqa: E402


def test_an_unknown_world_fails_the_case_with_a_clear_message(tmp_path, monkeypatch, capsys):
    cases = tmp_path / "hero.yaml"
    cases.write_text(
        '- id: typo-world\n  world: elmnia\n  message: "hi"\n  expect: {}\n', encoding="utf-8"
    )
    monkeypatch.setattr(rg, "GOLDEN", cases)
    monkeypatch.delenv("GOLDEN_REAL", raising=False)
    monkeypatch.delenv("GOLDEN_ONLY", raising=False)
    monkeypatch.delenv("GOLDEN_REPORT", raising=False)
    assert asyncio.run(rg.main()) == 1
    out = capsys.readouterr().out
    assert "FAIL" in out and "unknown world 'elmnia' (known: tiny, elmina)" in out
