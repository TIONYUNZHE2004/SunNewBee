"""Stream the model's draft summary while it is still writing `final_answer`.

The validated answer still arrives as `text.delta` after `validate.py` accepts it. Before that,
the client gets:

- `answer.draft` deltas: the summary as the model writes it, shown as a provisional draft;
- one `answer.check` per attempt: accepted, or sent back with readable reasons.

That gives a fast first sentence and makes the honesty gate visible: a judge can watch a draft
get rejected and rewritten.

A draft is never final text, and it must pass the final answer's content checks
(`validate.draft_errors`: wording, promises, numbers and facts bound to tool results, recorded
features, route status naming). It is emitted one whole sentence at a time, because a sentence
can only be judged whole ("confirmed (on demo values ...)", "not a guarantee", "99 steps"), and
it stops before the first sentence that fails, so rejected text never reaches the screen or a
screen reader (audit A3).
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
from .validate import draft_errors

OUTPUT_TOOL = "final_answer"
# Sentence ends: ". " (not "440.6"), or CJK punctuation and newlines (Chinese has no spaces).
_SENTENCE_END = re.compile(r"[.!?](?=\s)|[。！？\n]")
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
        """The whole sentences written so far; all of the text once the stream ended."""
        if final:
            return summary
        return summary[: max((m.end() for m in _SENTENCE_END.finditer(summary)), default=0)]

    async def _emit(self, summary: str, final: bool) -> None:
        if self._stopped or not summary.startswith(self._sent):
            return
        candidate = self._safe_prefix(summary, final)
        if len(candidate) <= len(self._sent):
            return
        if draft_errors(candidate, self.rec):
            self._stopped = True  # the validator will send this attempt back anyway
            return
        delta, self._sent = candidate[len(self._sent) :], candidate
        await self._put(AnswerDraft(attempt=self.rec.draft_attempt, delta=delta))

    async def _put(self, ev) -> None:
        if self.rec.queue is not None:
            await self.rec.queue.put(ev)
