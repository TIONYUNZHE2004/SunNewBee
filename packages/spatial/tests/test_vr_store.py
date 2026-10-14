from townshiplens_spatial.vr_store import VerificationStore


def test_vr_dedupe(tmp_path):
    s = VerificationStore(str(tmp_path / "vr.db"))
    a, created_a = s.request("seg-cf", "incline_pct", "unknown", "stroller route")
    b, created_b = s.request("seg-cf", "incline_pct", "unknown", "stroller route again")
    assert created_a and not created_b and a.id == b.id and b.demand == 2
    assert len(s.list()) == 1


def test_resolve(tmp_path):
    s = VerificationStore(str(tmp_path / "vr.db"))
    vr, _ = s.request("seg-cf", "incline_pct", "unknown")
    done = s.resolve(vr.id, "verify", value=4.5, note="inclinometer")
    assert done.status == "resolved" and done.resolution["value"] == 4.5
    assert s.list("open") == []
