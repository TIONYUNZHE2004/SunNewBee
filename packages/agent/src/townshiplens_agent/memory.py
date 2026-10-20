"""Short multi-turn memory, so follow-ups work ("and if the river rises another metre?").

PDPA: a session's messages, including the resident's own words, live only in this process's
memory. They are never written to disk, never put in a verification request, and are dropped
after MAX_IDLE_S without use (or when the process restarts). Each session keeps at most MAX_TURNS
turns and the store at most MAX_SESSIONS sessions (least recently used dropped first).

The honesty rules are per turn and unchanged: an answer may cite only evidence returned by tools
in *this* turn, so a follow-up re-runs the tools it needs; earlier turns only give context.
"""

import time
from collections import OrderedDict
from dataclasses import dataclass, field

from pydantic_ai.messages import ModelMessage, ModelRequest, ModelResponse, TextPart, UserPromptPart

MAX_SESSIONS = 200
MAX_TURNS = 6
MAX_IDLE_S = 30 * 60
MAX_CHARS = 6000  # per session: questions + answers kept (oldest turns dropped first)
MAX_ANSWER_CHARS = 1200


@dataclass
class _Turn:
    question: str
    answer: str
    simulated: bool  # the turn ran a world-model simulation (what-if or survey plan)
    route: dict | None = None  # server-selected IDs only; no model-written endpoint facts


@dataclass
class _Session:
    turns: list[_Turn] = field(default_factory=list)
    used: float = field(default_factory=time.monotonic)


class SessionMemory:
    """Compact turns only: the question and the answer text, never tool results, drafts or
    validator retries (they would be replayed on every follow-up and cost tokens)."""

    def __init__(
        self,
        max_sessions: int = MAX_SESSIONS,
        max_turns: int = MAX_TURNS,
        max_idle_s: float = MAX_IDLE_S,
        max_chars: int = MAX_CHARS,
    ) -> None:
        self.max_sessions, self.max_turns, self.max_idle_s = max_sessions, max_turns, max_idle_s
        self.max_chars = max_chars
        self._s: OrderedDict[str, _Session] = OrderedDict()

    def _expire(self, now: float) -> None:
        for sid in [k for k, v in self._s.items() if now - v.used > self.max_idle_s]:
            del self._s[sid]

    def _get(self, session_id: str | None) -> _Session | None:
        if not session_id:
            return None
        now = time.monotonic()
        self._expire(now)
        s = self._s.get(session_id)
        if s is not None:
            s.used = now
            self._s.move_to_end(session_id)
        return s

    def history(self, session_id: str | None) -> list[ModelMessage]:
        """The earlier turns as plain question/answer messages, oldest first."""
        s = self._get(session_id)
        out: list[ModelMessage] = []
        for t in s.turns if s else []:
            out.append(ModelRequest(parts=[UserPromptPart(content=t.question)]))
            out.append(ModelResponse(parts=[TextPart(content=t.answer)]))
        return out

    def simulated(self, session_id: str | None) -> bool:
        s = self._get(session_id)
        return bool(s and any(t.simulated for t in s.turns))

    def route_context(self, session_id: str | None) -> dict | None:
        s = self._get(session_id)
        return dict(s.turns[-1].route) if s and s.turns and s.turns[-1].route else None

    def add_turn(
        self,
        session_id: str | None,
        question: str,
        answer: str,
        simulated: bool = False,
        route: dict | None = None,
    ) -> None:
        if not session_id or not question:
            return
        now = time.monotonic()
        self._expire(now)
        s = self._s.setdefault(session_id, _Session())
        s.turns = [*s.turns, _Turn(question[:2000], answer[:MAX_ANSWER_CHARS], simulated, route)]
        s.turns = s.turns[-self.max_turns :]
        while len(s.turns) > 1 and sum(len(t.question) + len(t.answer) for t in s.turns) > (
            self.max_chars
        ):
            s.turns.pop(0)
        s.used = now
        self._s.move_to_end(session_id)
        while len(self._s) > self.max_sessions:
            self._s.popitem(last=False)

    def forget(self, session_id: str) -> None:
        self._s.pop(session_id, None)

    def __len__(self) -> int:
        return len(self._s)


DEFAULT = SessionMemory()
