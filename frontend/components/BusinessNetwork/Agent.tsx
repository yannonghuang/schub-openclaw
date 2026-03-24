"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { useStream } from "@langchain/langgraph-sdk/react";
import type { Message } from "@langchain/langgraph-sdk";
import { Resizable } from "re-resizable";
import { useEmailSocket } from "./useEmailSocket";

/* ------------------------------------------------------------------ */
/* Step event types                                                    */
/* ------------------------------------------------------------------ */
interface StepEvent {
  label: string;
  agent?: string;
  ts: number;
}

/* ------------------------------------------------------------------ */
/* Noise suppression (unchanged)                                       */
/* ------------------------------------------------------------------ */
const originalWarn = console.warn;
console.warn = (...args) => {
  if (
    typeof args[0] === "string" &&
    args[0].includes("New LangChain packages are available")
  ) {
    return;
  }
  originalWarn(...args);
};

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

function StepsTrace({ steps, isLoading }: { steps: StepEvent[]; isLoading: boolean }) {
  const [expanded, setExpanded] = useState(false);

  if (steps.length === 0) return null;

  // While loading: show live expanding list
  if (isLoading) {
    return (
      <div className="rounded border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-gray-600 space-y-1">
        {steps.map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            {i === steps.length - 1 ? (
              <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
            ) : (
              <span className="text-green-500 flex-shrink-0">✓</span>
            )}
            <span className={i === steps.length - 1 ? "text-blue-600 font-medium" : "text-gray-500"}>
              {s.agent && s.agent !== "Main Agent" ? `[${s.agent}] ` : ""}{s.label}
            </span>
          </div>
        ))}
      </div>
    );
  }

  // After loading: collapsible summary
  return (
    <div className="rounded border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-500">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1 hover:text-gray-700 w-full text-left"
      >
        <span>{expanded ? "▾" : "▸"}</span>
        <span>{steps.length} step{steps.length !== 1 ? "s" : ""}</span>
      </button>
      {expanded && (
        <div className="mt-1 space-y-0.5 pl-3 border-l border-gray-300">
          {steps.map((s, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span className="text-green-500">✓</span>
              <span>{s.agent && s.agent !== "Main Agent" ? `[${s.agent}] ` : ""}{s.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function normalizeContent(raw: any, isStreaming = false): string {
  if (!raw) return "";
  if (typeof raw === "object") return JSON.stringify(raw, null, 2);
  if (typeof raw === "string") {
    // Don't attempt JSON parse while streaming — content is partial
    if (isStreaming) return raw;
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return raw;
    }
  }
  return String(raw);
}

async function saveMessage(thread_id: string, content: string, role: string) {
  // Autosave to backend
  try {
    const resp = await fetch("/thread/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        thread_id: thread_id,
        messages: [{ role: role, content: content }], //[msg],
      }),
    });
    const data = await resp.json();
    console.info(`Saved message: ${JSON.stringify(data)}`);
  } catch (err) {
    console.error("Failed to save message:", err);
  }
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
  const [isInterrupted, setIsInterrupted] = useState(false);
  const [interruptInfo, setInterruptInfo] = useState<any>(null);
  const resumedInterruptIds = useRef<Set<string>>(new Set());

  const [restoredMessages, setRestoredMessages] = useState<Message[]>([]);
  const savedMessageIds = useRef<Set<string>>(new Set());

  const doSubmit = async (content: string, extraPayload={}) => {

    submit(
      {
        business_id: businessId,
        messages: [
          {
            type: "human",
            content: JSON.stringify({
              payload: {
                ...extraPayload,
                business_id: businessId,
                messages: [{ type: "human", content }],
              },
            }),
          },
        ],
      },
      { streamMode: ["messages", "values"], streamSubgraphs: true },
    );

    //await saveMessage(resolvedThreadId, content, "human")
  }

  const displayAndSave = (save: boolean = false): any[] => {
    const out: any[] = [];

    for (const m of messages) {
      if (!m.id || savedMessageIds.current.has(m.id)) {
        if (m.id) out.push(m);
        continue;
      }

      if (save) {
        savedMessageIds.current.add(m.id);
        fetch("/thread/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            thread_id: resolvedThreadId,
            messages: [
              {
                role: m.type,
                content: m.content,
                message_id: m.id,
                created_at: (m as any).created_at,
              },
            ],
          }),
        }).catch(err => console.error("Failed to save message:", err));
      }

      out.push(m);
    }

    return out;
  };
  /* ------------------------------------------------------------------ */
  /* 1) Resolve external thread → langgraph thread id                   */
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
            assistant_id: "dispatcher_agent",
            business_id: businessId,
          }),
        });

        const data = await resp.json();
        if (!cancelled) {
          setResolvedThreadId(data.langgraph_thread_id);
          // Existing messages from backend
          setRestoredMessages(data.messages ?? []);
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
  /* 2) LangGraph stream (single source of truth)                        */
  /* ------------------------------------------------------------------ */
  const {
    messages,
    submit,
    isLoading,
    values,
    interrupt,
  } = useStream<{
    messages: Message[];
    business_id: number;
    waiting_for_email: boolean;
    interrupt_reason: string
  }>({
    apiUrl,
    assistantId: "dispatcher_agent",
    threadId: resolvedThreadId ?? undefined,
    messagesKey: "messages",
    onThreadId: (uuid) => {
      if (!resolvedThreadId) setResolvedThreadId(uuid);
    },
    reconnectOnMount: true,
    // no-op: forces "updates" into streamMode so server sends per-node state diffs,
    // which the SDK accumulates into `values` — enabling the step trace below.
    onUpdateEvent: (_data: any, _options: any) => {},
  });

  useEffect(() => {
    if (!resolvedThreadId) return;
    if (!messages?.length) return;
    if (isLoading) return;
    displayAndSave(true);
  }, [messages, resolvedThreadId, isLoading]);

  // Derive step trace directly from messages in render — no state, no batching delay.
  // messages updates per-token, so steps appear in real-time as each tool call / result lands.
  const steps = useMemo<StepEvent[]>(() => {
    const result: StepEvent[] = [];
    for (const msg of (messages as any[])) {
      if ((msg.type === "ai" || msg.role === "assistant") && msg.tool_calls?.length) {
        for (const tc of msg.tool_calls) {
          result.push({ label: `Calling: ${tc.name}`, ts: 0 });
        }
      } else if (msg.type === "tool" || msg.role === "tool") {
        if (msg.name) result.push({ label: `Tool: ${msg.name}`, ts: 0 });
      } else if (msg.type === "ai" || msg.role === "assistant") {
        try {
          const parsed = JSON.parse(typeof msg.content === "string" ? msg.content : "{}");
          if (parsed.route) result.push({ label: `Routing to: ${parsed.route}`, ts: 0 });
        } catch { /* streaming partial or plain text */ }
      }
    }
    return result;
  }, [messages]);


  useEffect(() => {
    if (!interrupt || !interrupt.id) return;

    console.log("INTERRUPT RECEIVED:", interrupt);

    if (interrupt) {
      if (!resumedInterruptIds.current.has(interrupt.id)) {
        resumedInterruptIds.current.add(interrupt.id);

        setInterruptInfo(interrupt.value);
        setIsInterrupted(true);
      }
    }
  }, [interrupt]);

  useEmailSocket(
    businessId,
    resolvedThreadId,
    async (payload) => {
      if (!submit) return;

      console.log("[Agent] Email received → submitting to stream");

      setIsInterrupted(false);

      try { // restore historic messages
        const resp = await fetch(`/thread/messages/${resolvedThreadId}`);
        const data = await resp.json();

        // Existing messages from backend
        setRestoredMessages(data.messages ?? []);
      } catch (err) {
        console.error("Failed to restore messages:", err);
      }

      await submit(undefined, {
        command: {
          resume: {
            approved: payload.approved ?? true,
            raw_email: payload.message.content,
          },
        },
        streamMode: ["messages", "values"],
        streamSubgraphs: true,
      });
    },
    async (payload) => {
      if (!submit) return;

      console.log("[Agent] async_tool_complete → resuming thread", payload);

      setIsInterrupted(false);

      await submit(undefined, {
        command: {
          resume: {
            job_result: payload.job_result,
            job_id: payload.job_id,
          },
        },
        streamMode: ["messages", "values"],
        streamSubgraphs: true,
      });
    }
  );


  /* ------------------------------------------------------------------ */
  /* 3) Send initial message ONCE                                        */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    if (!submit) return;
    if (!resolvedThreadId) return;
    if (hasSentInitial.current) return;

    hasSentInitial.current = true;

    (async () => {
      await doSubmit(initialMessage);
    })();

  }, [submit, resolvedThreadId, businessId, initialMessage]);

  /* ------------------------------------------------------------------ */
  /* 4) User input                                                      */
  /* ------------------------------------------------------------------ */
  const [userInput, setUserInput] = useState("");

  const sendMessage = async () => {
    if (!userInput.trim()) return;
    if (!submit || !resolvedThreadId) return;
    if (isInterrupted) return;

    await doSubmit(userInput);
    setUserInput("");
  };

  /* ------------------------------------------------------------------ */
  /* 5) Render                                                          */
  /* ------------------------------------------------------------------ */

  const displayMessages = useMemo(() => {
    return displayAndSave();
  }, [messages]);

  const allMessages = [...restoredMessages, ...displayMessages];

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
            const isStreamingThis = isLoading && isLastMsg && (m.type === "ai" || (m as any).role === "assistant");
            return (
              <div
                key={`${m.type}-${idx}`}
                className="p-2 rounded border bg-white shadow-sm"
              >
                <div className="font-semibold capitalize mb-1 text-blue-600">
                  {`${(m.type || (m as any).role)}: ${((m as any).created_at || "")}`}
                </div>
                <pre className="whitespace-pre-wrap text-sm overflow-x-auto bg-gray-100 p-2 rounded">
                  {normalizeContent(m.content, isStreamingThis)}
                </pre>
              </div>
            );
          })}

          {!isInterrupted && isLoading && steps.length === 0 && <Tool_Spinner />}
        </div>
      </Resizable>

      <StepsTrace steps={steps} isLoading={isLoading && !isInterrupted} />

      <div className="flex gap-2 mt-2">
        <input
          disabled={isInterrupted}
          className="flex-1 border rounded px-2 py-1"
          value={userInput}
          onChange={(e) => setUserInput(e.target.value)}
          placeholder="Type a message..."
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
        />
        <button
          disabled={isInterrupted}
          className="bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600 disabled:opacity-50"
          onClick={sendMessage}
        >
          Send
        </button>
      </div>

      {isInterrupted && (
        <div className="p-3 rounded bg-yellow-100 border text-sm">
          {interruptInfo?.interrupt_reason === "async_tool"
            ? `⚙️ Running ${interruptInfo.tool_name ?? "background job"}… waiting for result`
            : "⏳ Waiting for email reply…"}
        </div>
      )}
    </div>
  );
}
