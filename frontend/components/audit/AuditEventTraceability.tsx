import { useEffect, useState } from "react";
import { TraceWaterfall, TraceDTO } from "./TraceWaterfall";

export function AuditEventTraceability({ traceId }: { traceId: string }) {
  const [trace, setTrace] = useState<TraceDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setError(null);
        const res = await fetch(`/audit/trace/${encodeURIComponent(traceId)}`);
        if (!res.ok) throw new Error("Failed to load trace");
        const data = await res.json();
        if (!cancelled) setTrace(data);
      } catch (e: any) {
        if (!cancelled) setError(e.message);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [traceId]);

  if (error) return <div style={{ color: "#ef4444", padding: 12 }}>{error}</div>;
  if (!trace) return <div style={{ padding: 12, color: "#9ca3af" }}>Loading trace…</div>;

  return <TraceWaterfall trace={trace} />;
}
