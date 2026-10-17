"""Remove personal data from a resident's question before it leaves the server (audit F4).

PDPA: an identity card number, a phone number or an email address is never sent to the model
provider, kept in session memory or written to a recorded demo. Malaysian formats first:
MyKad "900101-14-5678" (with or without dashes), mobile "012-345 6789" / "+60 12 345 6789",
landline "03-1234 5678".
"""

import re

_RULES: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+"), "[email removed]"),
    (re.compile(r"(?<!\d)\d{6}-?\d{2}-?\d{4}(?!\d)"), "[IC number removed]"),
    (
        re.compile(r"(?<![\w+])(?:\+?60[-\s]?|0)1\d[-\s]?\d{3,4}[-\s]?\d{4}(?!\d)"),
        "[phone number removed]",
    ),
    (
        re.compile(r"(?<![\w+])(?:\+?60[-\s]?|0)[3-9][-\s]?\d{3,4}[-\s]?\d{4}(?!\d)"),
        "[phone number removed]",
    ),
)


def redact(text: str) -> str:
    """The text with emails, MyKad numbers and phone numbers replaced by a marker."""
    for pattern, marker in _RULES:
        text = pattern.sub(marker, text)
    return text


def has_personal_data(text: str) -> bool:
    return redact(text) != text
