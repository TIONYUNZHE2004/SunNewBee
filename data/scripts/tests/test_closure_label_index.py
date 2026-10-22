import shutil
from pathlib import Path

from townshiplens_spatial import events
from townshiplens_spatial.world import load_world

from data.scripts.build_closure_labels import build

TINY = Path(__file__).resolve().parents[3] / "packages/spatial/tests/fixtures/tiny"


def test_compiled_labels_match_rebuild_and_reject_stale_names(tmp_path, monkeypatch):
    dest = tmp_path / "world"
    shutil.copytree(TINY, dest)
    result = build(dest)
    fresh = load_world(dest)
    expected = events._unnamed_stretches(fresh, use_compiled=False)
    fresh.graph.graph.pop("_closure_unnamed_stretches")

    def unexpected(*a, **kw):
        raise AssertionError("compiled labels should be used")

    with monkeypatch.context() as m:
        m.setattr(events, "Counter", unexpected)
        assert events._unnamed_stretches(fresh) == expected
    assert result["source_fingerprint"] == events.label_fingerprint(fresh)
    fresh.edges["seg-ab"].name = "New mapped road"
    fresh.graph.graph.pop("_closure_unnamed_stretches")
    actual = events._unnamed_stretches(fresh)
    assert "seg-ab" not in actual
    assert events.label_fingerprint(fresh) != result["source_fingerprint"]
    assert actual == events._unnamed_stretches(fresh, use_compiled=False)
