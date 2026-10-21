import { useQueryClient } from "@tanstack/react-query";
import type { ChatEvent } from "@tl/api-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { type Mode, useMode } from "../../app/modeStore";
import { useJourney } from "../journey/journeyStore";
import { type Profile, useScene } from "../scene/sceneStore";
import {
  type AssistantMessage,
  type ChatMessage,
  emptyAssistant,
  reduceChatEvent,
  reduceIntent,
} from "./chatReducer";
import { parseSse } from "./parseSse";

/** One id per page load: the server keeps a few earlier turns in memory for follow-ups
 * ("and if it rises another metre?"); a reload starts a fresh conversation. */
export const CHAT_SESSION_ID = newSessionId();

function newSessionId(): string {
  // getRandomValues works outside secure contexts too (randomUUID needs https or localhost).
  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `tab-${hex === "0".repeat(32) ? `${Date.now()}${Math.floor(Math.random() * 1e9)}` : hex}`;
}

/** Request body; an explicit profile wins over the store so a chip's persona is never stale.
 * `panel` is the screen asking (T-023): the management panel gets every assistant tool. Each
 * perspective is its own conversation, so the server's follow-up memory is kept per panel too. */
export function chatRequestBody(message: string, profile?: Profile, scenarioId?: string | null) {
  const s = useScene.getState();
  const panel = useMode.getState().mode;
  return {
    message,
    profile: profile ?? s.profile,
    scenario_id: scenarioId === undefined ? s.scenarioId : scenarioId,
    session_id: `${CHAT_SESSION_ID}-${panel}`,
    panel,
  };
}

type Threads = Record<Mode, ChatMessage[]>;
const NO_THREADS: Threads = { resident: [], management: [] };

let counter = 0;
const nextId = (p: string) => `${p}-${++counter}`;

export function useChatStream() {
  const queryClient = useQueryClient();
  // One conversation per perspective (owner, 21 Oct: a resident's chat stayed on the Management
  // tab). Switching shows that perspective's own thread; switching back restores the other.
  const mode = useMode((s) => s.mode);
  const [threads, setThreads] = useState<Threads>(NO_THREADS);
  const messages = threads[mode];
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  // the last question per perspective, for its thread's Retry
  const lastRef = useRef<
    Partial<Record<Mode, { message: string; profile?: Profile; scenarioId?: string | null }>>
  >({});

  const patch = useCallback((id: string, fn: (m: AssistantMessage) => AssistantMessage) => {
    // ids are unique across threads: patch the answer in whichever thread asked it
    const one = (ms: ChatMessage[]) =>
      ms.map((m) => (m.role === "assistant" && m.id === id ? fn(m) : m));
    setThreads((t) => ({ resident: one(t.resident), management: one(t.management) }));
  }, []);

  const send = useCallback(
    async (text: string, profile?: Profile, scenarioId?: string | null) => {
      const message = text.trim();
      if (!message) return;
      lastRef.current[useMode.getState().mode] = { message, profile, scenarioId };
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const aid = nextId("a");
      const asked = useMode.getState().mode;
      const turn: ChatMessage[] = [
        { role: "user", id: nextId("u"), text: message },
        emptyAssistant(aid),
      ];
      setThreads((t) => ({ ...t, [asked]: [...t[asked], ...turn] }));
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
            if (ev.type === "scene.intent") {
              const { intent } = ev;
              useScene.getState().applyIntent(intent, aid);
              patch(aid, (m) => reduceIntent(m, intent));
            }
            if (ev.type === "verification.requested") {
              void queryClient.invalidateQueries({ queryKey: ["tickets"] });
              // journey cards say "verification request filed" only for these elements
              useJourney.getState().noteVr(ev.element_id, ev.attribute);
            }
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
    [patch, queryClient],
  );

  useEffect(() => () => abortRef.current?.abort(), []);
  // A perspective switch stops an answer still streaming (it stays, marked done, in its thread),
  // so the other perspective's composer is free at once.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on a mode change only
  useEffect(() => {
    abortRef.current?.abort();
  }, [mode]);

  const retry = useCallback(() => {
    const last = lastRef.current[useMode.getState().mode];
    if (last) void send(last.message, last.profile, last.scenarioId);
  }, [send]);

  return { messages, send, retry, streaming };
}
