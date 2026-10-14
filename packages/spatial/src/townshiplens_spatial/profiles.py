from pathlib import Path

import yaml

from .models import Profile

DEFAULT_DIR = Path(__file__).resolve().parents[4] / "config" / "profiles"


def load_profiles(config_dir: Path | None = None) -> dict[str, Profile]:
    d = config_dir or DEFAULT_DIR
    out = {}
    for f in sorted(d.glob("*.yaml")):
        p = Profile.model_validate(yaml.safe_load(f.read_text()))
        out[p.id] = p
    return out
