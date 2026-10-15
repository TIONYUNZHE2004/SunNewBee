import json
import sys
from pathlib import Path

from townshiplens_api.main import app

if __name__ == "__main__":
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "openapi.json")
    # Explicit UTF-8 + LF, so a Windows run produces the same bytes as CI (no drift).
    out.write_text(
        json.dumps(app.openapi(), indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n"
    )
    print(f"wrote {out}")
