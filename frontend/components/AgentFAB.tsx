"use client";

import { useAuth } from "../context/AuthContext";
import { useAgentPanel } from "../context/AgentPanelContext";

export default function AgentFAB() {
  const { user, isSystem } = useAuth();
  const { setShowWindow, showWindow } = useAgentPanel();

  if (!user || isSystem() || showWindow) return null;

  return (
    <button
      onClick={() => setShowWindow(true)}
      title="Ask Agent"
      className="fixed bottom-6 right-6 z-40 bg-blue-600 hover:bg-blue-700 text-white rounded-full px-4 py-3 shadow-lg flex items-center gap-2 text-sm font-medium transition-colors"
    >
      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
      </svg>
      Ask Agent
    </button>
  );
}
