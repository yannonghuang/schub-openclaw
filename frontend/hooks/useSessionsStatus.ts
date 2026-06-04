import { useState, useEffect, useCallback } from "react";

export type SessionInfo = {
  key: string;
  uuid: string;
  ageSeconds: number;
  state: "active" | "pendingGc" | "negotiating" | "idle";
  subagent: boolean;
};
export type AgentSessions = {
  agent: string;
  total: number;
  counts: Record<string, number>;
  sessions: SessionInfo[];
};
export type SessionsStatus = {
  generatedAt: number;
  graceSeconds: number;
  agents: AgentSessions[];
};

/** Polls the switch-service OpenClaw session inventory while `enabled`. */
export function useSessionsStatus(enabled: boolean, intervalMs = 4000) {
  const [data, setData] = useState<SessionsStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/agui/sessions/status");
      if (res.ok) setData(await res.json());
    } catch {
      // switch-service unreachable — keep last snapshot
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    setLoading(true);
    reload();
    const id = setInterval(reload, intervalMs);
    return () => clearInterval(id);
  }, [enabled, intervalMs, reload]);

  return { data, loading, reload };
}
