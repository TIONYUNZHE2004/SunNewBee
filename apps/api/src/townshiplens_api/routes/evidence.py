import re
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from pydantic import BaseModel
from python_multipart.exceptions import MultipartParseError
from python_multipart.multipart import MultipartParser, parse_options_header

from .. import evidence
from ..auth import StaffOnly
from ..imagestrip import ImageError, sniff, strip_jpeg, strip_png

router = APIRouter()
# Multipart framing (boundaries, part headers) on top of the file itself.
_OVERHEAD = 64 * 1024
_NAME = re.compile(rb'(?:^|;)\s*name="([^"]*)"')


class EvidenceUploaded(BaseModel):
    evidence_id: str
    photo_url: str


class _TooBig(Exception):
    pass


async def _read_file_part(request: Request) -> bytes | None:
    """Stream the multipart body through the parser, keeping only the `file` part and aborting
    the moment the cap is exceeded: at most MAX_BYTES + 1 of file data is ever held."""
    _, opts = parse_options_header(request.headers.get("content-type", ""))
    boundary = opts.get(b"boundary")
    if not boundary:
        raise HTTPException(400, "missing multipart boundary")
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > evidence.MAX_BYTES + _OVERHEAD:
        raise HTTPException(413, "file too large")

    buf = bytearray()
    st: dict[str, Any] = {"field": b"", "value": b"", "name": None, "in_file": False, "done": False}

    def on_part_begin() -> None:
        st["name"] = None

    def on_header_field(data: bytes, start: int, end: int) -> None:
        st["field"] += data[start:end]

    def on_header_value(data: bytes, start: int, end: int) -> None:
        st["value"] += data[start:end]  # a chunk boundary can split the value

    def on_header_end() -> None:
        if st["field"].lower() == b"content-disposition":
            m = _NAME.search(st["value"])
            st["name"] = m.group(1) if m else None
        st["field"] = st["value"] = b""

    def on_headers_finished() -> None:
        st["in_file"] = st["name"] == b"file"
        if st["in_file"] and st["done"]:
            raise HTTPException(400, "more than one file part")

    def on_part_data(data: bytes, start: int, end: int) -> None:
        if st["in_file"]:
            buf.extend(data[start:end])
            if len(buf) > evidence.MAX_BYTES:
                raise _TooBig

    def on_part_end() -> None:
        if st["in_file"]:
            st["done"] = True
        st["in_file"] = False

    total = 0
    try:
        parser = MultipartParser(
            boundary,
            callbacks={
                "on_part_begin": on_part_begin,
                "on_header_field": on_header_field,
                "on_header_value": on_header_value,
                "on_header_end": on_header_end,
                "on_headers_finished": on_headers_finished,
                "on_part_data": on_part_data,
                "on_part_end": on_part_end,
            },
        )
        async for chunk in request.stream():
            total += len(chunk)
            if total > evidence.MAX_BYTES + _OVERHEAD:
                raise _TooBig
            parser.write(chunk)
        parser.finalize()
    except _TooBig:
        raise HTTPException(413, "file too large") from None
    except (MultipartParseError, ValueError):
        raise HTTPException(400, "malformed multipart body") from None
    return bytes(buf) if st["done"] else None


@router.post(
    "/evidence",
    response_model=EvidenceUploaded,
    dependencies=[StaffOnly],
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {
                "multipart/form-data": {
                    "schema": {
                        "type": "object",
                        "required": ["file"],
                        "properties": {"file": {"type": "string", "format": "binary"}},
                    }
                }
            },
        }
    },
)
async def upload_evidence(request: Request) -> EvidenceUploaded:
    """Staff-only JPEG/PNG upload (max 5 MB). Type is decided by magic bytes; metadata (EXIF,
    GPS, comments, text chunks) is stripped before anything is stored."""
    if not request.headers.get("content-type", "").lower().startswith("multipart/form-data"):
        raise HTTPException(415, "multipart/form-data required")
    data = await _read_file_part(request)
    if data is None:
        raise HTTPException(422, "file part required")
    kind = sniff(data)
    if kind is None:
        raise HTTPException(415, "only JPEG or PNG images are accepted")
    try:
        clean = await run_in_threadpool(strip_jpeg if kind == "jpeg" else strip_png, data)
    except ImageError:
        raise HTTPException(400, "malformed image") from None
    eid = await run_in_threadpool(evidence.save, kind, clean)
    return EvidenceUploaded(evidence_id=eid, photo_url=evidence.photo_url(eid))


@router.get(
    "/evidence/{evidence_id}",
    response_class=FileResponse,
    responses={200: {"content": {"image/jpeg": {}, "image/png": {}}}},
)
def get_evidence(evidence_id: str) -> FileResponse:
    p = evidence.path_for(evidence_id)
    if p is None:
        raise HTTPException(404, "unknown evidence")
    return FileResponse(
        p,
        media_type=evidence.MEDIA[p.suffix.lstrip(".")],
        headers={
            "Cache-Control": "private, max-age=3600",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
        },
    )
