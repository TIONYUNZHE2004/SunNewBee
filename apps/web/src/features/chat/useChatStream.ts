import type { ChatEvent } from "@tl/api-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { type Profile, useScene } from "../scene/sceneStore";
import {
  type AssistantMessage,
  type ChatMessage,
  emptyAssistant,
  reduceChatEvent,
} from "./chatReducer";
import { parseSse } from "./parseSse";

/** Request body; an explicit profile wins over the store so a chip's persona is never stale. */
export function chatRequestBody(message: string, profile?: Profile, scenarioId?: string | null) {
  const s = useScene.getState();
  return {
    message,
    profile: profile ?? s.profile,
    scenario_id: scenarioId === undefined ? s.scenarioId : scenarioId,
  };
}

let counter = 0;
const nextId = (p: string) => `${p}-${++counter}`;

export function useChatStream() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const lastRef = useRef<{ message: string; profile?: Profile; scenarioId?: string | null } | null>(
    null,
  );

  const patch = useCallback((id: string, fn: (m: AssistantMessage) => AssistantMessage) => {
    setMessages((ms) => ms.map((m) => (m.role === "assistant" && m.id === id ? fn(m) : m)));
  }, []);

  const send = useCallback(
    async (text: string, profile?: Profile, scenarioId?: string | null) => {
      const message = text.trim();
      if (!message) return;
      lastRef.current = { message, profile, scenarioId };
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const aid = nextId("a");
      setMessages((ms) => [
        ...ms,
        { role: "user", id: nextId("u"), text: message },
        emptyAssistant(aid),
      ]);
      setStreaming(true);
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify(chatRequestBody(message, profile, scenarioId)),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) throw new Error(`Chat request failed (${res.status})`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        const handle = (events: { data: string }[]) => {
          for (const e of events) {
            let ev: ChatEvent;
            try {
              ev = JSON.parse(e.data) as ChatEvent;
            } catch {
              continue;
            }
            if (ev.type === "scene.intent") useScene.getState().applyIntent(ev.intent);
            patch(aid, (m) => reduceChatEvent(m, ev));
          }
        };
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const { events, rest } = parseSse(buf);
          buf = rest;
          handle(events);
        }
        // Flush the decoder and parse any trailing event that lacked a final blank line.
        buf += decoder.decode();
        if (buf.trim()) handle(parseSse(`${buf}\n\n`).events);
        patch(aid, (m) => ({ ...m, done: true }));
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") {
          patch(aid, (m) => ({ ...m, done: true }));
          return;
        }
        patch(aid, (m) => ({
          ...m,
          done: true,
          error: "We could not reach the assistant. Check your connection and try again.",
        }));
      } finally {
        if (abortRef.current === ctrl) setStreaming(false);
      }
    },
    [patch],
  );

  useEffect(() => () => abortRef.current?.abort(), []);

  const retry = useCallback(() => {
    if (lastRef.current)
      void send(lastRef.current.message, lastRef.current.profile, lastRef.current.scenarioId);
  }, [send]);

  return { messages, send, retry, streaming };
}
