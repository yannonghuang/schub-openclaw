// components/SystemGraphWithEdgeTooltip.tsx
import React, { useEffect, useRef } from "react";
import { Network } from "vis-network/standalone"; // if using standalone bundle
import { DataSet } from "vis-data";

import { Card, CardContent } from "../ui/card";
import { saveGraphPositions, loadGraphPositions } from "./graphUtils";


export default function SystemGraph({
  activeTab,
  relationships
}) {
  const graphRef = useRef<HTMLDivElement | null>(null);
  const networkRef = useRef<Network | null>(null);

  useEffect(() => {
    if (activeTab !== "network") return;
    if (!graphRef.current || relationships.length === 0) return;

    // build nodes map
    const nodesMap = new Map<number, { id: number; label: string; x?: number; y?: number }>();
    relationships.forEach((r) => {
      nodesMap.set(r.supplier.id, { id: r.supplier.id, label: r.supplier.name });
      nodesMap.set(r.customer.id, { id: r.customer.id, label: r.customer.name });
    });

    const savedPositions = loadGraphPositions("systemGraphPositions");
    const cachedExists = savedPositions !== null;

    const nodes = new DataSet(
      Array.from(nodesMap.values()).map((node) => ({
        ...node,
        ...(savedPositions && savedPositions[node.id] ? savedPositions[node.id] : {}),
      }))
    );

    // include tooltip content on the edge object (title or custom field)
    const edges = new DataSet(
      relationships.map((r, idx) => ({
        id: idx,
        from: r.supplier.id,
        to: r.customer.id,
        arrows: "to",
        // prefer title (vis built-in) but we'll also use edgeMeta for our custom tooltip
        title: r.material?.name + `(from: ${r.supplier.location?.name}, to: ${r.customer.location?.name}, mode: ${r.transportation?.mode}, duration: ${r.transportation?.duration}, price: ${r.transportation?.price})`,
      }))
    );

    const options = {
      layout: cachedExists
        ? {}
        : {
            hierarchical: {
              enabled: true,
              direction: "LR",
              nodeSpacing: 200,
              levelSeparation: 200,
            },
          },
      nodes: {
        shape: "box",
      },
      edges: {
        width: 1.6,
        hoverWidth: 4,
        smooth: false,
        color: { inherit: "from" },
      },
      interaction: {
        hover: true,         // allow hover detection
        tooltipDelay: 100,
        hideEdgesOnDrag: false,
        hoverConnectedEdges: true,
      },
      physics: { enabled: false },
    };

    // destroy previous network if exists
    if (networkRef.current) {
      try {
        networkRef.current.destroy();
      } catch {}
      networkRef.current = null;
    }

    const network = new Network(graphRef.current, { nodes, edges }, options);
    networkRef.current = network;

    // Save positions on drag
    network.on("dragEnd", () => saveGraphPositions("systemGraphPositions", network));


  }, [activeTab, relationships]);

  return (
    <Card className="col-span-2">
      <CardContent>
        <h2 className="text-xl font-semibold mb-4">All Business Relationships</h2>
        <div ref={graphRef} style={{ height: "600px" }} />
      </CardContent>
    </Card>
  );
}
