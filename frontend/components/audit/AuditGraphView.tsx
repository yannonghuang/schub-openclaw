import { useEffect, useRef } from "react";
import { Network } from "vis-network";
import { DataSet } from "vis-data";

import { Resizable } from "re-resizable";

/* ---------- Shared DTOs ---------- */

export type GraphNode = {
  id: string;
  label: string;
  type: "event" | "thread" | "message";
  data: any;
  color?: string;
};

export type GraphEdge = {
  from: string;
  to: string;
  type: string;
};

export type GraphDTO = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

/* ---------- Props ---------- */

type Props = {
  graph: GraphDTO;
  onSelectNode?: (node: GraphNode | null) => void;
};

/* ---------- Component ---------- */

export function AuditGraphView({ graph, onSelectNode }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const networkRef = useRef<Network | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    /* ---------- Nodes ---------- */
    const nodes = new DataSet<GraphNode>(
      graph.nodes.map(n => ({
        ...n,
        shape:
          n.type === "event"
            ? "box"
            : n.type === "thread"
            ? "ellipse"
            : "dot",
        color:  n.color,
      }))
    );

    /* ---------- Edges (must have id) ---------- */
    const edges = new DataSet(
      graph.edges.map(e => ({
        id: `${e.from}->${e.to}`,
        from: e.from,
        to: e.to,
        arrows: "to",
      }))
    );

    /* ---------- Network ---------- */
    const network = new Network(
      containerRef.current,
      { nodes, edges },
      {
        layout: {
          hierarchical: {
            direction: "LR",
            levelSeparation: 160,
            nodeSpacing: 140,
          },
        },
        interaction: {
          hover: true,
        },
        physics: false,
      }
    );

    networkRef.current = network;

    /* ---------- Click handling ---------- */
    (network as any).on("click", params => {
        if (!onSelectNode) return;

        if (params.nodes.length === 0) {
            onSelectNode(null);
            return;
        }

        const nodeId = params.nodes[0] as string; // 👈 force scalar
        const node = nodes.get(nodeId);           // 👈 now T | null
        onSelectNode(node ?? null);
    });

    return () => {
      (network as any).destroy();
      networkRef.current = null;
    };
  }, [graph, onSelectNode]);

  useEffect(() => {
    if (!containerRef.current || !networkRef.current) return;

    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;

      (networkRef.current as any)!.setSize(
        `${width}px`,
        `${height}px`
      );
      (networkRef.current as any)!.redraw();
    });

    observer.observe(containerRef.current);

    return () => observer.disconnect();
  }, []);

  return (
    <Resizable
      defaultSize={{ width: "100%", height: 600 }}
      minHeight={200}
      maxHeight={800}
      className="border rounded shadow-sm bg-white"
    >
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: "100%",
          border: "1px solid #ddd",
        }}
      />
    </Resizable>
  );
}
