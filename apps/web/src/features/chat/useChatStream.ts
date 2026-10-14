import type { ChatEvent } from "@tl/api-client";
import { useCallback, useRef, useState } from "react";
import { useScene } from "../scene/sceneStore";
import {
  type AssistantMessage,
  type ChatMessage,
  emptyAssistant,
  reduceChatEvent,
} from "./chatReducer";
import { parseSse } from "./parseSse";

let counter = 0;
const nextId = (p: string) => `${p}-${++counter}`;

export function useChatStream() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const lastRef = useRef<string>("");

  const patch = useCallback((id: string, fn: (m: AssistantMessage) => AssistantMessage) => {
    setMessages((ms) => ms.map((m) => (m.role === "assistant" && m.id === id ? fn(m) : m)));
  }, []);

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message) return;
      lastRef.current = message;
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
      const { profile, scenarioId } = useScene.getState();
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify({ message, profile, scenario_id: scenarioId }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) throw new Error(`Chat request failed (${res.status})`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const { events, rest } = parseSse(buf);
          buf = rest;
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
        }
        patch(aid, (m) => ({ ...m, done: true }));
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
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

  const retry = useCallback(() => {
    if (lastRef.current) void send(lastRef.current);
  }, [send]);

  return { messages, send, retry, streaming };
}
