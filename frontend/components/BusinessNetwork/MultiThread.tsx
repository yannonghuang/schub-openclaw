"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import Agent from "./Agent";
import { useAgentPanel } from "../../context/AgentPanelContext";
import { useThreadHistory } from "../../hooks/useThreadHistory";
import { useAuth } from "../../context/AuthContext";

const QUICK_ACTIONS = [
  "What is the status of my open orders?",
  "Check material supply levels",
  "Plan production for next week",
  "WIP queue status",
];

export default function MultiThread() {
  const {
    threads, activeKey, showWindow,
    setActiveKey, setShowWindow,
    openUserThread, reopenThread, closeThread,
  } = useAgentPanel();

  const { user } = useAuth();
  const businessId = user?.business?.id ?? null;

  const [showNewChat, setShowNewChat] = useState(false);
  const [newChatInput, setNewChatInput] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const { threads: history, loading: histLoading, reload: reloadHistory } = useThreadHistory(businessId);

  const MIN_WIDTH = 320;
  const MAX_WIDTH = typeof window !== "undefined" ? Math.round(window.innerWidth * 0.9) : 1200;
  const [panelWidth, setPanelWidth] = useState(480);
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null);

  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragState.current = { startX: e.clientX, startWidth: panelWidth };

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragState.current) return;
      const delta = dragState.current.startX - ev.clientX;
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragState.current.startWidth + delta));
      setPanelWidth(next);
    };
    const onMouseUp = () => {
      dragState.current = null;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [panelWidth, MAX_WIDTH]);

  const startNewChat = () => {
    if (!newChatInput.trim()) return;
    openUserThread(newChatInput.trim());
    setNewChatInput("");
    setShowNewChat(false);
    setShowHistory(false);
  };

  const handleReopenThread = (t: typeof history[0]) => {
    reopenThread({
      external_thread_id: t.external_thread_id,
      title: t.title,
      thread_source: t.thread_source,
    });
    setShowHistory(false);
  };

  const handleOpenHistory = () => {
    reloadHistory();
    setShowHistory(true);
    setShowNewChat(false);
  };

  const close = () => {
    setShowWindow(false);
    setShowNewChat(false);
    setShowHistory(false);
  };

  return (
    <>
      {/* Slide-in panel */}
      <div
        className="fixed top-0 right-0 h-full z-50 flex flex-col bg-white border-l shadow-2xl transition-transform duration-300 ease-in-out"
        style={{
          width: `${panelWidth}px`,
          transform: showWindow ? "translateX(0)" : "translateX(100%)",
        }}
      >
        {/* Left-edge resize handle */}
        <div
          onMouseDown={onResizeMouseDown}
          className="absolute top-0 left-0 h-full w-1.5 cursor-ew-resize hover:bg-blue-300 active:bg-blue-400 transition-colors z-10"
          title="Drag to resize"
        />
        {/* Header */}
        <div className="flex justify-between items-center px-4 py-3 bg-gray-50 border-b flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm text-gray-700">Agent</span>
            <button
              onClick={() => { setShowNewChat(s => !s); setShowHistory(false); }}
              className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
            >
              + New Chat
            </button>
            <button
              onClick={handleOpenHistory}
              className="px-2 py-1 text-xs bg-gray-200 text-gray-600 rounded hover:bg-gray-300"
            >
              History
            </button>
          </div>
          <button onClick={close} className="text-gray-400 hover:text-gray-700 text-lg leading-none">✕</button>
        </div>

        {/* New Chat Form */}
        {showNewChat && (
          <div className="border-b px-4 py-3 bg-blue-50 flex-shrink-0 space-y-2">
            <p className="text-xs text-gray-500">Ask the agent anything:</p>
            <div className="flex gap-1 flex-wrap">
              {QUICK_ACTIONS.map(q => (
                <button
                  key={q}
                  onClick={() => setNewChatInput(q)}
                  className="text-xs px-2 py-1 bg-white border rounded hover:bg-gray-50"
                >
                  {q}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                autoFocus
                className="flex-1 border rounded px-2 py-1 text-sm"
                placeholder="Type your question..."
                value={newChatInput}
                onChange={e => setNewChatInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && startNewChat()}
              />
              <button
                onClick={startNewChat}
                disabled={!newChatInput.trim()}
                className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40"
              >
                Start
              </button>
            </div>
          </div>
        )}

        {/* History Panel */}
        {showHistory && (
          <div className="border-b px-4 py-3 bg-gray-50 flex-shrink-0 overflow-y-auto max-h-56">
            <p className="text-xs font-medium text-gray-500 mb-2">Previous conversations</p>
            {histLoading && <p className="text-xs text-gray-400">Loading...</p>}
            {!histLoading && history.length === 0 && (
              <p className="text-xs text-gray-400">No previous threads.</p>
            )}
            {history.map(t => (
              <div key={t.id} className="flex items-center justify-between py-1.5 border-b last:border-0">
                <div className="flex-1 min-w-0 mr-2">
                  <div className="flex items-center gap-1">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${t.thread_source === "user" ? "bg-blue-100 text-blue-600" : "bg-amber-100 text-amber-600"}`}>
                      {t.thread_source === "user" ? "Chat" : "Inbox"}
                    </span>
                    <span className="text-xs text-gray-700 truncate">{t.title || t.external_thread_id}</span>
                  </div>
                  <span className="text-[10px] text-gray-400 ml-1">{t.message_count} msg · {new Date(t.created_at).toLocaleDateString()}</span>
                </div>
                <button
                  onClick={() => handleReopenThread(t)}
                  className="text-xs px-2 py-0.5 bg-white border rounded hover:bg-gray-100 flex-shrink-0"
                >
                  Open
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b px-2 pt-1 bg-gray-50 overflow-x-auto flex-shrink-0 gap-1">
          {threads.length === 0 && !showNewChat && (
            <div className="text-xs text-gray-400 py-2 px-1">
              Click <strong>+ New Chat</strong> to start
            </div>
          )}
          {threads.map(t => (
            <div
              key={t.threadKey}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-t cursor-pointer whitespace-nowrap text-xs border-b-2 transition-colors
                ${t.threadKey === activeKey
                  ? "border-blue-500 bg-white text-gray-800 font-medium"
                  : "border-transparent text-gray-500 hover:bg-gray-100"
                }`}
              onClick={() => { setActiveKey(t.threadKey); setShowNewChat(false); setShowHistory(false); }}
            >
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${t.source === "user" ? "bg-blue-400" : "bg-amber-400"}`} />
              <span className="max-w-[130px] truncate">{t.title}</span>
              <button
                onClick={e => { e.stopPropagation(); closeThread(t.threadKey); }}
                className="text-gray-300 hover:text-red-500 ml-0.5"
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        {/* Agent content */}
        <div className="flex-1 overflow-hidden">
          {threads.length === 0 && !showNewChat && (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-3">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-10 h-10 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
              <p className="text-sm">No active conversations</p>
              <button
                onClick={() => setShowNewChat(true)}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                + New Chat
              </button>
            </div>
          )}
          {threads.map(t => (
            <div
              key={t.threadKey}
              className="h-full overflow-auto"
              style={{ display: t.threadKey === activeKey ? "block" : "none" }}
            >
              <Agent
                apiUrl="https://localhost/langgraph-api"
                businessId={t.businessId}
                initialMessage={t.initialMessage}
                threadId={t.threadKey}
                source={t.source}
                title={t.title}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Dim overlay — click to close */}
      {showWindow && (
        <div
          className="fixed inset-0 bg-black bg-opacity-20 z-40"
          onClick={close}
        />
      )}
    </>
  );
}
