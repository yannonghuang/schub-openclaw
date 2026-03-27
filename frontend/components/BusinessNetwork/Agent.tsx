"use client";

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { Resizable } from "re-resizable";
import { useAGUIStream } from "../../hooks/useAGUIStream";
import type { TraceEvent, ToolCallEndEvent, HITLReplyEvent } from "../../types/agui-events";

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
/* Message type                                                        */
/* ------------------------------------------------------------------ */
interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  created_at?: string;
  tool_calls?: Array<{ name: string; id: string }>;
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

function StepsTrace({ steps, workflowActive }: { steps: StepEvent[]; workflowActive: boolean }) {
  if (steps.length === 0 && !workflowActive) return null;

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

        return (
          <div key={i} className={`flex items-center gap-2 ${isDetail ? "pl-3" : ""}`}>
            {indicator}
            <span className={`${isDetail ? "text-[11px]" : "text-xs"} ${labelClass}`}>
              {s.agent ? `[${s.agent}] ` : ""}{s.label}
            </span>
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
/* OpenClaw SSE streaming hook                                         */
/* ------------------------------------------------------------------ */
function useOpenClawStream(sessionKey: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const submit = useCallback(async (userContent: string) => {
    if (!sessionKey) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: userContent,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const assistantId = crypto.randomUUID();

    try {
      const resp = await fetch("/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-openclaw-session-key": sessionKey,
        },
        body: JSON.stringify({
          model: "openclaw:main",
          messages: [{ role: "user", content: userContent }],
          stream: true,
        }),
        signal: ctrl.signal,
      });

      if (!resp.ok || !resp.body) {
        throw new Error(`HTTP ${resp.status}`);
      }

      let assistantContent = "";
      const toolCalls: Array<{ name: string; id: string }> = [];

      // Add assistant placeholder
      setMessages((prev) => [
        ...prev,
        {
          id: assistantId,
          role: "assistant",
          content: "",
          created_at: new Date().toISOString(),
          tool_calls: [],
        },
      ]);

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;

          try {
            const chunk = JSON.parse(data);
            const delta = chunk.choices?.[0]?.delta;
            if (!delta) continue;

            if (delta.content) {
              assistantContent += delta.content;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, content: assistantContent } : m
                )
              );
            }

            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                if (tc.function?.name) {
                  toolCalls.push({ name: tc.function.name, id: tc.id ?? "" });
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantId
                        ? { ...m, tool_calls: [...toolCalls] }
                        : m
                    )
                  );
                }
              }
            }
          } catch {
            /* ignore partial chunk parse errors */
          }
        }
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        console.error("[OpenClaw] Stream error:", err);
        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
      }
    } finally {
      setIsLoading(false);
    }
  }, [sessionKey]);

  return { messages, setMessages, isLoading, submit };
}

/* ------------------------------------------------------------------ */
/* Agent                                                               */
/* ------------------------------------------------------------------ */
export default function Agent({
  apiUrl,
  businessId,
  initialMessage,
  threadId: externalThreadId,
}: {
  apiUrl: string;
  businessId: number;
  initialMessage: string;
  threadId?: string | null;
}) {
  const [resolvedThreadId, setResolvedThreadId] = useState<string | null>(null);
  const [loadingInit, setLoadingInit] = useState(true);
  const hasSentInitial = useRef(false);
  const [restoredMessages, setRestoredMessages] = useState<ChatMessage[]>([]);
  const savedMessageIds = useRef<Set<string>>(new Set());

  const { messages, setMessages, isLoading, submit } = useOpenClawStream(resolvedThreadId);
  const [traceSteps, setTraceSteps] = useState<StepEvent[]>([]);
  const [workflowActive, setWorkflowActive] = useState(false);
  const workflowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ------------------------------------------------------------------ */
  /* 1) Resolve external thread → OpenClaw session key                  */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    if (!externalThreadId) {
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
    if (!resolvedThreadId || !messages.length || isLoading) return;

    for (const m of messages) {
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
  }, [messages, resolvedThreadId, isLoading]);

  /* ------------------------------------------------------------------ */
  /* 3) Derive step trace from assistant tool calls                     */
  /* ------------------------------------------------------------------ */
  const steps = useMemo<StepEvent[]>(() => {
    const result: StepEvent[] = [];
    for (const m of messages) {
      if (m.role === "assistant" && m.tool_calls?.length) {
        for (const tc of m.tool_calls) {
          result.push({ label: `Calling: ${tc.name}`, ts: 0 });
        }
      }
    }
    return result;
  }, [messages]);

  /* ------------------------------------------------------------------ */
  /* 4) AG-UI SSE stream — async job completions + trace events         */
  /* ------------------------------------------------------------------ */
  useAGUIStream(
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
    // onToolCallEnd
    async (event: ToolCallEndEvent) => {
      if (!resolvedThreadId) return;
      console.log("[Agent] ToolCallEnd → forwarding to OpenClaw", event);
      await submit(
        JSON.stringify({
          type: "async_tool_complete",
          job_id: event.toolCallId,
          job_result: event.output,
        })
      );
    },
    // onHITLReply
    async (event: HITLReplyEvent) => {
      if (!resolvedThreadId) return;
      console.log("[Agent] HITLReply → forwarding to OpenClaw");
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
  /* 5) Send initial message once                                       */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    if (!resolvedThreadId) return;
    if (hasSentInitial.current) return;
    hasSentInitial.current = true;

    (async () => {
      setTraceSteps([]);
      setWorkflowActive(false);
      if (workflowTimerRef.current) clearTimeout(workflowTimerRef.current);
      await submit(initialMessage);
    })();
  }, [resolvedThreadId, businessId, initialMessage]);

  /* ------------------------------------------------------------------ */
  /* 6) User input                                                      */
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
  /* 7) Render                                                          */
  /* ------------------------------------------------------------------ */
  const allMessages = [...restoredMessages, ...messages];

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

      <Resizable
        defaultSize={{ width: "100%", height: 600 }}
        minHeight={200}
        maxHeight={800}
        className="border rounded shadow-sm bg-white"
      >
        <div className="p-2 h-full overflow-y-auto space-y-3 bg-gray-50">
          {allMessages.map((m, idx) => {
            const isLastMsg = idx === allMessages.length - 1;
            const isStreamingThis =
              isLoading && isLastMsg && m.role === "assistant";
            return (
              <div
                key={`${m.role}-${idx}`}
                className="p-2 rounded border bg-white shadow-sm"
              >
                <div className="font-semibold capitalize mb-1 text-blue-600">
                  {`${m.role}: ${m.created_at ?? ""}`}
                </div>
                <pre className="whitespace-pre-wrap text-sm overflow-x-auto bg-gray-100 p-2 rounded">
                  {normalizeContent(m.content, isStreamingThis)}
                </pre>
              </div>
            );
          })}

          {isLoading && traceSteps.length === 0 && steps.length === 0 && <Tool_Spinner />}
        </div>
      </Resizable>

      <StepsTrace steps={traceSteps.length > 0 ? traceSteps : steps} workflowActive={workflowActive || isLoading} />

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
