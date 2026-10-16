"""Stream the model's draft summary while it is still writing `final_answer`.

The validated answer still arrives as `text.delta` after `validate.py` accepts it. Before that,
the client gets:

- `answer.draft` deltas: the summary as the model writes it, shown as a provisional draft;
- one `answer.check` per attempt: accepted, or sent back with readable reasons.

That gives a fast first sentence and makes the honesty gate visible: a judge can watch a draft
get rejected and rewritten.

A draft is never final text, and it is guarded with the validator's own wording rules
(`validate.text_errors`). The draft stops at the first text the final check would reject. It is
emitted only up to the last whole word, and a number with a unit is held back until three more
words follow it, so a split word or a depth ("0.5 m of water") cannot slip out before the check
sees it.
"""

import re
from collections.abc import AsyncIterable
from typing import Any

from pydantic_ai import RunContext
from pydantic_ai.messages import (
    AgentStreamEvent,
    PartDeltaEvent,
    PartStartEvent,
    ToolCallPart,
    ToolCallPartDelta,
)
from pydantic_core import from_json

from .events import AnswerCheck, AnswerDraft
from .validate import text_errors

OUTPUT_TOOL = "final_answer"
# Word boundaries: whitespace, or CJK punctuation (Chinese text has no spaces).
_BOUNDARY = re.compile(r"[\s，。；、！？：]")
# A number with a unit near the end of the draft: wait for the words after it.
_MEASURE = re.compile(r"\d+(?:[.,]\d+)?\s?(?:cm|mm|m|km|厘米|米)\b")
_HOLD_WORDS = 3
FORMAT_ISSUE = "did not fill in the answer form correctly"


class DraftStreamer:
    """Turns PydanticAI stream events into `answer.draft` events on the record's queue."""

    def __init__(self, deps: Any) -> None:
        self.deps = deps
        self._index: int | None = None  # part index of the final_answer call being streamed
        self._args = ""
        self._sent = ""  # summary text already emitted for this attempt
        self._stopped = False

    @property
    def rec(self):
        return self.deps.rec

    async def __call__(self, ctx: RunContext, events: AsyncIterable[AgentStreamEvent]) -> None:
        streaming_here = False  # one final_answer per model response is drafted
        async for ev in events:
            if isinstance(ev, PartStartEvent) and isinstance(ev.part, ToolCallPart):
                if ev.part.tool_name != OUTPUT_TOOL or streaming_here:
                    continue
                streaming_here = True
                await self._start_attempt()
                self._index = ev.index
                args = ev.part.args
                self._args = args if isinstance(args, str) else ""
                if isinstance(args, dict):
                    await self._emit(str(args.get("summary") or ""), final=True)
                else:
                    await self._update(final=False)
            elif (
                isinstance(ev, PartDeltaEvent)
                and ev.index == self._index
                and isinstance(ev.delta, ToolCallPartDelta)
            ):
                d = ev.delta.args_delta
                if isinstance(d, dict):
                    await self._emit(str(d.get("summary") or ""), final=True)
                elif d:
                    self._args += d
                    await self._update(final=False)
        if self._index is not None:
            await self._update(final=True)  # the stream ended: flush the last word
            self._index = None

    async def _start_attempt(self) -> None:
        """A new final_answer attempt. If the previous one never reached the validator (its
        arguments did not fit the answer schema), report it as sent back, so attempt numbers
        and verdicts stay one-to-one with what the client saw."""
        rec = self.rec
        if rec.draft_attempt > rec.checks:
            rec.checks = rec.draft_attempt
            await self._put(AnswerCheck(attempt=rec.draft_attempt, ok=False, issues=[FORMAT_ISSUE]))
        rec.draft_attempt += 1
        self._sent, self._stopped = "", False

    async def _update(self, final: bool) -> None:
        try:
            parsed = from_json(self._args, allow_partial="trailing-strings") if self._args else {}
        except ValueError:
            return
        if isinstance(parsed, dict) and isinstance(parsed.get("summary"), str):
            await self._emit(parsed["summary"], final=final)

    def _safe_prefix(self, summary: str, final: bool) -> str:
        if final:
            return summary
        cut = max((m.end() for m in _BOUNDARY.finditer(summary)), default=0)
        candidate = summary[:cut]
        for m in _MEASURE.finditer(candidate):
            if len(candidate[m.end() :].split()) < _HOLD_WORDS:
                return candidate[: m.start()]
        return candidate

    async def _emit(self, summary: str, final: bool) -> None:
        if self._stopped or not summary.startswith(self._sent):
            return
        candidate = self._safe_prefix(summary, final)
        if len(candidate) <= len(self._sent):
            return
        if text_errors(candidate, self.rec):
            self._stopped = True  # the validator will send this attempt back anyway
            return
        delta, self._sent = candidate[len(self._sent) :], candidate
        await self._put(AnswerDraft(attempt=self.rec.draft_attempt, delta=delta))

    async def _put(self, ev) -> None:
        if self.rec.queue is not None:
            await self.rec.queue.put(ev)
