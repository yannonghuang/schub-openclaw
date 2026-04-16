// AG-UI event types for the schub-openclaw switch-service SSE channel.
// Transport: GET /agui/sse/{business_id}  (text/event-stream)

// ---------------------------------------------------------------------------
// Base
// ---------------------------------------------------------------------------
export interface AGUIBaseEvent {
  type: string;
  id?: number;         // monotonic sequence ID assigned by switch-service
  timestamp?: number;  // ms since epoch
}

// ---------------------------------------------------------------------------
// ToolCallEnd  (was: async_tool_complete)
// Emitted by mcp-server when a long-running engine job completes.
// ---------------------------------------------------------------------------
export interface ToolCallEndEvent extends AGUIBaseEvent {
  type: "ToolCallEnd";
  toolCallId: string;        // was: job_id
  threadId: string;          // was: thread_id
  output: unknown | null;    // was: job_result
  error?: string | null;
  idempotencyKey: string;    // format: "job:<toolCallId>"
}

// ---------------------------------------------------------------------------
// CustomEvent / schub/trace  (was: trace_event)
// Emitted by agents via curl to show workflow progress.
// ---------------------------------------------------------------------------
export interface TraceEventValue {
  step: string;              // i18n key (e.g. "trace.planning.assessmentStarted") or legacy plain text
  params?: Record<string, string>;  // interpolation values for keyed steps (e.g. {rating: "MEDIUM"})
  agent?: string;
  level: "major" | "detail" | "waiting";
  businessId: number;        // was: business_id
}

export interface TraceEvent extends AGUIBaseEvent {
  type: "CustomEvent";
  name: "schub/trace";
  value: TraceEventValue;
}

// ---------------------------------------------------------------------------
// CustomEvent / schub/hitl_reply  (was: email_received)
// Emitted by the adaptor when a human replies to a HITL approval email.
// ---------------------------------------------------------------------------
export interface HITLReplyEventValue {
  threadId: string;          // was: thread_id
  approved: boolean;
  messageContent: string;    // was: message.content
  idempotencyKey: string;
}

export interface HITLReplyEvent extends AGUIBaseEvent {
  type: "CustomEvent";
  name: "schub/hitl_reply";
  value: HITLReplyEventValue;
}

// ---------------------------------------------------------------------------
// Run lifecycle events  (emitted by /agui/chat proxy)
// ---------------------------------------------------------------------------
export interface RunStartedEvent extends AGUIBaseEvent {
  type: "RunStarted";
  runId: string;
  threadId: string;
}

export interface RunFinishedEvent extends AGUIBaseEvent {
  type: "RunFinished";
  runId: string;
  threadId: string;
}

export interface RunErrorEvent extends AGUIBaseEvent {
  type: "RunError";
  message: string;
  runId: string;
  threadId: string;
}

// ---------------------------------------------------------------------------
// Text message streaming events  (emitted by /agui/chat proxy)
// ---------------------------------------------------------------------------
export interface TextMessageStartEvent extends AGUIBaseEvent {
  type: "TextMessageStart";
  messageId: string;
  runId: string;
  threadId: string;
  role: "assistant";
}

export interface TextMessageContentEvent extends AGUIBaseEvent {
  type: "TextMessageContent";
  messageId: string;
  delta: string;
}

export interface TextMessageEndEvent extends AGUIBaseEvent {
  type: "TextMessageEnd";
  messageId: string;
  runId: string;
  threadId: string;
}

// ---------------------------------------------------------------------------
// Tool call streaming events  (emitted by /agui/chat proxy)
// ---------------------------------------------------------------------------
export interface ToolCallStartEvent extends AGUIBaseEvent {
  type: "ToolCallStart";
  toolCallId: string;
  toolCallName: string;
  runId: string;
  threadId: string;
}

export interface ToolCallArgsEvent extends AGUIBaseEvent {
  type: "ToolCallArgs";
  toolCallId: string;
  delta: string;
}

// ---------------------------------------------------------------------------
// Discriminated union of all switch-service events
// ---------------------------------------------------------------------------
export type SwitchEvent =
  | ToolCallEndEvent
  | TraceEvent
  | HITLReplyEvent
  | RunStartedEvent
  | RunFinishedEvent
  | RunErrorEvent
  | TextMessageStartEvent
  | TextMessageContentEvent
  | TextMessageEndEvent
  | ToolCallStartEvent
  | ToolCallArgsEvent;

// ---------------------------------------------------------------------------
// Legacy wire formats — accepted by useAGUIStream normalizer during migration
// ---------------------------------------------------------------------------
export interface LegacyTraceEvent {
  type: "trace_event";
  business_id: number;
  step: string;
  agent?: string;
  level?: "major" | "detail" | "waiting";
}

export interface LegacyAsyncToolComplete {
  type: "async_tool_complete";
  thread_id: string;
  job_id: string;
  job_result: unknown;
  error?: string | null;
  idempotency_key: string;
}

export interface LegacyEmailReceived {
  type: "email_received";
  thread_id: string;
  approved: boolean;
  message?: { content: string };
  content?: string;
  idempotency_key: string;
}

// ---------------------------------------------------------------------------
// Normalizer — converts legacy shapes to AG-UI shapes
// ---------------------------------------------------------------------------
export function normalizeEvent(raw: unknown): SwitchEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const ev = raw as Record<string, unknown>;

  // Already AG-UI shaped
  if (ev.type === "ToolCallEnd") return ev as unknown as ToolCallEndEvent;
  if (ev.type === "CustomEvent" && ev.name === "schub/trace")
    return ev as unknown as TraceEvent;
  if (ev.type === "CustomEvent" && ev.name === "schub/hitl_reply")
    return ev as unknown as HITLReplyEvent;

  // Legacy: trace_event
  if (ev.type === "trace_event") {
    return {
      type: "CustomEvent",
      name: "schub/trace",
      value: {
        step: ev.step as string,
        agent: ev.agent as string | undefined,
        level: (ev.level as TraceEventValue["level"]) ?? "major",
        businessId: ev.business_id as number,
      },
    };
  }

  // Legacy: async_tool_complete
  if (ev.type === "async_tool_complete") {
    return {
      type: "ToolCallEnd",
      toolCallId: ev.job_id as string,
      threadId: ev.thread_id as string,
      output: ev.job_result,
      error: ev.error as string | null | undefined,
      idempotencyKey: ev.idempotency_key as string,
    };
  }

  // Legacy: email_received
  if (ev.type === "email_received") {
    const legacy = ev as unknown as LegacyEmailReceived;
    return {
      type: "CustomEvent",
      name: "schub/hitl_reply",
      value: {
        threadId: legacy.thread_id,
        approved: legacy.approved,
        messageContent: legacy.message?.content ?? (legacy.content as string) ?? "",
        idempotencyKey: legacy.idempotency_key,
      },
    };
  }

  return null;
}
