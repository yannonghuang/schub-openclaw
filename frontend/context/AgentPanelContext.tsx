"use client";

import { createContext, useContext, useState, useCallback } from "react";
import { useAuth } from "./AuthContext";

export type AgentThread = {
  threadKey: string;       // "type:id" for pubsub, "user:{uuid}" for user
  id: string;
  title: string;
  initialMessage: string;  // empty string for reopened threads (no auto-send)
  businessId: number | null;
  source: "pubsub" | "user";
  type?: string;
  eventId?: string;
};

export type ThreadSummaryForReopen = {
  external_thread_id: string;
  title: string | null;
  thread_source: "user" | "pubsub" | null;
};

type AgentPanelContextType = {
  threads: AgentThread[];
  activeKey: string | null;
  showWindow: boolean;
  setActiveKey: (key: string | null) => void;
  setShowWindow: (show: boolean) => void;
  openPubsubThread: (msg: string) => void;
  openUserThread: (firstMessage: string) => void;
  reopenThread: (summary: ThreadSummaryForReopen) => void;
  closeThread: (threadKey: string) => void;
};

const AgentPanelContext = createContext<AgentPanelContextType | undefined>(undefined);

function parseTypeAndId(msg: string): { type?: string; id?: string } {
  try {
    const data = JSON.parse(msg);
    if (data && typeof data === "object") {
      return { type: data.type, id: String(data.message_id) };
    }
  } catch {}
  return {};
}

export function AgentPanelProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const businessId = user?.business?.id ?? null;

  const [threads, setThreads] = useState<AgentThread[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [showWindow, setShowWindow] = useState(false);

  const openPubsubThread = useCallback((msg: string) => {
    const { type, id } = parseTypeAndId(msg);
    if (!type || !id) return;
    const newKey = `${type}:${id}`;

    setThreads(prev => {
      const existing = prev.find(t => t.threadKey === newKey);
      if (existing) {
        setActiveKey(existing.threadKey);
        return prev;
      }
      const newThread: AgentThread = {
        threadKey: newKey,
        id: crypto.randomUUID(),
        title: `${type} #${id}`,
        initialMessage: msg,
        businessId,
        source: "pubsub",
        type,
        eventId: id,
      };
      setActiveKey(newKey);
      return [...prev, newThread];
    });

    setShowWindow(true);
  }, [businessId]);

  const openUserThread = useCallback((firstMessage: string) => {
    const newKey = `user:${crypto.randomUUID()}`;
    const newThread: AgentThread = {
      threadKey: newKey,
      id: crypto.randomUUID(),
      title: firstMessage.trim().slice(0, 50) || "New Chat",
      initialMessage: firstMessage.trim(),
      businessId,
      source: "user",
    };
    setThreads(prev => [...prev, newThread]);
    setActiveKey(newKey);
    setShowWindow(true);
  }, [businessId]);

  const reopenThread = useCallback((summary: ThreadSummaryForReopen) => {
    const key = summary.external_thread_id;
    if (!key) return;

    setThreads(prev => {
      const existing = prev.find(t => t.threadKey === key);
      if (existing) {
        setActiveKey(existing.threadKey);
        return prev;
      }
      const newThread: AgentThread = {
        threadKey: key,
        id: crypto.randomUUID(),
        title: summary.title || key,
        initialMessage: "", // no auto-send on reopen
        businessId,
        source: (summary.thread_source as "user" | "pubsub") ?? "pubsub",
      };
      setActiveKey(key);
      return [...prev, newThread];
    });

    setShowWindow(true);
  }, [businessId]);

  const closeThread = useCallback((threadKey: string) => {
    setThreads(prev => {
      const remaining = prev.filter(t => t.threadKey !== threadKey);
      setActiveKey(curr => {
        if (curr === threadKey) return remaining.length ? remaining[0].threadKey : null;
        return curr;
      });
      return remaining;
    });
  }, []);

  return (
    <AgentPanelContext.Provider value={{
      threads, activeKey, showWindow,
      setActiveKey, setShowWindow,
      openPubsubThread, openUserThread, reopenThread, closeThread,
    }}>
      {children}
    </AgentPanelContext.Provider>
  );
}

export function useAgentPanel() {
  const ctx = useContext(AgentPanelContext);
  if (!ctx) throw new Error("useAgentPanel must be used within AgentPanelProvider");
  return ctx;
}
