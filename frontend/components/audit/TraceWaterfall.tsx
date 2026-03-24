import { useState } from "react";

export type SpanDTO = {
  id: string;
  trace_id: string;
  parent_id: string | null;
  name: string;
  kind: string;
  business_id: number;
  started_at: string;
  ended_at: string | null;
  status: string | null;
  update_event_id: number | null;
  thread_id: string | null;
  attributes: Record<string, any>;
};

export type TraceDTO = {
  trace_id: string;
  started_at: string;
  ended_at: string;
  spans: SpanDTO[];
};

const KIND_COLORS: Record<string, string> = {
  event: "#3b82f6",
  agent: "#8b5cf6",
  tool: "#f97316",
  email: "#10b981",
};

function durationMs(span: SpanDTO): number {
  if (!span.ended_at) return 0;
  return new Date(span.ended_at).getTime() - new Date(span.started_at).getTime();
}

function SpanDetail({ span, onClose }: { span: SpanDTO; onClose: () => void }) {
  const color = KIND_COLORS[span.kind] ?? "#9ca3af";
  const dur = durationMs(span);

  return (
    <div
      style={{
        marginTop: 12,
        border: `1px solid ${color}44`,
        borderRadius: 6,
        padding: 12,
        background: "#fafafa",
        position: "relative",
      }}
    >
      <button
        onClick={onClose}
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "#9ca3af",
          fontSize: 16,
          lineHeight: 1,
        }}
      >
        ×
      </button>

      <div style={{ marginBottom: 8 }}>
        <span style={{ color, fontWeight: 600 }}>{span.name}</span>
        <span style={{ color: "#9ca3af", marginLeft: 8, fontSize: 11 }}>
          {span.kind} &nbsp;·&nbsp; {dur}ms &nbsp;·&nbsp; {span.status ?? "—"}
        </span>
      </div>

      {Object.keys(span.attributes).length > 0 ? (
        <div>
          {Object.entries(span.attributes).map(([key, val]) => (
            <div key={key} style={{ marginBottom: 6 }}>
              <div style={{ color: "#6b7280", fontSize: 11, marginBottom: 2 }}>{key}</div>
              <div
                style={{
                  background: "#f3f4f6",
                  borderRadius: 4,
                  padding: "6px 8px",
                  fontSize: 12,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  maxHeight: 200,
                  overflowY: "auto",
                }}
              >
                {typeof val === "string"
                  ? val
                  : Array.isArray(val)
                  ? val.join(", ") || "(empty)"
                  : JSON.stringify(val, null, 2)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ color: "#9ca3af", fontSize: 12 }}>No attributes</div>
      )}
    </div>
  );
}

type SpanNode = { span: SpanDTO; depth: number; hasChildren: boolean };

function buildTree(spans: SpanDTO[], collapsed: Set<string>): SpanNode[] {
  const byId = new Map(spans.map((s) => [s.id, s]));

  // Pre-build children map for efficiency
  const childrenOf = new Map<string, SpanDTO[]>();
  for (const s of spans) {
    if (s.parent_id) {
      if (!childrenOf.has(s.parent_id)) childrenOf.set(s.parent_id, []);
      childrenOf.get(s.parent_id)!.push(s);
    }
  }

  const roots = spans.filter((s) => !s.parent_id || !byId.has(s.parent_id));
  const result: SpanNode[] = [];

  function visit(span: SpanDTO, depth: number) {
    const children = (childrenOf.get(span.id) ?? []).sort(
      (a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime()
    );
    result.push({ span, depth, hasChildren: children.length > 0 });
    if (!collapsed.has(span.id)) {
      for (const child of children) visit(child, depth + 1);
    }
  }

  roots
    .sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime())
    .forEach((r) => visit(r, 0));

  return result;
}

export function TraceWaterfall({ trace }: { trace: TraceDTO }) {
  const [selected, setSelected] = useState<SpanDTO | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const traceStart = new Date(trace.started_at).getTime();
  const traceEnd = new Date(trace.ended_at).getTime();
  const totalDuration = traceEnd - traceStart || 1;

  const tree = buildTree(trace.spans, collapsed);

  function toggleCollapse(spanId: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(spanId)) next.delete(spanId);
      else next.add(spanId);
      return next;
    });
  }

  return (
    <div style={{ fontFamily: "monospace", fontSize: 13, padding: 12 }}>
      <div style={{ marginBottom: 8, color: "#6b7280", fontSize: 12 }}>
        trace: {trace.trace_id} &nbsp;|&nbsp; {trace.spans.length} spans &nbsp;|&nbsp;
        {totalDuration}ms total
      </div>

      {tree.map(({ span, depth, hasChildren }) => {
        const spanStart = new Date(span.started_at).getTime();
        const spanEnd = span.ended_at ? new Date(span.ended_at).getTime() : spanStart;
        const left = ((spanStart - traceStart) / totalDuration) * 100;
        const width = Math.max(((spanEnd - spanStart) / totalDuration) * 100, 0.5);
        const color = KIND_COLORS[span.kind] ?? "#9ca3af";
        const dur = durationMs(span);
        const isSelected = selected?.id === span.id;
        const isCollapsed = collapsed.has(span.id);

        return (
          <div
            key={span.id}
            style={{ display: "flex", alignItems: "center", marginBottom: 4, gap: 8 }}
          >
            {/* label with depth indentation */}
            <div
              style={{
                width: 200,
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                gap: 4,
                paddingLeft: depth * 14,
              }}
            >
              {/* collapse toggle */}
              {hasChildren ? (
                <button
                  onClick={() => toggleCollapse(span.id)}
                  title={isCollapsed ? "Expand children" : "Collapse children"}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: 0,
                    color: "#9ca3af",
                    fontSize: 10,
                    lineHeight: 1,
                    flexShrink: 0,
                    width: 12,
                  }}
                >
                  {isCollapsed ? "▶" : "▼"}
                </button>
              ) : (
                depth > 0 && (
                  <span style={{ color: "#d1d5db", flexShrink: 0, width: 12, textAlign: "center" }}>
                    └
                  </span>
                )
              )}

              <span
                onClick={() => setSelected(isSelected ? null : span)}
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  color,
                  cursor: "pointer",
                  textDecoration: isSelected ? "underline" : "none",
                }}
                title={span.name}
              >
                {span.name}
              </span>
            </div>

            {/* bar */}
            <div
              onClick={() => setSelected(isSelected ? null : span)}
              style={{ flex: 1, position: "relative", height: 16, background: "#f3f4f6", borderRadius: 3, cursor: "pointer" }}
            >
              <div
                style={{
                  position: "absolute",
                  left: `${left}%`,
                  width: `${width}%`,
                  height: "100%",
                  background: color,
                  borderRadius: 3,
                  opacity: span.status === "error" ? 0.5 : isSelected ? 1 : 0.8,
                  outline: isSelected ? `2px solid ${color}` : "none",
                }}
                title={`${span.name} — ${dur}ms — ${span.status ?? ""}`}
              />
            </div>

            {/* duration */}
            <div style={{ width: 60, textAlign: "right", color: "#6b7280", flexShrink: 0 }}>
              {dur}ms
            </div>
          </div>
        );
      })}

      {selected && <SpanDetail span={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
