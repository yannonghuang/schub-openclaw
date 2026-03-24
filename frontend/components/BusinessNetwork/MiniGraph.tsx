"use client";

import { useEffect, useRef, useState } from "react";
import { Network } from "vis-network";
import { DataSet } from "vis-data";

import { Card, CardContent } from "../ui/card";
import { useAuth } from "../../context/AuthContext";
import { saveGraphPositions, loadGraphPositions } from "./graphUtils";

import DraggablePopup from "./DraggablePopup";
import MessagePanel from "./MessagePanel";

import SupplierList from "./SupplierList";
import CustomerList from "./CustomerList";

// -----------------------------
// Blink + Glow Effect Helper
// -----------------------------
const makeBlinkGlow = (
  nodes: any,
  originalColors: Record<number, any>,
  id: number
) => {
  let blinkState = false;
  let count = 0;
  const maxBlinks = 6; // 3 full on/off cycles

  const blinkInterval = setInterval(() => {
    blinkState = !blinkState;
    count++;

    nodes.update({
      id,
      color: {
        background: blinkState ? "#fff65b" : "#ffe000",
        border: blinkState ? "#000000" : "#222222",
      },
      borderWidth: blinkState ? 4 : 2,
    });

    if (count >= maxBlinks) {
      clearInterval(blinkInterval);

      // After blink: strong glow
      nodes.update({
        id,
        shadow: {
          enabled: true,
          size: 35,
          color: "rgba(255,255,0,0.95)",
        },
        borderWidth: 4,
      });

      // Remove glow after 1.2s
      setTimeout(() => {
        nodes.update({
          id,
          shadow: { enabled: false },
          color: originalColors[id],
          borderWidth: 1,
        });
      }, 1200);
    }
  }, 120);
};

// -----------------------------
// 1. Type Definitions
// -----------------------------
type Recipient = { id: number; name: string; material?: any };

type GraphNode = {
  id: number;
  label: string;
  color: { background: string; border: string };
  originalColor: { background: string; border: string };
  font?: any;
  shape?: string;
  borderWidth?: number;
  shadow?: { enabled: boolean; color?: string; size?: number };
  size?: number;
};

type MiniGraphProps = {
  activeTab: string;
  suppliers: Recipient[];
  customers: Recipient[];
  businessId: number;
  setSuppliers?: any;// (suppliers: Recipient[]) => void;
  setCustomers?: any; //(customers: Recipient[]) => void;
};

export default function MiniGraph({
  activeTab,
  suppliers,
  customers,
  businessId,
  setSuppliers,
  setCustomers
}: MiniGraphProps) {
  const { user } = useAuth();
  const miniGraphRef = useRef<HTMLDivElement>(null);
  const networkRef = useRef<Network | null>(null);
  const nodesRef = useRef<DataSet<GraphNode> | null>(null);

  const nodeOriginalColorsRef = useRef<Record<number, any>>({}); // <-- needed

  const isSystemUser = !businessId;

  const [popupType, setPopupType] = useState<
    "Supplier Messaging" | 
    "Customer Messaging" | 
    "Supplier Setup" |
    "Customer Setup" |
    null
  >(null);

  const [businessToolbar, setBusinessToolbar] = useState<{x: number; y: number;} | null>(null);

  const [popupColor, setPopupColor] = useState<string | null>(null);

  const [selectedRecipients, setSelectedRecipients] = useState<
    Record<number, boolean>
  >({});
  const [selectedSenders, setSelectedSenders] = useState<
    Record<number, boolean>
  >({});

  // Refs for pulsing animation
  const pulseRef = useRef<number | null>(null);
  const pulseStepRef = useRef(0);

  // -----------------------------
  // 2. Build Graph
  // -----------------------------
  useEffect(() => {
    if (activeTab !== "network") return;
    if (isSystemUser || !miniGraphRef.current || !user?.business) return;

    const businessNode: GraphNode = {
      id: businessId,
      label: user.business.name,
      color: { background: "#f59e0b", border: "#b45309" },
      originalColor: { background: "#f59e0b", border: "#b45309" },
      font: { color: "white", size: 18, bold: true },
      shape: "box",
      borderWidth: 3,
      shadow: { enabled: true, size: 10 },
      size: 40,
    };

    nodeOriginalColorsRef.current[businessId] = {
      color: businessNode.color,
      borderWidth: businessNode.borderWidth,
      shadow: businessNode.shadow,
      size: businessNode.size,
      shape: businessNode.shape,
    };
    
    const supplierNodes: GraphNode[] = suppliers.map((s) => ({
      id: s.id,
      label: s.name,
      color: { background: "#22c55e", border: "#15803d" },
      originalColor: { background: "#22c55e", border: "#15803d" },
      shape: "ellipse",
      font: { color: "white" },
      size: 30,
    }));

    const customerNodes: GraphNode[] = customers.map((c) => ({
      id: c.id,
      label: c.name,
      color: { background: "#2563eb", border: "#1e40af" },
      originalColor: { background: "#2563eb", border: "#1e40af" },
      shape: "ellipse",
      font: { color: "white" },
      size: 30,
    }));

    // Save original colors for blink-glow restore
    const originals: Record<number, any> = {};
    [...supplierNodes, ...customerNodes].forEach((n) => {
      originals[n.id] = n.originalColor;
    });
    nodeOriginalColorsRef.current = originals;

    const saved = loadGraphPositions(`miniGraphPositions:${businessId}`);

    const nodes = new DataSet<GraphNode>(
      [businessNode, ...supplierNodes, ...customerNodes].map((n) => ({
        ...n,
        ...(saved?.[n.id] || {}),
      }))
    );
    nodesRef.current = nodes;

    const edges = new DataSet([
      ...suppliers.map((s, idx) => ({
        id: `s-${idx}`,
        from: s.id,
        to: user.business.id,
        arrows: "to",
        title: s.material?.name,
      })),
      ...customers.map((c, idx) => ({
        id: `c-${idx}`,
        from: user.business.id,
        to: c.id,
        arrows: "to",
        title: c.material?.name,
      })),
    ]);

    const options = {
      layout: saved
        ? {}
        : {
            hierarchical: {
              enabled: true,
              direction: "LR",
              nodeSpacing: 200,
              levelSeparation: 200,
            },
          },
      edges: { width: 1.6, smooth: false },
      physics: { enabled: false },
      interaction: {
        zoomView: false,   // ⛔ disable mouse wheel + trackpad zoom
        hover: true,
      },
    };

    const network = new Network(miniGraphRef.current, { nodes, edges }, options);
    networkRef.current = network;

    (network as any).on("dragEnd", () =>
      saveGraphPositions(`miniGraphPositions:${businessId}`, network)
    );

    // 🔥 Add click-to-blink-glow
    (network as any).on("selectNode", (params) => {
      const id = params.nodes[0];
      if (!id) return;

      if (id !== businessId) {
        makeBlinkGlow(nodes, nodeOriginalColorsRef.current, id);
      }

      // Business node → show toolbar
      if (id === businessId) {
        const pos = (network as any).getPositions([id])[id];
        const domPos = (network as any).canvasToDOM(pos);

        setBusinessToolbar({
          x: domPos.x,
          y: domPos.y,
        });
      } else {
        setBusinessToolbar(null);
      }
    });

    (network as any).on("click", (params: any) => {
      if (!params.nodes.length) {
        setBusinessToolbar(null);
        return;
      }

      const nodeId = params.nodes[0];

      if (nodeId !== businessId) {
        setBusinessToolbar(null);
        return;
      }

      // 🔹 Get node position in canvas coords
      const pos = (network as any).getPositions([businessId])[businessId];

      // 🔹 Convert to DOM coords
      const dom = (network as any).canvasToDOM(pos);

      setBusinessToolbar({
        x: dom.x - 30, // offset right
        y: dom.y + 100, // offset up
      });
    });

    (network as any).on("dragStart", () => setBusinessToolbar(null));

  }, [
    activeTab,
    suppliers,
    customers,
    businessId,
    user?.business,
    isSystemUser,
  ]);

  // -----------------------------
  // 3. Highlight Selected (Recipients + Senders)
  // -----------------------------
  useEffect(() => {
    if (!networkRef.current || !nodesRef.current) return;
    const nodes = nodesRef.current;

    const allTargets = [...suppliers, ...customers];

    // Reset nodes
    allTargets.forEach((node) => {
      const raw = nodes.get(node.id);
      if (!raw || Array.isArray(raw)) return;
      const cur = raw as GraphNode;

      nodes.update({
        id: node.id,
        color: cur.originalColor,
        borderWidth: 1,
        shadow: { enabled: false },
        size: cur.size || 30,
      });
    });

    if (pulseRef.current !== null) {
      cancelAnimationFrame(pulseRef.current);
      pulseRef.current = null;
    }

    const idsToPulse = new Set<number>();
    Object.entries(selectedRecipients)
      .filter(([_, v]) => v)
      .forEach(([id]) => idsToPulse.add(Number(id)));
    Object.entries(selectedSenders)
      .filter(([_, v]) => v)
      .forEach(([id]) => idsToPulse.add(Number(id)));

    if (idsToPulse.size === 0) return;

    const animatePulse = () => {
      pulseStepRef.current += 0.05;
      const scale = 1 + 0.2 * Math.sin(pulseStepRef.current);

      idsToPulse.forEach((id) => {
        const raw = nodes.get(id);
        if (!raw || Array.isArray(raw)) return;
        const cur = raw as GraphNode;

        nodes.update({
          id,
          size: (cur.size || 30) * scale,
          shadow: {
            enabled: true,
            color: "rgba(255,255,0,0.8)",
            size: 25,
          },
          borderWidth: 4,
        });

        // 🔥 ALSO trigger blink+glow once
        if (id !== businessId) {
          makeBlinkGlow(nodes, nodeOriginalColorsRef.current, id);
        }
      });

      pulseRef.current = requestAnimationFrame(animatePulse);
    };

    pulseRef.current = requestAnimationFrame(animatePulse);

    return () => {
      if (pulseRef.current !== null) {
        cancelAnimationFrame(pulseRef.current);
        pulseRef.current = null;
      }
    };
  }, [selectedRecipients, selectedSenders, suppliers, customers]);

  // -----------------------------
  // 4. Reset highlights when popup closes
  // -----------------------------
  useEffect(() => {
    if (!networkRef.current || !nodesRef.current) return;

    if (popupType === null) {
      if (pulseRef.current !== null) {
        cancelAnimationFrame(pulseRef.current);
        pulseRef.current = null;
      }

      const nodes = nodesRef.current;

      // Reset business node
      nodes.update({
        id: businessId,
        ...nodeOriginalColorsRef.current[businessId],
      });

      [...suppliers, ...customers].forEach((node) => {
        const raw = nodes.get(node.id);
        if (!raw || Array.isArray(raw)) return;
        const cur = raw as GraphNode;

        nodes.update({
          id: node.id,
          color: cur.originalColor,
          borderWidth: 1,
          shadow: { enabled: false },
          size: cur.size || 30,
        });
      });

      setSelectedRecipients({});
      setSelectedSenders({});
      setPopupColor(null);
    }
  }, [popupType, suppliers, customers]);

  // -----------------------------
  // 5. Panel button colors
  // -----------------------------
  const customerColor = "#2563eb";
  const supplierColor = "#22c55e";

  const openCustomerPanel = () => {
    setPopupType("Customer Messaging");
    setPopupColor(customerColor);
  };

  const openSupplierPanel = () => {
    setPopupType("Supplier Messaging");
    setPopupColor(supplierColor);
  };

  // -----------------------------
  // 6. Render
  // -----------------------------
  return (
    <Card className="col-span-2">
      <CardContent>
        <h2 className="text-xl font-semibold mb-4">My Network</h2>

        <div className="flex gap-3 mb-3">
          <button
            className="px-3 py-2 text-white rounded"
            style={{ backgroundColor: customerColor }}
            onClick={openCustomerPanel}
          >
            Customer Messaging
          </button>

          <button
            className="px-3 py-2 text-white rounded"
            style={{ backgroundColor: supplierColor }}
            onClick={openSupplierPanel}
          >
            Supplier Messaging
          </button>
        </div>

        <div ref={miniGraphRef} style={{ height: "400px" }} />

        {businessToolbar && (
          <div
            className="absolute z-50 rounded shadow-lg border bg-white text-sm"
            style={{
              left: businessToolbar.x,
              top: businessToolbar.y,
              padding: "8px",
              width: "150px",
            }}
          >
            <button
              className="
                w-full text-left px-3 py-2 rounded mb-1 text-white
                transition-all duration-150
                hover:brightness-110
                active:brightness-90
                focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-green-400
              "
              style={{ backgroundColor: "#22c55e" }} // supplier green
              onClick={() => {
                setPopupColor(supplierColor);
                setPopupType("Supplier Setup");
                setBusinessToolbar(null);
              }}
            >
              Supplier Setup
            </button>

            <button
              className="
                w-full text-left px-3 py-2 rounded text-white
                transition-all duration-150
                hover:brightness-110
                active:brightness-90 active:scale-[0.98]
                focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-400
              "
              style={{ backgroundColor: "#2563eb" }} // customer blue
              onClick={() => {
                setPopupColor(customerColor);
                setPopupType("Customer Setup");
                setBusinessToolbar(null);
              }}
            >
              Customer Setup
            </button>
          </div>
        )}

        {popupType && (
          <DraggablePopup
            title={`${popupType}`}
            headerColor={popupColor ?? "#333"}
            onClose={() => setPopupType(null)}
          >
            {popupType === "Supplier Messaging" && (
              <MessagePanel
                businessId={businessId}
                suppliers={suppliers.map((s) => ({
                  ...s,
                  id: Number(s.id),
                }))}
                target="supplier"
                setSelectedRecipients={setSelectedRecipients}
                setSelectedSenders={setSelectedSenders}
              />
            )}
            {popupType === "Customer Messaging" && (
              <MessagePanel
                businessId={businessId}
                customers={customers.map((c) => ({
                  ...c,
                  id: Number(c.id),
                }))}
                target="customer"
                setSelectedRecipients={setSelectedRecipients}
                setSelectedSenders={setSelectedSenders}
              />
            )}

            {popupType === "Supplier Setup" && (
              <SupplierList
                businessId={businessId}
                suppliers={suppliers}
                setSuppliers={setSuppliers}
                listOnly={true}
              />
            )}

            {popupType === "Customer Setup" && (
              <CustomerList
                businessId={businessId}
                customers={customers}
                setCustomers={setCustomers}
                listOnly={true}
              />
            )}
          </DraggablePopup>
        )}
      </CardContent>
    </Card>
  );
}
