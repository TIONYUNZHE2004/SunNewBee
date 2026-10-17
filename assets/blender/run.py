"""Build raw glbs with headless Blender, one subprocess per asset.

    uv run python assets/blender/run.py --asset calib [--asset ...] | --all [--preview]

Writes assets/blender/out/raw/<file> (gitignored). A non-zero exit stops the run and names
the asset. Blender is `--blender`, else $BLENDER, else the default Windows install path.
"""

import argparse
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from tl_assets.specs import ASSETS, get_spec  # noqa: E402

DEFAULT_BLENDER = "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe"
BUILD = HERE / "tl_assets" / "build.py"
RAW = HERE / "out" / "raw"


def blender_cmd(blender: str, asset_id: str, out: Path, preview: bool = False) -> list[str]:
    cmd = [
        blender,
        "--background",
        "--factory-startup",
        "--disable-autoexec",
        "--python-exit-code",
        "1",
        "--python",
        str(BUILD),
        "--",
        "--asset",
        asset_id,
        "--out",
        str(out),
    ]
    return [*cmd, "--preview"] if preview else cmd


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--asset", action="append", default=[], help="asset id (repeatable)")
    ap.add_argument("--all", action="store_true", help="every asset in specs.ASSETS")
    ap.add_argument("--blender", default=os.environ.get("BLENDER") or DEFAULT_BLENDER)
    ap.add_argument("--preview", action="store_true", help="also render out/preview/<id>.png")
    args = ap.parse_args(argv)
    ids = list(ASSETS) if args.all else args.asset
    if not ids:
        ap.error("give --asset <id> or --all")
    for asset_id in ids:
        get_spec(asset_id)  # fail fast on an unknown id
    if not Path(args.blender).is_file():
        print(f"Blender not found at {args.blender} (set --blender or $BLENDER)", file=sys.stderr)
        return 2
    for asset_id in ids:  # one Blender process at a time (8 GB machine)
        print(f"== {asset_id}", flush=True)
        proc = subprocess.run(blender_cmd(args.blender, asset_id, RAW, args.preview))
        if proc.returncode != 0:
            print(f"FAILED: {asset_id} (exit {proc.returncode})", file=sys.stderr)
            return proc.returncode
    return 0


if __name__ == "__main__":
    sys.exit(main())
