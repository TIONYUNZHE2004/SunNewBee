import hmac
from typing import Annotated

from fastapi import Depends, Header, HTTPException

from .settings import DEFAULT_STAFF_TOKEN, ApiSettings


def require_staff(x_staff_token: Annotated[str | None, Header()] = None) -> None:
    configured = ApiSettings().staff_token
    if not configured or configured == DEFAULT_STAFF_TOKEN:
        raise HTTPException(503, "staff token not configured")
    if x_staff_token is None or not hmac.compare_digest(
        x_staff_token.encode(), configured.encode()
    ):
        raise HTTPException(401, "staff token required")


StaffOnly = Depends(require_staff)
