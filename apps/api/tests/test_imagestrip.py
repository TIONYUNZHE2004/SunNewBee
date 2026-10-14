import struct
import zlib

import pytest
from townshiplens_api.imagestrip import ImageError, sniff, strip_jpeg, strip_png


def seg(marker: int, payload: bytes) -> bytes:
    return bytes([0xFF, marker]) + struct.pack(">H", len(payload) + 2) + payload


EXIF = seg(0xE1, b"Exif\x00\x00" + b"GPSLatitude" * 5)
JFIF = seg(0xE0, b"JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00")
SOF = seg(0xC0, b"\x08\x00\x01\x00\x01\x01\x01\x11\x00")
SOS = seg(0xDA, b"\x01\x01\x00\x00\x3f\x00")
SCAN = b"\x12\x34\xff\x00\x56\xff\xd0\x78"  # stuffed FF00 and an RST marker are entropy data
DQT = seg(0xDB, b"\x00" + bytes(64))


def jpeg(*mid: bytes, tail: bytes = b"") -> bytes:
    return b"\xff\xd8" + b"".join(mid) + SOF + SOS + SCAN + b"\xff\xd9" + tail


def test_jpeg_strips_exif_com_and_other_app_keeps_jfif_and_data():
    src = jpeg(JFIF, EXIF, seg(0xFE, b"hello comment"), seg(0xEE, b"Adobe"), DQT)
    out = strip_jpeg(src)
    assert b"Exif" not in out and b"hello comment" not in out and b"GPS" not in out
    assert out == jpeg(JFIF, DQT)
    assert out.startswith(b"\xff\xd8") and out.endswith(b"\xff\xd9")


def test_jpeg_drops_non_jfif_app0_and_trailing_bytes():
    out = strip_jpeg(jpeg(seg(0xE0, b"JFXX\x00\x10thumb"), tail=b"SECRETTRAILER"))
    assert b"JFXX" not in out and b"SECRET" not in out


def test_jpeg_second_scan_metadata_dropped():
    src = b"\xff\xd8" + SOF + SOS + SCAN + EXIF + SOS + SCAN + b"\xff\xd9"
    out = strip_jpeg(src)
    assert out == b"\xff\xd8" + SOF + SOS + SCAN + SOS + SCAN + b"\xff\xd9"


@pytest.mark.parametrize(
    "bad",
    [
        b"",
        b"\xff\xd8",
        b"\xff\xd8\xff",
        b"\xff\xd8\xff\xe1",
        b"\xff\xd8\xff\xe1\x00",
        b"\xff\xd8\xff\xe1\x00\x01",  # length below 2
        b"\xff\xd8\xff\xe1\xff\xff" + b"x" * 10,  # length beyond the data
        b"\xff\xd8" + EXIF[:-3],  # truncated segment
        b"\xff\xd8" + SOF + SOS + SCAN,  # no EOI
        b"\xff\xd8" + SOS + SCAN + b"\xff\xd9",  # SOS without a frame header
        b"\xff\xd8" + SOF + b"\xff\xd9",  # EOI without a scan
        b"\x00\x00\xff\xd8",
        b"\xff\xd8" + b"\x00" * 20,  # garbage between segments
        b"\xff\xd8" + SOF + SOS + SCAN + b"\xff",  # dangling FF
    ],
)
def test_jpeg_malformed_rejected(bad):
    with pytest.raises(ImageError):
        strip_jpeg(bad)


def test_jpeg_every_truncation_rejected_or_valid_never_crashes():
    src = jpeg(JFIF, EXIF, DQT)
    for n in range(len(src)):
        try:
            out = strip_jpeg(src[:n])
        except ImageError:
            continue
        assert out.endswith(b"\xff\xd9")


def chunk(t: bytes, data: bytes, crc: int | None = None) -> bytes:
    c = zlib.crc32(t + data) if crc is None else crc
    return struct.pack(">I", len(data)) + t + data + struct.pack(">I", c)


SIG = b"\x89PNG\r\n\x1a\n"
IHDR = chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
IDAT = chunk(b"IDAT", zlib.compress(b"\x00\x01\x02\x03"))
IEND = chunk(b"IEND", b"")


def png(*mid: bytes, tail: bytes = b"") -> bytes:
    return SIG + IHDR + b"".join(mid) + IDAT + IEND + tail


def test_png_drops_ancillary_keeps_critical_and_trns_plte():
    plte = chunk(b"PLTE", b"\x00\x00\x00\xff\xff\xff")
    trns = chunk(b"tRNS", b"\x00")
    src = png(
        chunk(b"tEXt", b"Comment\x00secret"),
        chunk(b"eXIf", b"MM\x00*GPS"),
        chunk(b"iTXt", b"k\x00\x00\x00\x00\x00v"),
        chunk(b"zTXt", b"k\x00\x00xx"),
        chunk(b"tIME", bytes(7)),
        chunk(b"gAMA", bytes(4)),
        plte,
        trns,
    )
    out = strip_png(src)
    assert out == png(plte, trns)
    for t in (b"tEXt", b"eXIf", b"iTXt", b"zTXt", b"tIME", b"secret"):
        assert t not in out


def test_png_trailing_data_dropped():
    assert strip_png(png(tail=b"HIDDEN")) == png()


@pytest.mark.parametrize(
    "bad",
    [
        b"",
        SIG,
        SIG + b"\x00\x00",
        SIG + IHDR,  # no IDAT/IEND
        SIG + IHDR + IDAT,  # no IEND
        SIG + IDAT + IEND,  # IHDR missing first
        SIG + IHDR + chunk(b"IDAT", b"x", crc=0) + IEND,  # bad CRC
        SIG + IHDR + struct.pack(">I", 0x7FFFFFFF) + b"IDAT" + b"x" * 10,  # length beyond data
        SIG + IHDR + struct.pack(">I", 0xFFFFFFFF) + b"IDAT",  # length over spec max
        SIG + IHDR + IEND,  # no IDAT
        SIG + chunk(b"IHDR", b"short") + IDAT + IEND,
        b"\x89PNG\r\n\x1a\x0b" + IHDR + IDAT + IEND,  # bad signature
    ],
)
def test_png_malformed_rejected(bad):
    with pytest.raises(ImageError):
        strip_png(bad)


def test_png_every_truncation_rejected_never_crashes():
    src = png(chunk(b"tEXt", b"a\x00b"))
    for n in range(len(src)):
        with pytest.raises(ImageError):
            strip_png(src[:n])


def test_sniff_by_magic_bytes():
    assert sniff(b"\xff\xd8\xff\xe0rest") == "jpeg"
    assert sniff(SIG + b"rest") == "png"
    assert sniff(b"GIF89a") is None
    assert sniff(b"") is None


def test_jpeg_jfif_canonicalised_and_duplicates_dropped():
    fat = seg(0xE0, b"JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x01\x01SECRETPAYLOAD")
    out = strip_jpeg(jpeg(fat, fat))
    assert b"SECRET" not in out and out.count(b"JFIF") == 1
    assert out == jpeg(JFIF)


@pytest.mark.parametrize("m", [0x02, 0x50, 0xC8, 0xF7, 0xFD])
def test_jpeg_unknown_markers_rejected(m):
    with pytest.raises(ImageError):
        strip_jpeg(jpeg(seg(m, b"hidden")))


def test_png_unknown_critical_chunk_rejected():
    with pytest.raises(ImageError):
        strip_png(png(chunk(b"EXIF", b"SECRET GPS")))
    with pytest.raises(ImageError):
        strip_png(png(chunk(b"MEtA", b"SECRET GPS")))
