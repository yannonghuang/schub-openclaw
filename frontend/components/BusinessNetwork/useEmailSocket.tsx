// useEmailSocket.ts
import { useEffect, useRef } from "react";
import useReliableWebsocket from "./useReliableWebsocket";

const EMAIL_NODE = process.env.EMAIL_NODE || "-2";

export function useEmailSocket(
  businessId: number | null,
  threadId: string | null,
  onEmail: (payload: any) => void,
  onAsyncToolComplete?: (payload: any) => void,
  onTraceEvent?: (payload: any) => void
) {
  const onEmailRef = useRef(onEmail);
  const onAsyncToolCompleteRef = useRef(onAsyncToolComplete);
  const onTraceEventRef = useRef(onTraceEvent);
  const seen = useRef<Set<string>>(new Set());
  const channel = `${EMAIL_NODE}?subscriber_id=${businessId}`;

  const alreadySubscribedRef = useRef(false);

  useEffect(() => { onEmailRef.current = onEmail; }, [onEmail]);
  useEffect(() => { onAsyncToolCompleteRef.current = onAsyncToolComplete; }, [onAsyncToolComplete]);
  useEffect(() => { onTraceEventRef.current = onTraceEvent; }, [onTraceEvent]);

  const { subscribe, unsubscribe } = useReliableWebsocket((data: any) => {
    const msg = data.text ? JSON.parse(data.text) : data;

    if (msg.type === "trace_event") {
      if (msg.business_id !== undefined && msg.business_id !== businessId) return;
      onTraceEventRef.current?.(msg);
      return;
    }

    if (msg.type === "async_tool_complete") {
      if (msg.thread_id !== threadId) return;
      if (seen.current.has(msg.idempotency_key)) return;
      seen.current.add(msg.idempotency_key);
      onAsyncToolCompleteRef.current?.(msg);
      return;
    }

    if (msg.type !== "email_received") return;
    if (msg.thread_id !== threadId) return;
    if (seen.current.has(msg.idempotency_key)) return;
    seen.current.add(msg.idempotency_key);
    onEmailRef.current(msg);
  });

  useEffect(() => {
    if (!threadId || alreadySubscribedRef.current) return;

    subscribe(channel);
    alreadySubscribedRef.current = true;
    return () => {
      unsubscribe(channel);
    };
  }, [threadId]);
  //}, [threadId, subscribe, unsubscribe]);
}