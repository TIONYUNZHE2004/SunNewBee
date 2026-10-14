"""Evidence photo storage: random hex ids, one flat directory, paths resolved strictly inside it.
The uploaded filename is never stored or echoed."""

import os
import re
import secrets
from pathlib import Path

from .settings import ApiSettings

MAX_BYTES = 5 * 1024 * 1024
EXT = {"jpeg": "jpg", "png": "png"}
MEDIA = {"jpg": "image/jpeg", "png": "image/png"}
_ID = re.compile(r"^[0-9a-f]{32}$")


def root() -> Path:
    d = ApiSettings().evidence_dir
    d.mkdir(parents=True, exist_ok=True)
    return d.resolve()


def valid_id(evidence_id: str) -> bool:
    return bool(_ID.fullmatch(evidence_id))


def path_for(evidence_id: str) -> Path | None:
    """The stored file for an id, or None for a malformed or unknown id. Never builds a path
    from anything but a validated hex id plus a fixed extension, then re-checks containment."""
    if not valid_id(evidence_id):
        return None
    base = root()
    for ext in EXT.values():
        p = (base / f"{evidence_id}.{ext}").resolve()
        if p.parent == base and p.is_file():
            return p
    return None


def save(kind: str, data: bytes) -> str:
    base = root()
    evidence_id = secrets.token_hex(16)
    p = base / f"{evidence_id}.{EXT[kind]}"
    # O_EXCL + 0600: never overwrite, never follow a pre-planted link.
    fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(data)
    return evidence_id


def photo_url(evidence_id: str) -> str:
    return f"/evidence/{evidence_id}"
