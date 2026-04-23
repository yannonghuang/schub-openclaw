"use client";

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useRouter } from "next/router";
import { Resizable } from "re-resizable";
import { useTranslation } from "next-i18next/pages";
import { useAGUIStream, type ChatMessage } from "../../hooks/useAGUIStream";
import type { TraceEvent, ToolCallEndEvent, HITLReplyEvent } from "../../types/agui-events";
import { AuditEventTraceability } from "../audit/AuditEventTraceability";
import { SuggestionItem, type Suggestion } from "./SuggestionItem";

/* ------------------------------------------------------------------ */
/* Step event types                                                    */
/* ------------------------------------------------------------------ */
interface StepEvent {
  label: string;
  params?: Record<string, string>;
  agent?: string;
  ts: number;
  level?: "major" | "detail" | "waiting";
}

/* ------------------------------------------------------------------ */
/* UI helpers                                                          */
/* ------------------------------------------------------------------ */
function Tool_Spinner() {
  const { t } = useTranslation("agent");
  return (
    <div className="flex items-center justify-center py-2 text-sm text-gray-500">
      <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mr-2"></div>
      {t("run.working")}
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
  const { t, i18n } = useTranslation("agent");

  // Translate a step key if it looks like an i18n key (e.g. "trace.planning.assessmentStarted").
  // Falls back to the raw string for legacy plain-text steps.
  const translateStep = (label: string, params?: Record<string, string>): string => {
    if (!label) return label;
    // Normalize — agents occasionally publish without the "trace." prefix.
    const key = canonStep(label);
    const result = t(key, params ?? {});
    // next-i18next returns the key itself when not found — fall back to the
    // raw (possibly non-prefixed) label rather than our synthetic key.
    return result !== key ? result : label;
  };

  if (steps.length === 0 && !workflowActive) return null;

  const t0 = steps[0]?.ts ?? 0;

  return (
    <div className={`flex justify-start`}>
    <div className={`max-w-[85%] rounded-2xl rounded-bl-sm border px-3 py-2 text-xs space-y-1 ${workflowActive ? "border-blue-100 bg-blue-50/60 text-gray-600" : "border-gray-200 bg-gray-50 text-gray-500"}`}>
      <div className="flex items-center gap-2 mb-1 font-medium">
        {workflowActive ? (
          <>
            <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
            <span className="text-blue-600">{t("run.workflowRunning")}</span>
          </>
        ) : (
          <span className="text-gray-500">{t("run.stepsCompleted", { count: steps.length })}</span>
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
              {s.agent ? `[${s.agent}] ` : ""}{translateStep(s.label, s.params)}
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
    </div>
  );
}

// Canonicalize a trace step to its full "trace.<agent>.<name>" form.
// Agents (LLM-driven) sometimes drop the leading "trace." prefix when building
// the publish curl; i18n keys and step comparisons always use the full form,
// so normalize here to keep the contract forgiving.
const canonStep = (s: string): string => (s?.startsWith("trace.") ? s : `trace.${s}`);

// Terminal traces — session is truly idle after these, so release the input.
// Without explicit terminal signals the input stays gated until the safety-net
// timer (10min) fires — too long for good UX.
const TERMINAL_STEPS = new Set<string>([
  "trace.order.complete",
  "trace.order.rejected",
  "trace.planning.complete",
  "trace.planning.rejected",
  "trace.material.complete",
  "trace.material.negotiationAbandoned",
  "trace.material.baselineDrifted",
]);

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

function formatTs(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/* ------------------------------------------------------------------ */
/* MessageTable — scrollable conversation with trace inlined at end    */
/* ------------------------------------------------------------------ */
function MessageTable({ height, onHeightChange, isLoading, messages, steps, workflowActive }: {
  height: number;
  onHeightChange: (h: number) => void;
  isLoading: boolean;
  messages: ChatMessage[];
  steps: StepEvent[];
  workflowActive: boolean;
}) {
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

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

  // Auto-scroll to the bottom when new messages or trace steps arrive
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, steps.length, workflowActive]);

  return (
    <div className="border border-gray-200 rounded-lg shadow-sm bg-white flex flex-col overflow-hidden" style={{ height }}>
      <div ref={scrollRef} className="px-4 py-3 flex-1 overflow-y-auto space-y-3 bg-gradient-to-b from-gray-50 to-white" style={{ minHeight: 0 }}>
        {messages.map((m, idx) => {
          const isLastMsg = idx === messages.length - 1;
          const isStreamingThis = isLoading && isLastMsg && m.role === "assistant";
          const isUser = m.role === "user";
          return (
            <div key={`${m.role}-${idx}`} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm shadow-sm ${
                isUser
                  ? "bg-blue-500 text-white rounded-br-sm"
                  : "bg-white text-gray-800 border border-gray-200 rounded-bl-sm"
              }`}>
                <div className="whitespace-pre-wrap break-words leading-relaxed">
                  {normalizeContent(m.content, isStreamingThis)}
                </div>
                {m.created_at && (
                  <div className={`text-[10px] mt-1 tabular-nums ${isUser ? "text-blue-100" : "text-gray-400"}`}>
                    {formatTs(m.created_at)}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {(steps.length > 0 || workflowActive) && (
          <StepsTrace steps={steps} workflowActive={workflowActive} />
        )}
        {isLoading && steps.length === 0 && !workflowActive && <Tool_Spinner />}
      </div>
      {/* Visible drag handle */}
      <div
        onMouseDown={onHandleMouseDown}
        className="flex-shrink-0 h-2 bg-gray-100 hover:bg-blue-200 active:bg-blue-300 cursor-ns-resize transition-colors flex items-center justify-center border-t border-gray-200"
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
  const { locale } = useRouter();
  const [resolvedThreadId, setResolvedThreadId] = useState<string | null>(null);
  const [loadingInit, setLoadingInit] = useState(true);
  const hasSentInitial = useRef(false);
  const [restoredMessages, setRestoredMessages] = useState<ChatMessage[]>([]);
  const savedMessageIds = useRef<Set<string>>(new Set());

  const [traceSteps, setTraceSteps] = useState<StepEvent[]>([]);
  const [workflowActive, setWorkflowActive] = useState(false);
  const workflowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /* ------------------------------------------------------------------ */
  /* Material-agent negotiation state (CLI-like chat handoff)           */
  /* ------------------------------------------------------------------ */
  type ActiveNegotiation = {
    caseId: number;
    sessionKey: string;
    round: number;
    supplyId: string;
    rating: string;
    explanation: string;
    currentDelay: number;
    currentQtyPct: number;
    contingentPlanRunId: number;
    baselinePlanRunId?: number;
    impactedDemandCount: number;
  };
  const [activeNegotiation, setActiveNegotiation] = useState<ActiveNegotiation | null>(null);
  const activeNegotiationRef = useRef<ActiveNegotiation | null>(null);
  activeNegotiationRef.current = activeNegotiation;
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
          params: event.value.params,
          agent: event.value.agent,
          ts: event.timestamp ?? Date.now(),
          level: event.value.level,
        },
      ]);
      setWorkflowActive(true);
      if (workflowTimerRef.current) clearTimeout(workflowTimerRef.current);
      // Safety-net timeout only — real release comes from a terminal trace or
      // sendMessage. Must exceed the longest legitimate inter-trace pause
      // (async-job polling, counter-callback, planner negotiation latency).
      workflowTimerRef.current = setTimeout(() => setWorkflowActive(false), 600_000);

      // Material-agent negotiation: render a CLI-style card + enable slash
      // commands in the chat input.
      const v = event.value as unknown as Record<string, unknown>;
      const step = canonStep(event.value.step);
      if (step === "trace.material.negotiationWaiting") {
        const neg: ActiveNegotiation = {
          caseId: Number(v.caseId),
          sessionKey: String(v.sessionKey),
          round: Number(v.round),
          supplyId: String(v.supplyId),
          rating: String(v.rating),
          explanation: String(v.explanation ?? ""),
          currentDelay: Number(v.currentDelay),
          currentQtyPct: Number(v.currentQtyPct),
          contingentPlanRunId: Number(v.contingentPlanRunId),
          baselinePlanRunId: v.baselinePlanRunId != null ? Number(v.baselinePlanRunId) : undefined,
          impactedDemandCount: Number(v.impactedDemandCount ?? 0),
        };
        setActiveNegotiation(neg);
        const isZh = locale === "zh" || locale?.startsWith("zh");
        const plural = (n: number, en: string) => (n === 1 ? en : `${en}s`);
        const paramsEn =
          neg.currentDelay > 0 && neg.currentQtyPct > 0
            ? `delaying by ${neg.currentDelay} ${plural(neg.currentDelay, "day")} and cutting ${neg.currentQtyPct}%`
            : neg.currentDelay > 0
              ? `delaying by ${neg.currentDelay} ${plural(neg.currentDelay, "day")}`
              : `cutting ${neg.currentQtyPct}%`;
        const paramsZh =
          neg.currentDelay > 0 && neg.currentQtyPct > 0
            ? `延迟 ${neg.currentDelay} 天、削减 ${neg.currentQtyPct}%`
            : neg.currentDelay > 0
              ? `延迟 ${neg.currentDelay} 天`
              : `削减 ${neg.currentQtyPct}%`;
        const severityEn = neg.rating === "HIGH" ? "would seriously disrupt" : "would affect";
        const askEn = "Propose a new delay / qty, keep the current state, or abandon.";
        const askZh = "请提议新的 delay / qty、保持原样，或选择放弃。";
        const roundEn = neg.round > 1 ? `round ${neg.round}` : "first look";
        const roundZh = neg.round > 1 ? `第 ${neg.round} 轮` : "首轮评估";
        const content = isZh
          ? `这次调整将影响供应 ${neg.supplyId} 上的 ${neg.impactedDemandCount} 条需求 — ${paramsZh}。\n` +
            (neg.explanation ? `\n“${neg.explanation}”\n` : "") +
            `\n${askZh}\n回复示例：试试 2 天 5% / 就这样 / 算了。\n也可用指令：/counter delay=<d> qty=<p> · /keep · /abandon\n（${roundZh}，评级 ${neg.rating}）`
          : `This change ${severityEn} ${neg.impactedDemandCount} demand ${plural(neg.impactedDemandCount, "line")} on supply ${neg.supplyId} — ${paramsEn}.\n` +
            (neg.explanation ? `\n“${neg.explanation}”\n` : "") +
            `\n${askEn}\nTry: "try 3 days and 10%" / "keep as-is" / "drop it".\nOr use: /counter delay=<d> qty=<p> · /keep · /abandon\n(${roundEn}, rating ${neg.rating})`;
        addMessage({
          id: crypto.randomUUID(),
          role: "assistant",
          content,
          created_at: new Date().toISOString(),
        });
      } else if (
        step === "trace.material.negotiationKept" ||
        step === "trace.material.negotiationAbandoned" ||
        step === "trace.material.negotiationExhausted" ||
        step === "trace.material.negotiationLateReplyIgnored" ||
        step === "trace.material.baselineDrifted"
      ) {
        setActiveNegotiation(null);
      }

      if (TERMINAL_STEPS.has(step)) {
        if (workflowTimerRef.current) clearTimeout(workflowTimerRef.current);
        setWorkflowActive(false);
      }
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
          locale: locale ?? "en",
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

  /* ------------------------------------------------------------------ */
  /* /material typeahead                                                 */
  /* ------------------------------------------------------------------ */
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestionIndex, setSuggestionIndex] = useState(-1);
  const suggestTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestionListRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (suggestionIndex >= 0 && suggestionListRef.current) {
      const item = suggestionListRef.current.children[suggestionIndex] as HTMLElement | undefined;
      item?.scrollIntoView({ block: "nearest" });
    }
  }, [suggestionIndex]);

  const SLASH_COMMANDS: Record<string, string> = {
    material: "/api/allocator/products",
    supply:   "/api/allocator/supplies",
  };
  const COMMAND_PATTERN = new RegExp(`\\/(${Object.keys(SLASH_COMMANDS).join("|")})([^\\s]*)`);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setUserInput(val);
    setSuggestionIndex(-1);
    const match = val.match(COMMAND_PATTERN);
    if (match) {
      const apiUrl = SLASH_COMMANDS[match[1]];
      const prefix = match[2];
      if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current);
      suggestTimerRef.current = setTimeout(async () => {
        try {
          const res = await fetch(`${apiUrl}?q=${encodeURIComponent(prefix)}`);
          if (res.ok) {
            setSuggestions(await res.json());
            setShowSuggestions(true);
          }
        } catch {
          // allocator backend may be unavailable — fail silently
        }
      }, 200);
    } else {
      setShowSuggestions(false);
      setSuggestions([]);
    }
  }, []);

  const selectSuggestion = useCallback((id: string) => {
    setUserInput((prev) => prev.replace(COMMAND_PATTERN, () => id));
    setShowSuggestions(false);
    setSuggestions([]);
    setSuggestionIndex(-1);
  }, []);

  /* ------------------------------------------------------------------ */
  /* Negotiation dispatcher                                              */
  /* While a negotiation is active, every chat input is routed to the   */
  /* material session's /negotiation-reply endpoint. Slash commands     */
  /* (/keep, /counter delay=N qty=P, /abandon) are a deterministic      */
  /* fast-path that skips the LLM classification round-trip; anything   */
  /* else is forwarded as natural language for the agent to classify.   */
  /* /accept is kept as a legacy alias for /keep.                        */
  /* Returns true if the input was handled as a negotiation reply.      */
  /* ------------------------------------------------------------------ */
  const tryNegotiationCommand = useCallback(async (raw: string): Promise<boolean> => {
    const neg = activeNegotiationRef.current;
    if (!neg) return false;
    const text = raw.trim();
    if (!text) return false;

    let action: "keep" | "abandon" | "counter" | "nl" = "nl";
    let delayDays: number | undefined;
    let qtyPct: number | undefined;

    if (/^\/(keep|accept)\b/i.test(text)) {
      action = "keep";
    } else if (/^\/abandon\b/i.test(text)) {
      action = "abandon";
    } else if (/^\/counter\b/i.test(text)) {
      const dm = text.match(/\bdelay\s*=\s*(-?\d+(?:\.\d+)?)/i);
      const qm = text.match(/\bqty\s*=\s*(-?\d+(?:\.\d+)?)/i);
      if (dm && qm) {
        action = "counter";
        delayDays = Number(dm[1]);
        qtyPct = Number(qm[1]);
      }
      // If a /counter command is missing params, fall through to NL so the
      // agent can ask back — instead of short-circuiting with a canned error.
    }

    // Echo the user's message into the chat stream
    addMessage({
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      created_at: new Date().toISOString(),
    });

    try {
      const res = await fetch("/api/allocator/negotiation-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId: neg.caseId,
          sessionKey: neg.sessionKey,
          action,
          round: neg.round,
          delayDays,
          qtyPct,
          text: action === "nl" ? text : undefined,
          baselinePlanRunId: neg.baselinePlanRunId,
          contingentPlanRunId: neg.contingentPlanRunId,
          supplyId: neg.supplyId,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        addMessage({
          id: crypto.randomUUID(),
          role: "assistant",
          content: `negotiation reply failed (${res.status}): ${body}`,
          created_at: new Date().toISOString(),
        });
        return true;
      }
    } catch (err) {
      addMessage({
        id: crypto.randomUUID(),
        role: "assistant",
        content: `negotiation reply error: ${String(err)}`,
        created_at: new Date().toISOString(),
      });
      return true;
    }

    // Clear the active negotiation — the agent will emit a new
    // negotiationWaiting trace if it re-rates to MEDIUM/HIGH, or
    // negotiationAmbiguous + a fresh waiting prompt if classification failed.
    setActiveNegotiation(null);
    return true;
  }, [addMessage]);

  const sendMessage = async () => {
    if (!userInput.trim() || !resolvedThreadId) return;
    const isNegotiation = activeNegotiationRef.current !== null;
    // Block preemptive sends to the main agent while a workflow is running
    // but no negotiation card is open — otherwise a stray user message (e.g.
    // typing the reply before the waiting-prompt has arrived) routes to the
    // wrong session and loops the state machine.
    if ((isLoading || workflowActive) && !isNegotiation) return;
    const text = userInput;
    setUserInput("");
    setTraceSteps([]);
    setWorkflowActive(false);
    if (workflowTimerRef.current) clearTimeout(workflowTimerRef.current);

    if (await tryNegotiationCommand(text)) return;

    await submit(text);
  };

  /* ------------------------------------------------------------------ */
  /* 6) Render                                                          */
  /* ------------------------------------------------------------------ */
  const allMessages = [...restoredMessages, ...chatMessages];

  const { t } = useTranslation("agent");

  if (loadingInit) {
    return (
      <div className="flex items-center justify-center py-4 text-gray-500">
        {t("run.loadingThread")}
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-lg font-semibold">{t("run.title")}</h2>

      <MessageTable
        height={msgHeight}
        onHeightChange={setMsgHeight}
        isLoading={isLoading}
        messages={allMessages}
        steps={traceSteps.length > 0 ? traceSteps : steps}
        workflowActive={workflowActive || isLoading}
      />

      {!workflowActive && !isLoading && resolvedThreadId && (
        <div className="mt-1">
          <button
            onClick={() => setShowTimeline(s => !s)}
            className="text-[11px] text-blue-500 hover:text-blue-700 hover:underline"
          >
            {showTimeline ? t("run.hideTimeline") : t("run.viewTimeline")}
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

      <div className="mt-2">
        {showSuggestions && suggestions.length > 0 && (() => {
          const rect = inputRef.current?.getBoundingClientRect();
          if (!rect) return null;
          return (
            <ul
              ref={suggestionListRef}
              style={{ position: "fixed", top: rect.bottom + 4, left: rect.left, width: rect.width, zIndex: 9999 }}
              className="bg-white border border-gray-200 rounded shadow-lg max-h-48 overflow-y-auto"
            >
              {suggestions.map((s, i) => (
                <SuggestionItem key={s.id} s={s} active={i === suggestionIndex} onSelect={selectSuggestion} />
              ))}
            </ul>
          );
        })()}
        {activeNegotiation && (
          <div className="mb-1.5 flex items-center gap-2 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            <span>
              negotiating · round {activeNegotiation.round} · {activeNegotiation.rating}
            </span>
            <span className="text-amber-600">—</span>
            <span className="text-amber-700">reply in plain English, or /counter · /keep · /abandon</span>
          </div>
        )}
        <div className="flex gap-2">
          <input
            ref={inputRef}
            disabled={(isLoading || workflowActive) && !activeNegotiation}
            autoComplete="off"
            className="flex-1 border border-gray-300 rounded-full px-4 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 disabled:bg-gray-50 disabled:text-gray-400"
            value={userInput}
            onChange={handleInputChange}
            placeholder={
              activeNegotiation
                ? "accept, try 3 days and 10%, drop it…"
                : (isLoading || workflowActive)
                  ? t("run.workflowRunning")
                  : t("run.typeMessage")
            }
            onKeyDown={(e) => {
              if (showSuggestions && suggestions.length > 0) {
                if (e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); setSuggestionIndex(i => Math.min(i + 1, suggestions.length - 1)); return; }
                if (e.key === "ArrowUp")   { e.preventDefault(); e.stopPropagation(); setSuggestionIndex(i => Math.max(i - 1, -1)); return; }
                if (e.key === "Enter" && suggestionIndex >= 0) { e.preventDefault(); selectSuggestion(suggestions[suggestionIndex].id); return; }
              }
              if (e.key === "Escape") { setShowSuggestions(false); setSuggestionIndex(-1); return; }
              if (e.key === "Enter" && !showSuggestions) sendMessage();
            }}
          />
          <button
            disabled={isLoading || !userInput.trim()}
            className="bg-blue-500 text-white px-4 py-2 rounded-full text-sm font-medium shadow-sm hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            onClick={sendMessage}
          >
            {t("buttons.send", { ns: "common" })}
          </button>
        </div>
      </div>
    </div>
  );
}
