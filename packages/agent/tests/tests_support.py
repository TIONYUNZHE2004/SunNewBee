from pathlib import Path

# Same module name and value as packages/spatial/tests/tests_support.py (whichever is imported
# first wins in sys.modules; both point at the shared tiny fixture).
TINY = Path(__file__).resolve().parents[2] / "spatial" / "tests" / "fixtures" / "tiny"
