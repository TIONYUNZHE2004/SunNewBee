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


def test_resolve_unknown_raises_keyerror(tmp_path):
    import pytest

    s = VerificationStore(str(tmp_path / "vr.db"))
    with pytest.raises(KeyError):
        s.resolve("vr-9999", "verify")


def test_resolve_only_open(tmp_path):
    import pytest

    s = VerificationStore(str(tmp_path / "vr.db"))
    vr, _ = s.request("seg-cf", "incline_pct", "unknown")
    s.resolve(vr.id, "reject")
    with pytest.raises(ValueError):
        s.resolve(vr.id, "verify", value=1)


def test_concurrent_requests_dedupe(tmp_path):
    from concurrent.futures import ThreadPoolExecutor

    s = VerificationStore(str(tmp_path / "vr.db"))
    with ThreadPoolExecutor(max_workers=8) as ex:
        res = list(ex.map(lambda _: s.request("seg-cf", "incline_pct", "unknown"), range(20)))
    assert len(res) == 20
    rows = s.list()
    assert len(rows) == 1 and rows[0].demand == 20
    assert s.get(rows[0].id).demand == 20 and s.get("nope") is None
