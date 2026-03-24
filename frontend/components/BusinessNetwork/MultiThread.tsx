"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "../ui/card";
import Agent from "./Agent";
import { Rnd } from "react-rnd";

export type AgentThread = {
  threadKey: string;    
  id: string;           
  title: string;
  initialMessage: string;
  businessId: number | null;
  type?: string;
  eventId?: string;
};

export default function MultiThread({
  businessId,
  initialMessage,
  setShowAgentPopup
}: {
  businessId: number | null;
  initialMessage?: string | null;
  setShowAgentPopup?: (fn: boolean) => void | null;
}) {
  const [threads, setThreads] = useState<AgentThread[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [showWindow, setShowWindow] = useState(true);

  // window position + size
  const [size, setSize] = useState({ width: 600, height: 500 });
  const [position, setPosition] = useState({ x: 50, y: 50 });

  // ----------------- Helpers -----------------
  const parseTypeAndId = (msg: string): { type?: string; id?: string } => {
    try {
      const data = JSON.parse(msg);
      if (data && typeof data === "object") {
        return { type: data.type, id: data.message_id };
      }
    } catch {}
    return {};
  };

  const openThread = (msg: string) => {
    const { type, id } = parseTypeAndId(msg);

    if (!type || !id) return; // invalid noise message

    const newKey = type && id ? `${type}:${id}` : crypto.randomUUID();

    setThreads(prev => {
      const existing = prev.find(t => t.threadKey === newKey);
      if (existing) {
        setActiveKey(existing.threadKey);
        return prev;
      }

      const newThread: AgentThread = {
        threadKey: newKey,
        id: crypto.randomUUID(),
        title: type && id ? `${type} #${id}` : `Thread ${prev.length + 1}`,
        initialMessage: msg,
        businessId,
        type,
        eventId: id,
      };

      setActiveKey(newKey);
      return [...prev, newThread];
    });

    setShowWindow(true); // open if closed
  };

  const closeThread = (threadKey: string) => {
    setThreads(prev => {
      const remaining = prev.filter(t => t.threadKey !== threadKey);
      if (activeKey === threadKey) {
        setActiveKey(remaining.length ? remaining[0].threadKey : null);
      }
      return remaining;
    });
  };

  useEffect(() => {
    if (initialMessage) openThread(initialMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMessage]);

  const activeThread = threads.find(t => t.threadKey === activeKey);

  // ----------------- If window hidden -----------------
  if (!showWindow) {
    return (
      <button
        className="fixed bottom-4 right-4 px-3 py-2 bg-blue-600 text-white rounded shadow"
        onClick={() => setShowWindow(true)}
      >
        Open Agent Panel
      </button>
    );
  }

  return (
    <>
      {/* ---------- Backdrop Overlay ---------- */}
      <div className="fixed inset-0 bg-black bg-opacity-30 z-40" />

      {/* ---------- Draggable/Resizable Panel ---------- */}
      <Rnd
        size={{ width: size.width, height: size.height }}
        position={{ x: position.x, y: position.y }}
        onDragStop={(e, d) => setPosition({ x: d.x, y: d.y })}
        onResizeStop={(e, direction, ref) => {
          setSize({
            width: parseInt(ref.style.width, 10),
            height: parseInt(ref.style.height, 10),
          });
        }}
        bounds="window"
        minWidth={400}
        minHeight={300}
        className="z-50"
      >
        <div className="flex flex-col h-full border rounded shadow bg-white">

          {/* Top Banner (draggable) */}
          <div className="flex justify-between items-center bg-gray-100 px-3 py-2 cursor-move border-b">
            <span className="font-semibold">Agent Streaming</span>
            <button
              onClick={() => {
                setShowWindow(false);
                setShowAgentPopup(false);
              }}
              className="text-red-500 hover:text-red-700"
            >
              ✕
            </button>
          </div>

          {/* Tabs */}
          <div className="flex space-x-2 border-b px-2 py-1 bg-gray-50">
            {threads.map(t => (
              <div
                key={t.threadKey}
                className={`px-3 py-1 rounded-t cursor-pointer flex items-center gap-2
                  ${t.threadKey === activeKey ? "bg-white border border-b-0" : "bg-gray-200"}
                `}
                onClick={() => setActiveKey(t.threadKey)}
              >
                <span>{t.title}</span>
                <button
                  onClick={e => {
                    e.stopPropagation();
                    closeThread(t.threadKey);
                  }}
                  className="text-red-500 hover:text-red-700"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          {/* Agent content */}
          <div className="flex-1 overflow-auto p-2">
            {threads.map(t => (
              <div
                key={t.threadKey}
                style={{ display: t.threadKey === activeKey ? "block" : "none" }}
              >
                <Card className="border shadow-sm">
                  <CardContent>
                    <Agent
                      apiUrl="https://localhost/langgraph-api"
                      businessId={t.businessId}
                      initialMessage={t.initialMessage}
                      threadId={activeKey}
                    />
                  </CardContent>
                </Card>
              </div>
            ))}
          </div>
        </div>
      </Rnd>
    </>
  );
}
