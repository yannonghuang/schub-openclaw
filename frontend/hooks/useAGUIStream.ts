"use client";

import { useEffect, useRef } from "react";
import {
  type TraceEvent,
  type ToolCallEndEvent,
  type HITLReplyEvent,
  normalizeEvent,
} from "../types/agui-events";

/**
 * AG-UI SSE stream hook.
 *
 * Connects to GET /agui/sse/{businessId} using the native EventSource API.
 * EventSource handles reconnection automatically and sends Last-Event-ID on
 * reconnect so the server can replay missed events.
 *
 * Replaces useEmailSocket + useReliableWebsocket for the Agent component.
 */
export function useAGUIStream(
  businessId: number | null,
  threadId: string | null,
  onTraceEvent: (e: TraceEvent) => void,
  onToolCallEnd: (e: ToolCallEndEvent) => void,
  onHITLReply: (e: HITLReplyEvent) => void
) {
  // Stable refs so EventSource handler always sees latest callbacks
  const onTraceRef = useRef(onTraceEvent);
  const onToolRef = useRef(onToolCallEnd);
  const onHITLRef = useRef(onHITLReply);
  onTraceRef.current = onTraceEvent;
  onToolRef.current = onToolCallEnd;
  onHITLRef.current = onHITLReply;

  // Per-session idempotency dedup (tool completions + HITL replies)
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!businessId) return;

    const url = `/agui/sse/${businessId}`;
    const es = new EventSource(url);

    es.onmessage = (e: MessageEvent) => {
      let raw: unknown;
      try {
        raw = JSON.parse(e.data);
      } catch {
        return;
      }

      const event = normalizeEvent(raw);
      if (!event) return;

      if (event.type === "CustomEvent" && event.name === "schub/trace") {
        onTraceRef.current(event);
        return;
      }

      if (event.type === "ToolCallEnd") {
        if (threadId && event.threadId !== threadId) return;
        if (seen.current.has(event.idempotencyKey)) return;
        seen.current.add(event.idempotencyKey);
        onToolRef.current(event);
        return;
      }

      if (event.type === "CustomEvent" && event.name === "schub/hitl_reply") {
        if (threadId && event.value.threadId !== threadId) return;
        if (seen.current.has(event.value.idempotencyKey)) return;
        seen.current.add(event.value.idempotencyKey);
        onHITLRef.current(event);
        return;
      }
    };

    es.onerror = (err) => {
      // EventSource automatically reconnects with exponential backoff;
      // logging here is purely informational.
      console.warn("[useAGUIStream] SSE error (will reconnect):", err);
    };

    return () => {
      es.close();
    };
  }, [businessId]); // reconnect only when businessId changes; threadId handled via ref
}
