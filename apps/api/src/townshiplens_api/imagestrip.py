"""Stdlib-only metadata strippers for evidence photos (no Pillow: licence ruling R21).

Both are pure bytes -> bytes functions that raise ImageError on anything malformed or
truncated. Whole segments/chunks are kept or dropped, so nothing is re-encoded and PNG CRCs
stay valid. Anything after the end-of-image marker is discarded too (a classic hiding place).
"""

import struct
import zlib
from typing import Literal

PNG_SIG = b"\x89PNG\r\n\x1a\n"
_SOF = {m for m in range(0xC0, 0xD0) if m not in (0xC4, 0xC8, 0xCC)}
# Everything else (DHT, DAC, DQT, DNL, DRI, EXP, SOS) is image data; any other marker is refused.
_JPEG_DATA = _SOF | {0xC4, 0xCC, 0xDA, 0xDB, 0xDC, 0xDD, 0xDF}
_PNG_KEEP = {b"IHDR", b"PLTE", b"IDAT", b"IEND", b"tRNS"}


class ImageError(ValueError):
    pass


def sniff(data: bytes) -> Literal["jpeg", "png"] | None:
    """Type by magic bytes only; the filename and the client content-type are never used."""
    if data[:3] == b"\xff\xd8\xff":
        return "jpeg"
    if data[:8] == PNG_SIG:
        return "png"
    return None


def strip_jpeg(data: bytes) -> bytes:
    n = len(data)
    if data[:2] != b"\xff\xd8":
        raise ImageError("not a JPEG")
    out = bytearray(b"\xff\xd8")
    i = 2
    seen_sof = seen_sos = seen_jfif = False
    while True:
        if i + 2 > n or data[i] != 0xFF:
            raise ImageError("malformed JPEG")
        while i + 1 < n and data[i + 1] == 0xFF:  # fill bytes before a marker
            i += 1
        if i + 2 > n:
            raise ImageError("truncated JPEG")
        m = data[i + 1]
        i += 2
        if m == 0xD9:  # EOI
            if not seen_sos:
                raise ImageError("JPEG has no scan")
            out += b"\xff\xd9"
            return bytes(out)
        if m == 0xD8 or m == 0x00 or m == 0x01 or 0xD0 <= m <= 0xD7:
            raise ImageError("unexpected marker")
        if i + 2 > n:
            raise ImageError("truncated JPEG")
        (length,) = struct.unpack_from(">H", data, i)
        end = i + length
        if length < 2 or end > n:
            raise ImageError("bad segment length")
        payload = data[i + 2 : end]
        if m == 0xE0 and payload[:5] == b"JFIF\x00" and len(payload) >= 14 and not seen_jfif:
            # Canonical header only: version/units/density kept, any thumbnail or trailing bytes
            # dropped, so the segment cannot carry a payload.
            seen_jfif = True
            out += b"\xff\xe0\x00\x10" + payload[:12] + b"\x00\x00"
        elif 0xE0 <= m <= 0xEF or m == 0xFE:
            pass  # APPn and COM
        elif m in _JPEG_DATA:
            if m in _SOF:
                seen_sof = True
            out += b"\xff" + bytes([m]) + data[i:end]
        else:
            raise ImageError("unexpected marker")
        i = end
        if m == 0xDA:
            if not seen_sof:
                raise ImageError("scan before frame header")
            seen_sos = True
            # Entropy-coded data: runs to the next marker that is not FF00, RSTn or a fill FF.
            j = end
            while True:
                j = data.find(b"\xff", j)
                if j < 0 or j + 1 >= n:
                    raise ImageError("truncated JPEG")
                nxt = data[j + 1]
                if nxt == 0x00 or 0xD0 <= nxt <= 0xD7:
                    j += 2
                elif nxt == 0xFF:
                    j += 1
                else:
                    break
            out += data[end:j]
            i = j


def strip_png(data: bytes) -> bytes:
    n = len(data)
    if data[:8] != PNG_SIG:
        raise ImageError("not a PNG")
    out = bytearray(PNG_SIG)
    i = 8
    first = True
    seen_idat = False
    while True:
        if i + 12 > n:
            raise ImageError("truncated PNG")
        (length,) = struct.unpack_from(">I", data, i)
        ctype = data[i + 4 : i + 8]
        end = i + 12 + length
        if length > 0x7FFFFFFF or end > n:
            raise ImageError("bad chunk length")
        if not all(65 <= c <= 90 or 97 <= c <= 122 for c in ctype):
            raise ImageError("bad chunk type")
        (crc,) = struct.unpack_from(">I", data, end - 4)
        if zlib.crc32(data[i + 4 : end - 4]) != crc:
            raise ImageError("bad chunk CRC")
        if first:
            if ctype != b"IHDR" or length != 13:
                raise ImageError("IHDR must come first")
            first = False
        elif ctype == b"IHDR":
            raise ImageError("duplicate IHDR")
        if ctype == b"IDAT":
            seen_idat = True
        if ctype == b"IEND":
            if length or not seen_idat:
                raise ImageError("bad IEND or no image data")
            out += data[i:end]
            return bytes(out)
        if ctype in _PNG_KEEP:
            out += data[i:end]
        elif not ctype[0] & 0x20:
            raise ImageError("unknown critical chunk")
        i = end
