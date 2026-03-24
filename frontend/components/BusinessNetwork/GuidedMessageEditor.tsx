import { useState, useEffect } from "react";
import { Button } from "../ui/button";

type Material = { id: number; name: string };

export default function GuidedMessageEditor({
  businessId,
  target,
  neighbors,
  selectedPub,
  onMessageBuilt,
}: {
  businessId: number;
  target: string | null;
  neighbors: { id: number; name: string; type: string | null }[];
  selectedPub: Record<number, boolean>;
  onMessageBuilt: (msg: string) => void;
}) {
  const [candidateMaterials, setCandidateMaterials] = useState<Material[]>([]);
  const [selectedMaterials, setSelectedMaterials] = useState<string[]>([]);
  const [quantity, setQuantity] = useState<number>(0);
  const [delivery, setDelivery] = useState<number>(0);
  const [recipients, setRecipients] = useState<number[]>([]);

  // NEW: type + id fields
  const [msgType, setMsgType] = useState<string>("WIP");
  const [msgId, setMsgId] = useState<string>("");

  // Refresh candidate materials when recipients change
  useEffect(() => {
    if (!businessId || !target) return;

    const recipients = neighbors
      .filter((n) => selectedPub[n.id])
      .map((n) => n.id);

    setRecipients(recipients);

    if (recipients.length === 0) {
      setCandidateMaterials([]);
      return;
    }

    const fetchMaterials = async () => {
      try {
        const res = await fetch("/material/material-candidates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sender: businessId, recipients, target }),
        });
        if (!res.ok) throw new Error("Failed to fetch candidate materials");
        const data = await res.json();
        setCandidateMaterials(data.materials || []);
      } catch (err) {
        console.error(err);
        setCandidateMaterials([]);
      }
    };

    fetchMaterials();
  }, [businessId, target, selectedPub, neighbors]);

  const buildMessage = () => {
    const jsonMsg = JSON.stringify(
      {
        message_id: msgId,                     // NEW
        type: msgType,                 // NEW
        materials: selectedMaterials,
        quantity_decrease_percentage: quantity,
        delivery_delay_days: delivery,
        source: businessId,
        recipients,
        target,
      },
      null,
      2
    );

    onMessageBuilt(jsonMsg);
  };

  return (
    <div className="space-y-2 border p-2 rounded bg-gray-50 mt-2">

      {/* NEW: Type */}
      <label className="block text-sm font-medium">Message Type</label>
      <select
        value={msgType}
        onChange={(e) => setMsgType(e.target.value)}
        className="w-full border p-1 rounded"
      >
        <option value="WIP">WIP</option>
        <option value="Order">Order</option>
        <option value="Planning">Planning</option>
        <option value="Material">Material</option>
      </select>

      {/* NEW: ID */}
      <label className="block text-sm font-medium">Message ID</label>
      <input
        type="text"
        value={msgId}
        onChange={(e) => setMsgId(e.target.value)}
        className="w-full border p-1 rounded"
        placeholder="Enter ID"
      />

      <label className="block text-sm font-medium">Materials</label>
      <select
        multiple
        value={selectedMaterials}
        onChange={(e) =>
          setSelectedMaterials(
            Array.from(e.target.selectedOptions, (opt) => opt.value)
          )
        }
        className="w-full border p-1 rounded"
      >
        {candidateMaterials.map((m) => (
          <option key={m.id} value={m.name}>
            {m.name}
          </option>
        ))}
      </select>

      <label className="block text-sm font-medium">Quantity decrease percentage</label>
      <input
        type="number"
        value={quantity}
        onChange={(e) => setQuantity(Number(e.target.value))}
        className="w-full border p-1 rounded"
      />

      <label className="block text-sm font-medium">Delivery delay days</label>
      <input
        type="number"
        value={delivery}
        onChange={(e) => setDelivery(Number(e.target.value))}
        className="w-full border p-1 rounded"
      />

      <Button onClick={buildMessage} className="bg-green-500 hover:bg-green-600">
        Build JSON
      </Button>
    </div>
  );
}
