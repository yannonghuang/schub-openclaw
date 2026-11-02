"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  type TraceEvent,
  type ToolCallEndEvent,
  type HITLReplyEvent,
  type ProgressEvent,
  normalizeEvent,
} from "../types/agui-events";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  created_at?: string;
  tool_calls?: Array<{ name: string; id: string }>;
}

/**
 * AG-UI SSE stream hook.
 *
 * Connects to GET /agui/sse/{businessId} using the native EventSource API.
 * Handles:
 *   - schub/trace      → onTraceEvent callback
 *   - ToolCallEnd      → onToolCallEnd callback (deduped by idempotencyKey)
 *   - schub/hitl_reply → onHITLReply callback (deduped by idempotencyKey)
 *   - TextMessage*     → assembles chatMessages state (streaming assistant text)
 *   - Run*             → drives isLoading state
 *   - ToolCallStart/Args → appends tool_calls to the in-progress assistant message
 */
export function useAGUIStream(
  businessId: number | null,
  threadId: string | null,
  onTraceEvent: (e: TraceEvent) => void,
  onToolCallEnd: (e: ToolCallEndEvent) => void,
  onHITLReply: (e: HITLReplyEvent) => void,
  onProgress?: (e: ProgressEvent) => void,
): {
  chatMessages: ChatMessage[];
  addMessage: (msg: ChatMessage) => void;
  isLoading: boolean;
} {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Stable refs so EventSource handler always sees latest callbacks/values
  const onTraceRef = useRef(onTraceEvent);
  const onToolRef = useRef(onToolCallEnd);
  const onHITLRef = useRef(onHITLReply);
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;
  const threadIdRef = useRef(threadId);
  onTraceRef.current = onTraceEvent;
  onToolRef.current = onToolCallEnd;
  onHITLRef.current = onHITLReply;
  threadIdRef.current = threadId;

  // Per-session idempotency dedup (tool completions + HITL replies)
  const seen = useRef<Set<string>>(new Set());

  const addMessage = useCallback((msg: ChatMessage) => {
    setChatMessages((prev) => [...prev, msg]);
  }, []);

  useEffect(() => {
    if (!businessId) return;

    // The browser retries a dropped stream by itself, but gives up for good (readyState
    // CLOSED) after an HTTP error — e.g. nginx's 502 while switch-service restarts —
    // which left the panel deaf until a page reload. Reopen it ourselves with backoff,
    // resuming after the last event seen (?since replays what was missed).
    let es: EventSource;
    let lastSeq: string | null = null;
    let retryMs = 1000;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const onMessage = (e: MessageEvent) => {
      if (e.lastEventId) lastSeq = e.lastEventId;
      let raw: unknown;
      try {
        raw = JSON.parse(e.data);
      } catch {
        return;
      }

      const event = normalizeEvent(raw);

      // Handle events not covered by normalizeEvent (new AG-UI types)
      const ev = raw as Record<string, unknown>;

      // ── Engine job progress (not covered by normalizeEvent) ─────────────
      if (ev.type === "CustomEvent" && ev.name === "schub/progress") {
        if (threadIdRef.current && ev.threadId && ev.threadId !== threadIdRef.current) return;
        onProgressRef.current?.(raw as ProgressEvent);
        return;
      }

      // ── Run lifecycle ──────────────────────────────────────────────────
      if (ev.type === "RunStarted") {
        if (threadIdRef.current && ev.threadId !== threadIdRef.current) return;
        setIsLoading(true);
        return;
      }
      if (ev.type === "RunFinished" || ev.type === "RunError") {
        if (threadIdRef.current && ev.threadId !== threadIdRef.current) return;
        setIsLoading(false);
        return;
      }

      // ── Text streaming ─────────────────────────────────────────────────
      if (ev.type === "TextMessageStart") {
        if (threadIdRef.current && ev.threadId !== threadIdRef.current) return;
        const msgId = ev.messageId as string;
        setChatMessages((prev) => [
          ...prev,
          {
            id: msgId,
            role: "assistant",
            content: "",
            created_at: new Date().toISOString(),
            tool_calls: [],
          },
        ]);
        return;
      }
      if (ev.type === "TextMessageContent") {
        const msgId = ev.messageId as string;
        const delta = ev.delta as string;
        setChatMessages((prev) =>
          prev.map((m) =>
            m.id === msgId ? { ...m, content: m.content + delta } : m
          )
        );
        return;
      }
      if (ev.type === "TextMessageEnd") {
        // Message is already complete; no state change needed
        return;
      }

      // ── Tool call streaming ────────────────────────────────────────────
      if (ev.type === "ToolCallStart") {
        if (threadIdRef.current && ev.threadId !== threadIdRef.current) return;
        // Find the current in-progress assistant message (last one) and append tool call
        setChatMessages((prev) => {
          const idx = prev.length - 1;
          if (idx < 0 || prev[idx].role !== "assistant") return prev;
          const updated = { ...prev[idx] };
          updated.tool_calls = [
            ...(updated.tool_calls ?? []),
            { name: ev.toolCallName as string, id: ev.toolCallId as string },
          ];
          return [...prev.slice(0, idx), updated];
        });
        return;
      }
      if (ev.type === "ToolCallArgs") {
        // Args are streamed but we don't need to show them incrementally in the UI
        return;
      }

      // ── Handled by normalizeEvent ──────────────────────────────────────
      if (!event) return;

      if (event.type === "CustomEvent" && event.name === "schub/trace") {
        // Traces are broadcast per business; skip ones stamped for another tab's run.
        // Unstamped traces (no run thread known) still reach every tab.
        if (threadIdRef.current && event.threadId && event.threadId !== threadIdRef.current) return;
        onTraceRef.current(event);
        return;
      }

      if (event.type === "ToolCallEnd") {
        if (threadIdRef.current && event.threadId !== threadIdRef.current) return;
        if (seen.current.has(event.idempotencyKey)) return;
        seen.current.add(event.idempotencyKey);
        onToolRef.current(event);
        return;
      }

      if (event.type === "CustomEvent" && event.name === "schub/hitl_reply") {
        if (threadIdRef.current && event.value.threadId !== threadIdRef.current) return;
        if (seen.current.has(event.value.idempotencyKey)) return;
        seen.current.add(event.value.idempotencyKey);
        onHITLRef.current(event);
        return;
      }
    };

    const connect = () => {
      const url = `/agui/sse/${businessId}` + (lastSeq ? `?since=${encodeURIComponent(lastSeq)}` : "");
      es = new EventSource(url);
      es.onmessage = onMessage;
      es.onopen = () => { retryMs = 1000; };
      es.onerror = () => {
        if (disposed || es.readyState !== EventSource.CLOSED) return; // browser is retrying
        console.warn(`[useAGUIStream] SSE closed — reopening in ${retryMs}ms`);
        retryTimer = setTimeout(connect, retryMs);
        retryMs = Math.min(retryMs * 2, 15000);
      };
    };
    connect();

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      es.close();
    };
  }, [businessId]); // reconnect only when businessId changes; threadId handled via ref

  return { chatMessages, addMessage, isLoading };
}
