"use client";

import { useState } from "react";
import type { SessionsStatus } from "../../hooks/useSessionsStatus";

const STATE_COLOR: Record<string, string> = {
  active: "bg-green-500",
  pendingGc: "bg-blue-500",
  negotiating: "bg-amber-500",
  idle: "bg-gray-300",
};
const STATE_LABEL: Record<string, string> = {
  active: "active",
  pendingGc: "pending-gc",
  negotiating: "negotiating",
  idle: "idle",
};

const fmtAge = (s: number) =>
  s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`;

export default function SessionsPanel({
  data,
  loading,
}: {
  data: SessionsStatus | null;
  loading: boolean;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (a: string) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      n.has(a) ? n.delete(a) : n.add(a);
      return n;
    });

  const empty = data && data.agents.every((a) => a.total === 0);

  return (
    <div className="border-b px-4 py-3 bg-gray-50 flex-shrink-0 overflow-y-auto max-h-72">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium text-gray-500">OpenClaw sessions</p>
        <span className="text-[10px] text-gray-400">{loading && !data ? "…" : "↻ 4s"}</span>
      </div>

      {!data && <p className="text-xs text-gray-400">Loading…</p>}
      {empty && <p className="text-xs text-gray-400">No sessions.</p>}

      {data?.agents.map((a) => (
        <div key={a.agent} className="border-b last:border-0 py-1.5">
          <button
            onClick={() => a.total > 0 && toggle(a.agent)}
            className={`w-full flex items-center gap-2 text-left ${a.total > 0 ? "cursor-pointer" : "cursor-default"}`}
          >
            <span className="text-xs font-medium text-gray-700 w-20 flex-shrink-0">{a.agent}</span>
            <span className="flex-1 flex items-center gap-2 flex-wrap">
              {a.total === 0 ? (
                <span className="text-[10px] text-gray-300">—</span>
              ) : (
                Object.entries(a.counts)
                  .filter(([, n]) => n > 0)
                  .map(([st, n]) => (
                    <span key={st} className="inline-flex items-center gap-1 text-[10px] text-gray-500" title={STATE_LABEL[st]}>
                      <span className={`w-2 h-2 rounded-full ${STATE_COLOR[st]}`} />
                      {n}
                    </span>
                  ))
              )}
            </span>
            {a.total > 0 && (
              <span className="text-gray-300 text-[10px] flex-shrink-0">{expanded.has(a.agent) ? "▾" : "▸"}</span>
            )}
          </button>

          {expanded.has(a.agent) && (
            <div className="mt-1 ml-1 space-y-0.5">
              {a.sessions.map((s) => (
                <div key={s.uuid} className="flex items-center gap-2 text-[10px] text-gray-500" title={s.key}>
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATE_COLOR[s.state]}`} />
                  <span className="font-mono truncate flex-1">
                    {s.subagent ? "↳ " : ""}
                    {s.uuid.slice(0, 8)}…
                  </span>
                  <span className="text-gray-400 flex-shrink-0">{fmtAge(s.ageSeconds)}</span>
                  <span className="text-gray-400 w-16 text-right flex-shrink-0">{STATE_LABEL[s.state]}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      <div className="flex items-center gap-2 mt-2 pt-1 border-t flex-wrap text-[10px] text-gray-400">
        {Object.entries(STATE_LABEL).map(([st, lbl]) => (
          <span key={st} className="inline-flex items-center gap-1">
            <span className={`w-2 h-2 rounded-full ${STATE_COLOR[st]}`} />
            {lbl}
          </span>
        ))}
      </div>
    </div>
  );
}
