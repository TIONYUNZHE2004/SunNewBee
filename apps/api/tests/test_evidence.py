import struct
import zlib

import pytest
from fastapi.testclient import TestClient
from townshiplens_api import evidence
from townshiplens_api.main import app

c = TestClient(app)
OK = {"X-Staff-Token": "test-token"}


@pytest.fixture(autouse=True)
def _dir(tmp_path, monkeypatch):
    monkeypatch.setenv("EVIDENCE_DIR", str(tmp_path / "evidence"))


def _seg(marker: int, payload: bytes) -> bytes:
    return bytes([0xFF, marker]) + struct.pack(">H", len(payload) + 2) + payload


JPEG = (
    b"\xff\xd8"
    + _seg(0xE0, b"JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00")
    + _seg(0xE1, b"Exif\x00\x00MM\x00*GPSLatitude=3.18 GPSLongitude=101.5")
    + _seg(0xC0, b"\x08\x00\x01\x00\x01\x01\x01\x11\x00")
    + _seg(0xDA, b"\x01\x01\x00\x00\x3f\x00")
    + b"\x12\x34"
    + b"\xff\xd9"
)


def _chunk(t: bytes, d: bytes) -> bytes:
    return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d))


PNG = (
    b"\x89PNG\r\n\x1a\n"
    + _chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
    + _chunk(b"tEXt", b"Comment\x00find-me")
    + _chunk(b"eXIf", b"MM\x00*GPS")
    + _chunk(b"IDAT", zlib.compress(b"\x00\x01\x02\x03"))
    + _chunk(b"IEND", b"")
)


def up(data: bytes, headers=OK, name="../../etc/passwd.jpg", ctype="image/jpeg"):
    return c.post("/evidence", files={"file": (name, data, ctype)}, headers=headers)


def test_upload_jpeg_strips_exif_and_serves_it():
    r = up(JPEG)
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"evidence_id", "photo_url"}
    assert body["photo_url"] == f"/evidence/{body['evidence_id']}"
    assert "passwd" not in r.text
    g = c.get(body["photo_url"])  # public: no token
    assert g.status_code == 200
    assert g.headers["content-type"] == "image/jpeg"
    assert g.headers["cache-control"] == "private, max-age=3600"
    assert g.headers["x-content-type-options"] == "nosniff"
    assert b"Exif" not in g.content and b"GPS" not in g.content
    assert g.content.startswith(b"\xff\xd8") and g.content.endswith(b"\xff\xd9")
    assert b"JFIF" in g.content


def test_upload_png_strips_text_and_exif():
    r = up(PNG, name="x.png", ctype="image/png")
    assert r.status_code == 200
    g = c.get(r.json()["photo_url"])
    assert g.headers["content-type"] == "image/png"
    for t in (b"tEXt", b"eXIf", b"find-me"):
        assert t not in g.content
    assert g.content.startswith(b"\x89PNG") and b"IDAT" in g.content


def test_type_by_magic_bytes_not_filename_or_content_type():
    assert up(b"GIF89a" + b"x" * 50, name="a.jpg", ctype="image/jpeg").status_code == 415
    assert up(b"<html>x</html>", name="a.png", ctype="image/png").status_code == 415
    # A real JPEG is accepted even when labelled as text.
    assert up(JPEG, name="a.txt", ctype="text/plain").status_code == 200


def test_malformed_images_are_400():
    assert up(JPEG[:30]).status_code == 400
    assert up(PNG[:40], ctype="image/png").status_code == 400
    assert up(b"\xff\xd8\xff" + b"\x00" * 10).status_code == 400


def test_oversize_413_and_empty_rejected():
    assert up(JPEG[:-2] + b"\x00" * (5 * 1024 * 1024)).status_code == 413
    assert up(b"").status_code in (400, 415)


def test_auth_401_503_and_missing_file_field(monkeypatch):
    assert c.post("/evidence", files={"file": ("a.jpg", JPEG)}).status_code == 401
    assert up(JPEG, headers={"X-Staff-Token": "wrong"}).status_code == 401
    assert c.post("/evidence", files={"other": ("a.jpg", JPEG)}, headers=OK).status_code == 422
    assert c.post("/evidence", json={"a": 1}, headers=OK).status_code == 415


def test_oversize_declared_content_length_refused_before_reading():
    r = c.post(
        "/evidence",
        content=b"x",
        headers={
            **OK,
            "content-type": "multipart/form-data; boundary=b",
            "content-length": "99999999",
        },
    )
    assert r.status_code == 413


@pytest.mark.parametrize(
    "bad",
    ["nope", "../../etc/passwd", "..%2f..%2fetc%2fpasswd", "A" * 32, "g" * 32, "ab", "0" * 33],
)
def test_bad_id_404(bad):
    assert c.get(f"/evidence/{bad}").status_code == 404


def test_valid_unknown_id_404():
    assert c.get("/evidence/" + "0" * 32).status_code == 404


def test_stored_path_is_random_hex_inside_dir(tmp_path):
    a = up(JPEG).json()["evidence_id"]
    b = up(JPEG).json()["evidence_id"]
    assert a != b and len(a) == 32 and int(a, 16) >= 0
    files = sorted(p.name for p in (tmp_path / "evidence").iterdir())
    assert files == sorted([f"{a}.jpg", f"{b}.jpg"])
    assert evidence.path_for("../x") is None
    assert evidence.path_for(a).parent == (tmp_path / "evidence").resolve()


def test_resolve_with_evidence_id_attaches_and_exposes_photo_url():
    eid = up(JPEG).json()["evidence_id"]
    r = c.post(
        "/verification-requests",
        json={"target_id": "toilet-1", "attribute": "wheelchair"},
        headers=OK,
    )
    vid = r.json()["id"]
    url = f"/verification-requests/{vid}/resolve"
    # A resolve naming evidence that was never uploaded is refused and changes nothing.
    miss = c.post(
        url, json={"action": "verify", "value": "yes", "evidence_id": "0" * 32}, headers=OK
    )
    assert miss.status_code == 422
    junk = c.post(url, json={"action": "verify", "value": "yes", "evidence_id": "../x"}, headers=OK)
    assert junk.status_code == 422
    ok = c.post(url, json={"action": "verify", "value": "yes", "evidence_id": eid}, headers=OK)
    assert ok.status_code == 200, ok.text
    from townshiplens_api import state

    claim = state.get_ctx().world.places["toilet-1"].claims["wheelchair"]
    assert claim.evidence_ids == [eid]
    d = c.get("/places/toilet-1").json()
    ev = [e for e in d["evidence"] if e["attribute"] == "wheelchair"][0]
    assert ev["photo_url"] == f"/evidence/{eid}"
    assert d["data"]["claims"]["wheelchair"]["evidence_ids"] == [eid]
