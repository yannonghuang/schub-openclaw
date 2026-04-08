"use client";

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { Resizable } from "re-resizable";
import { useAGUIStream, type ChatMessage } from "../../hooks/useAGUIStream";
import type { TraceEvent, ToolCallEndEvent, HITLReplyEvent } from "../../types/agui-events";
import { AuditEventTraceability } from "../audit/AuditEventTraceability";

/* ------------------------------------------------------------------ */
/* Step event types                                                    */
/* ------------------------------------------------------------------ */
interface StepEvent {
  label: string;
  agent?: string;
  ts: number;
  level?: "major" | "detail" | "waiting";
}

/* ------------------------------------------------------------------ */
/* UI helpers                                                          */
/* ------------------------------------------------------------------ */
function Tool_Spinner() {
  return (
    <div className="flex items-center justify-center py-2 text-sm text-gray-500">
      <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mr-2"></div>
      Agent is working...
    </div>
  );
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return "<1s";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `+${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `+${m}m${rem}s` : `+${m}m`;
}

function StepsTrace({ steps, workflowActive }: { steps: StepEvent[]; workflowActive: boolean }) {
  if (steps.length === 0 && !workflowActive) return null;

  const t0 = steps[0]?.ts ?? 0;

  return (
    <div className={`rounded border px-3 py-2 text-xs space-y-1 ${workflowActive ? "border-blue-100 bg-blue-50 text-gray-600" : "border-gray-200 bg-gray-50 text-gray-500"}`}>
      <div className="flex items-center gap-2 mb-1 font-medium">
        {workflowActive ? (
          <>
            <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
            <span className="text-blue-600">Workflow running...</span>
          </>
        ) : (
          <span className="text-gray-500">{steps.length} step{steps.length !== 1 ? "s" : ""} completed</span>
        )}
      </div>
      {steps.map((s, i) => {
        const isLast = i === steps.length - 1;
        const level = s.level ?? "major";
        const isDetail = level === "detail";
        const isWaiting = level === "waiting";
        const activeStep = workflowActive && isLast;

        let indicator: React.ReactNode;
        if (activeStep && isWaiting) {
          indicator = <span className="text-blue-400 flex-shrink-0 animate-pulse">⏳</span>;
        } else if (activeStep && !isDetail) {
          indicator = <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />;
        } else if (isDetail) {
          indicator = <span className="text-gray-300 flex-shrink-0">·</span>;
        } else {
          indicator = <span className="text-green-500 flex-shrink-0">✓</span>;
        }

        const labelClass = activeStep
          ? isWaiting ? "text-blue-500 italic" : "text-blue-600 font-medium"
          : isDetail ? "text-gray-400" : "text-gray-600";

        const elapsed = i > 0 && t0 > 0 && s.ts > 0 ? formatElapsed(s.ts - t0) : null;

        return (
          <div key={i} className={`flex items-center gap-2 ${isDetail ? "pl-3" : ""}`}>
            {indicator}
            <span className={`${isDetail ? "text-[11px]" : "text-xs"} ${labelClass} flex-1 min-w-0`}>
              {s.agent ? `[${s.agent}] ` : ""}{s.label}
            </span>
            {elapsed && (
              <span className="text-[10px] text-gray-300 flex-shrink-0 tabular-nums font-mono">
                {elapsed}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function normalizeContent(raw: any, isStreaming = false): string {
  if (!raw) return "";
  if (typeof raw === "object") return JSON.stringify(raw, null, 2);
  if (typeof raw === "string") {
    if (isStreaming) return raw;
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return raw;
    }
  }
  return String(raw);
}

/* ------------------------------------------------------------------ */
/* MessageTable — scrollable message list with a visible drag handle  */
/* ------------------------------------------------------------------ */
function MessageTable({ height, onHeightChange, isLoading, messages, steps }: {
  height: number;
  onHeightChange: (h: number) => void;
  isLoading: boolean;
  messages: ChatMessage[];
  steps: StepEvent[];
}) {
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);

  const onHandleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startY: e.clientY, startH: height };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const next = Math.min(800, Math.max(80, dragRef.current.startH + ev.clientY - dragRef.current.startY));
      onHeightChange(next);
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div className="border rounded shadow-sm bg-white flex flex-col" style={{ height }}>
      <div className="p-2 flex-1 overflow-y-auto space-y-3 bg-gray-50" style={{ minHeight: 0 }}>
        {messages.map((m, idx) => {
          const isLastMsg = idx === messages.length - 1;
          const isStreamingThis = isLoading && isLastMsg && m.role === "assistant";
          return (
            <div key={`${m.role}-${idx}`} className="p-2 rounded border bg-white shadow-sm">
              <div className="font-semibold capitalize mb-1 text-blue-600">
                {`${m.role}: ${m.created_at ?? ""}`}
              </div>
              <pre className="whitespace-pre-wrap text-sm overflow-x-auto bg-gray-100 p-2 rounded">
                {normalizeContent(m.content, isStreamingThis)}
              </pre>
            </div>
          );
        })}
        {isLoading && steps.length === 0 && <Tool_Spinner />}
      </div>
      {/* Visible drag handle */}
      <div
        onMouseDown={onHandleMouseDown}
        className="flex-shrink-0 h-2 bg-gray-200 hover:bg-blue-300 active:bg-blue-400 cursor-ns-resize transition-colors flex items-center justify-center"
        title="Drag to resize"
      >
        <div className="w-8 h-0.5 bg-gray-400 rounded-full" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Agent                                                               */
/* ------------------------------------------------------------------ */
export default function Agent({
  apiUrl,
  businessId,
  initialMessage,
  threadId: externalThreadId,
  source = "pubsub",
  title,
}: {
  apiUrl: string;
  businessId: number | null;
  initialMessage: string;
  threadId?: string | null;
  source?: "pubsub" | "user";
  title?: string;
}) {
  const [resolvedThreadId, setResolvedThreadId] = useState<string | null>(null);
  const [loadingInit, setLoadingInit] = useState(true);
  const hasSentInitial = useRef(false);
  const [restoredMessages, setRestoredMessages] = useState<ChatMessage[]>([]);
  const savedMessageIds = useRef<Set<string>>(new Set());

  const [traceSteps, setTraceSteps] = useState<StepEvent[]>([]);
  const [workflowActive, setWorkflowActive] = useState(false);
  const workflowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Auto-open timeline for reopened threads (no initialMessage = history view)
  const [showTimeline, setShowTimeline] = useState(!initialMessage?.trim());
  const [msgHeight, setMsgHeight] = useState(300);

  /* ------------------------------------------------------------------ */
  /* AG-UI SSE stream — single channel for all events                   */
  /* ------------------------------------------------------------------ */
  const { chatMessages, addMessage, isLoading } = useAGUIStream(
    businessId,
    resolvedThreadId,
    // onTraceEvent
    (event: TraceEvent) => {
      setTraceSteps((prev) => [
        ...prev,
        {
          label: event.value.step,
          agent: event.value.agent,
          ts: event.timestamp ?? Date.now(),
          level: event.value.level,
        },
      ]);
      setWorkflowActive(true);
      if (workflowTimerRef.current) clearTimeout(workflowTimerRef.current);
      workflowTimerRef.current = setTimeout(() => setWorkflowActive(false), 30_000);
    },
    // onToolCallEnd — async job complete: resume OpenClaw via /agui/chat
    async (event: ToolCallEndEvent) => {
      if (!resolvedThreadId) return;
      console.log("[Agent] ToolCallEnd → resuming via /agui/chat", event);
      await submit(
        JSON.stringify({
          type: "async_tool_complete",
          job_id: event.toolCallId,
          job_result: event.output,
        })
      );
    },
    // onHITLReply — human email reply: resume OpenClaw via /agui/chat
    async (event: HITLReplyEvent) => {
      if (!resolvedThreadId) return;
      console.log("[Agent] HITLReply → resuming via /agui/chat");
      await submit(
        JSON.stringify({
          type: "email_received",
          approved: event.value.approved,
          raw_email: event.value.messageContent,
        })
      );
    }
  );

  /* ------------------------------------------------------------------ */
  /* submit — adds user message locally then POSTs to /agui/chat        */
  /* ------------------------------------------------------------------ */
  const submit = useCallback(async (userContent: string) => {
    if (!resolvedThreadId) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: userContent,
      created_at: new Date().toISOString(),
    };
    addMessage(userMsg);

    try {
      await fetch("/agui/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_key: resolvedThreadId,
          messages: [{ role: "user", content: userContent }],
          business_id: businessId,
          thread_id: resolvedThreadId,
        }),
      });
    } catch (err) {
      console.error("[Agent] /agui/chat error:", err);
    }
  }, [resolvedThreadId, businessId, addMessage]);

  /* ------------------------------------------------------------------ */
  /* 1) Resolve external thread → OpenClaw session key                  */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    if (!externalThreadId || !businessId) {
      setLoadingInit(false);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const resp = await fetch("/thread/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            external_thread_id: externalThreadId,
            assistant_id: "main",
            business_id: businessId,
            thread_source: source,
            title: title ?? initialMessage?.slice(0, 60) ?? null,
          }),
        });

        const data = await resp.json();
        if (!cancelled) {
          setResolvedThreadId(data.langgraph_thread_id);
          setRestoredMessages(
            (data.messages ?? []).map((m: any) => ({
              id: m.id ?? crypto.randomUUID(),
              role: m.role ?? m.type ?? "assistant",
              content: m.content ?? "",
              created_at: m.created_at,
            }))
          );
        }
      } catch (err) {
        console.error("Failed to resolve thread:", err);
      } finally {
        if (!cancelled) setLoadingInit(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [externalThreadId, businessId]);

  /* ------------------------------------------------------------------ */
  /* 2) Auto-save new messages to backend                               */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    if (!resolvedThreadId || !chatMessages.length || isLoading) return;

    for (const m of chatMessages) {
      if (savedMessageIds.current.has(m.id)) continue;
      savedMessageIds.current.add(m.id);

      fetch("/thread/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thread_id: resolvedThreadId,
          messages: [
            {
              role: m.role,
              content: m.content,
              message_id: m.id,
              created_at: m.created_at,
            },
          ],
        }),
      }).catch((err) => console.error("Failed to save message:", err));
    }
  }, [chatMessages, resolvedThreadId, isLoading]);

  /* ------------------------------------------------------------------ */
  /* 3) Derive step trace from assistant tool calls                     */
  /* ------------------------------------------------------------------ */
  const steps = useMemo<StepEvent[]>(() => {
    const result: StepEvent[] = [];
    for (const m of chatMessages) {
      if (m.role === "assistant" && m.tool_calls?.length) {
        for (const tc of m.tool_calls) {
          result.push({ label: `Calling: ${tc.name}`, ts: 0 });
        }
      }
    }
    return result;
  }, [chatMessages]);

  /* ------------------------------------------------------------------ */
  /* 4) Send initial message once                                       */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    if (!resolvedThreadId) return;
    if (hasSentInitial.current) return;
    hasSentInitial.current = true;

    if (!initialMessage?.trim()) return; // reopened thread — no auto-send

    (async () => {
      setTraceSteps([]);
      setWorkflowActive(false);
      if (workflowTimerRef.current) clearTimeout(workflowTimerRef.current);
      await submit(initialMessage);
    })();
  }, [resolvedThreadId, businessId, initialMessage]);

  /* ------------------------------------------------------------------ */
  /* 5) User input                                                      */
  /* ------------------------------------------------------------------ */
  const [userInput, setUserInput] = useState("");

  const sendMessage = async () => {
    if (!userInput.trim() || !resolvedThreadId || isLoading) return;
    const text = userInput;
    setUserInput("");
    setTraceSteps([]);
    setWorkflowActive(false);
    if (workflowTimerRef.current) clearTimeout(workflowTimerRef.current);
    await submit(text);
  };

  /* ------------------------------------------------------------------ */
  /* 6) Render                                                          */
  /* ------------------------------------------------------------------ */
  const allMessages = [...restoredMessages, ...chatMessages];

  if (loadingInit) {
    return (
      <div className="flex items-center justify-center py-4 text-gray-500">
        Loading thread...
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-lg font-semibold">Agent Run</h2>

      <MessageTable height={msgHeight} onHeightChange={setMsgHeight} isLoading={isLoading} messages={allMessages} steps={traceSteps.length > 0 ? traceSteps : steps} />

      <StepsTrace steps={traceSteps.length > 0 ? traceSteps : steps} workflowActive={workflowActive || isLoading} />

      {!workflowActive && !isLoading && resolvedThreadId && (
        <div className="mt-1">
          <button
            onClick={() => setShowTimeline(s => !s)}
            className="text-[11px] text-blue-500 hover:text-blue-700 hover:underline"
          >
            {showTimeline ? "Hide timeline" : "View timeline →"}
          </button>
          {showTimeline && (
            <Resizable
              defaultSize={{ width: "100%", height: 256 }}
              minHeight={120}
              maxHeight={800}
              enable={{ bottom: true }}
              handleStyles={{ bottom: { bottom: 0, height: 8, cursor: "ns-resize", background: "transparent" } }}
              handleClasses={{ bottom: "hover:bg-blue-200 transition-colors rounded-b" }}
              className="mt-2 border rounded bg-white flex flex-col"
            >
              <div className="flex-1 overflow-auto" style={{ minHeight: 0 }}>
                <AuditEventTraceability traceId={resolvedThreadId} />
              </div>
            </Resizable>
          )}
        </div>
      )}

      <div className="flex gap-2 mt-2">
        <input
          disabled={isLoading}
          className="flex-1 border rounded px-2 py-1"
          value={userInput}
          onChange={(e) => setUserInput(e.target.value)}
          placeholder="Type a message..."
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
        />
        <button
          disabled={isLoading}
          className="bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600 disabled:opacity-50"
          onClick={sendMessage}
        >
          Send
        </button>
      </div>
    </div>
  );
}
