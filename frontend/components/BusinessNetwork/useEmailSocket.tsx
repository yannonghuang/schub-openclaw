// useEmailSocket.ts
import { useEffect, useRef } from "react";
import useReliableWebsocket from "./useReliableWebsocket";

const EMAIL_NODE = process.env.EMAIL_NODE || "-2";

export function useEmailSocket(
  businessId: number | null,
  threadId: string | null,
  onEmail: (payload: any) => void,
  onAsyncToolComplete?: (payload: any) => void
) {
  const onEmailRef = useRef(onEmail);
  const onAsyncToolCompleteRef = useRef(onAsyncToolComplete);
  const seen = useRef<Set<string>>(new Set());
  const channel = `${EMAIL_NODE}?subscriber_id=${businessId}`;

  const alreadySubscribedRef = useRef(false);

  // always keep latest handlers
  useEffect(() => {
    onEmailRef.current = onEmail;
  }, [onEmail]);

  useEffect(() => {
    onAsyncToolCompleteRef.current = onAsyncToolComplete;
  }, [onAsyncToolComplete]);


  const { subscribe, unsubscribe } = useReliableWebsocket((data: any) => {
    console.log(`[useEmailSocket] Email received something ...`);

    const msg = data.text ? JSON.parse(data.text) : data;

    if (msg.type === "async_tool_complete") {
      if (msg.thread_id !== threadId) return;
      if (seen.current.has(msg.idempotency_key)) {
        console.log(`Have seen ${msg.idempotency_key}...`);
        return;
      }
      seen.current.add(msg.idempotency_key);
      console.log(`[useEmailSocket] async_tool_complete: ${JSON.stringify(msg)}`);
      onAsyncToolCompleteRef.current?.(msg);
      return;
    }

    if (msg.type !== "email_received") return;
    if (msg.thread_id !== threadId) return;

    // ✅ idempotency (optional, keep commented if not needed)
    if (seen.current.has(msg.idempotency_key)) {
      console.log(`Have seen ${msg.idempotency_key}...`)
      return;
    }
    seen.current.add(msg.idempotency_key);

    console.log(`[useEmailSocket] Email received: ${JSON.stringify(msg)}`);
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