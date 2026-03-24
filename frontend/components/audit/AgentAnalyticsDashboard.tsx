import { useEffect, useState, useRef } from "react";
import { DataSet } from "vis-data";
import { Network } from "vis-network";

export function useAgentAnalytics() {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    fetch("/audit/analytics/agent/dashboard")
      .then(r => r.json())
      .then(setData);
  }, []);

  return data ?? {
    kpis: [],
    triggerTrend: [],
    acceptanceByEvent: [],
    latencyByEvent: [],
    funnel: [],
  };
}

export default function AgentAnalyticsDashboard() {
  const {
    kpis,
    triggerTrend,
    acceptanceByEvent,
    latencyByEvent,
    funnel,
  } = useAgentAnalytics();

  console.log(`kpis = ${JSON.stringify(kpis)}`)
  return (
    <div className="p-6 space-y-6 w-full">

      <div className="grid grid-cols-4 gap-4">
        <KPI label="Agent Fired" value={kpis[0]?.agent_fired} />
        <KPI label="AI Replied" value={kpis[0]?.ai_replied} />
        <KPI label="Event Types" value={kpis[0]?.event_types} />

      </div>

      <div className="grid grid-cols-2 gap-6">
        <TriggerTrendChart data={triggerTrend} />
        <AcceptanceByEventChart data={acceptanceByEvent} />
      </div>

      <div className="grid grid-cols-2 gap-6">
        <LatencyDistributionChart data={latencyByEvent} />
        <AgentFunnelChart data={funnel} />
      </div>

    </div>
  );
}

/////////////////////////////////////////
//////// components /////////////////////
/////////////////////////////////////////

// KPI
export function KPI({
  label,
  value,
}: {
  label: string;
  value: string | number | undefined;
}) {
  return (
    <div className="rounded-lg border bg-white p-4 shadow-sm">
      <div className="text-sm text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-gray-900">
        {value ?? "—"}
      </div>
    </div>
  );
}

// Trigger Trend
type TriggerTrendRow = {
  ts: string;        // ISO timestamp
  event_type: string;
  count: number;
};

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  BarChart,
  Bar,
} from "recharts";

export function TriggerTrendChart({ data }: { data: any[] }) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <h3 className="mb-2 font-medium">Agent Triggers Over Time</h3>

      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data}>
          <XAxis
            dataKey="ts"
            tickFormatter={(v) => new Date(v).toLocaleTimeString()}
          />
          <YAxis />
          <Tooltip
            labelFormatter={(v) =>
              new Date(v).toLocaleString()
            }
          />
          <Legend />
          <Line
            type="monotone"
            dataKey="count"
            stroke="#2563eb"
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}


// acceptance rate
export function AcceptanceByEventChart({
  data,
}: {
  data: any[];
}) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <h3 className="mb-2 font-medium">Acceptance Rate by Event</h3>

      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data}>
          <XAxis dataKey="event_type" />
          <YAxis
            tickFormatter={(v) => `${Math.round(v * 100)}%`}
          />
          <Tooltip
            formatter={(v: number) =>
              `${Math.round(v * 100)}%`
            }
          />
          <Bar
            dataKey="acceptance_rate"
            fill="#16a34a"
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// latency
export function LatencyDistributionChart({
  data,
}: {
  data: any[];
}) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <h3 className="mb-2 font-medium">Agent Latency (ms)</h3>

      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data}>
          <XAxis dataKey="event_type" />
          <YAxis />
          <Tooltip />
          <Legend />
          <Bar dataKey="p50" fill="#3b82f6" />
          <Bar dataKey="p95" fill="#ef4444" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// funnel
export function AgentFunnelChart({
  data,
}: {
  data: any[];
}) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <h3 className="mb-2 font-medium">Agent Funnel</h3>

      <ResponsiveContainer width="100%" height={280}>
        <BarChart
          data={data}
          layout="vertical"
        >
          <XAxis type="number" />
          <YAxis type="category" dataKey="label" />
          <Tooltip />
          <Bar dataKey="value" fill="#6366f1" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}



/*
type AgentSummaryRow = {
  event_type: string;
  trigger_rate: number;
  confirmed: number;
  rejected: number;
  ignored: number;
  avg_event_to_agent_ms: number;
};

export function useAgentSummary() {
  const [data, setData] = useState<AgentSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/audit/analytics/agent/summary")
      .then(r => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  return { data, loading };
}

export function AgentAnalyticsDashboard() {
  const { data, loading } = useAgentSummary();

  if (loading) return <div>Loading analytics…</div>;

  return (
    <div className="analytics-page">
      <h2>Agent Effectiveness</h2>

      <table className="analytics-table">
        <thead>
          <tr>
            <th>Event Type</th>
            <th>Trigger %</th>
            <th>Confirmed</th>
            <th>Rejected</th>
            <th>Ignored</th>
            <th>Avg Latency</th>
          </tr>
        </thead>
        <tbody>
          {data.map(r => (
            <tr key={r.event_type}>
              <td>{r.event_type}</td>
              <td>{Math.round(r.trigger_rate * 100)}%</td>
              <td>{r.confirmed}</td>
              <td>{r.rejected}</td>
              <td>{r.ignored}</td>
              <td>{r.avg_event_to_agent_ms} ms</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
*/