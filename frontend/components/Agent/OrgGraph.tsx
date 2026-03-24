import { useEffect, useRef, useState } from "react";
import { Network } from "vis-network";
import { DataSet } from "vis-data";

type OrgGraphProps = {
  business: { id: number; name: string };
  subAgents: { id: number; name: string }[];
  selectedId: number | null;
  onSelect: (type: "business" | "subagent", id?: number) => void;
  onDeleteSubAgent: (subAgentId: number) => void;
  onEditSubAgent: (subAgentId: number) => void;
};

type GraphEdge = {
  id: string;
  from: number;
  to: number;
  arrows?: string;
};

export default function OrgGraph({
  business,
  subAgents,
  selectedId,
  onSelect,
  onDeleteSubAgent,
  onEditSubAgent,
}: OrgGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const networkRef = useRef<Network | null>(null);
  const nodesRef = useRef<DataSet<any> | null>(null);

  const [toolbar, setToolbar] = useState<{
    x: number;
    y: number;
    nodeId: number;
  } | null>(null);

  // ----------------------------
  // Build graph
  // ----------------------------
  useEffect(() => {
    if (!containerRef.current) return;

    const nodes = new DataSet([
      {
        id: business.id,
        label: "Main Agent", //business.name,
        level: 0,

        //shape: "box",
        shape: "image",
        image: "/icons/main_agent.png",
        size: 35,
        font: {
          color: "#111",
          size: 14,
          vadjust: 1, // push label below icon
        },

        color: { background: "#f59e0b", border: "#b45309" },
        //font: { color: "white", size: 18, bold: true },
      },
      ...subAgents.map((sa) => ({
        id: sa.id,
        label: sa.name,
        level: 1,
        //shape: "ellipse",

        shape: "image",
        image: "/icons/sub_agent.png",
        size: 25,
        font: {
          color: "#111",
          size: 14,
          vadjust: 5, // push label below icon
        },

        color: { background: "#2563eb", border: "#1e40af" },
        //font: { color: "white" },
      })),
    ]);

    const edges = new DataSet<GraphEdge>(
      subAgents.map((sa) => ({
        id: `edge-${business.id}-${sa.id}`,
        from: business.id,
        to: sa.id,
        arrows: "to",
      }))
    );

    nodesRef.current = nodes;

    const options = {
      layout: {
        hierarchical: {
          enabled: true,
          direction: "UD",
          nodeSpacing: 160,
          levelSeparation: 120,
        },
      },
      physics: false,
      interaction: {
        zoomView: false,   // ⛔ disable mouse wheel + trackpad zoom
        hover: true,
      },
      edges: {
        smooth: false,
      },
    };

    const network = new Network(containerRef.current, { nodes, edges }, options);
    networkRef.current = network;

    // ----------------------------
    // Node click
    // ----------------------------
    (network as any).on("click", (params: any) => {
      // Clicked empty space → close toolbar
      if (!params.nodes.length) {
        setToolbar(null);
        return;
      }

      const nodeId = params.nodes[0];

      if (nodeId === business.id) {
        onSelect("business");
        setToolbar(null);
      } else {
        onSelect("subagent", nodeId);

        const pos = (network as any).getPositions([nodeId])[nodeId];
        const canvasPos = (network as any).canvasToDOM(pos);

        setToolbar({
          x: canvasPos.x,
          y: canvasPos.y,
          nodeId,
        });
      }
    });

    return () => {
      (network as any).destroy();
      networkRef.current = null;
    };
  }, [business, subAgents]);

  // ----------------------------
  // Selection highlight
  // ----------------------------
  useEffect(() => {
    if (!nodesRef.current) return;

    const nodes = nodesRef.current;

    nodes.forEach((node) => {
      nodes.update({
        id: node.id,
        borderWidth: node.id === selectedId ? 4 : 1,
        shadow:
          node.id === selectedId
            ? { enabled: true, size: 15 }
            : { enabled: false },
      });
    });
  }, [selectedId]);

  return (
    <div className="relative">
      <div
        ref={containerRef}
        style={{ height: 400 }}
        className="border rounded"
      />

      {toolbar && (
        <div
          className="absolute z-50 bg-white border rounded shadow-md text-sm"
          style={{
            top: toolbar.y,
            left: toolbar.x,
            transform: "translate(-50%, -120%)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="block w-full px-4 py-2 text-left hover:bg-gray-100"
            onClick={() => {
              onEditSubAgent(toolbar.nodeId);
              setToolbar(null);
            }}
          >
            Edit
          </button>
          <button
            className="block w-full px-4 py-2 text-left text-red-600 hover:bg-red-50"
            onClick={() => {
              onDeleteSubAgent(toolbar.nodeId);
              setToolbar(null);
            }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
