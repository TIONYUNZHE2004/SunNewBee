from pathlib import Path

import pytest
from townshiplens_spatial.world import load_world

TINY = Path(__file__).parent / "fixtures" / "tiny"


@pytest.fixture
def world():
    return load_world(TINY)
