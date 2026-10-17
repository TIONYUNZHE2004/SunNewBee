"""The audit probes (evals/audit_probes.py) as a regression test on the real Elmina seed."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import audit_probes as ap  # noqa: E402

SEED = Path(__file__).resolve().parents[2] / "data/seed/elmina/site.json"


@pytest.mark.skipif(not SEED.exists(), reason="Elmina seed not present")
def test_every_dishonest_probe_is_rejected_and_the_honest_one_passes(capsys):
    assert ap.main() == 0, capsys.readouterr().out
