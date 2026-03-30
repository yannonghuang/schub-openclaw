import { useState, useEffect, useCallback } from "react";

export type ThreadSummary = {
  id: number;
  external_thread_id: string;
  langgraph_thread_id: string;
  title: string | null;
  message_count: number;
  thread_source: "user" | "pubsub" | null;
  created_at: string;
  updated_at: string;
};

export function useThreadHistory(businessId: number | null) {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const res = await fetch(`/thread/${businessId}`);
      if (res.ok) {
        const data = await res.json();
        setThreads(data);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { threads, loading, reload };
}
