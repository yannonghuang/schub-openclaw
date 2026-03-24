"use client";

import { useState } from "react";
import { Button } from "../ui/button";
import TransportationTable from "./TransportationTable";
import TransportationForm from "./TransportationForm";

export default function TransportationsPage() {
  const [editing, setEditing] = useState<any | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="p-6">
      <div className="flex justify-between mb-4">
        <h1 className="text-xl font-bold">Transportation Management</h1>
        <Button onClick={() => setEditing({})}>+ New</Button>
      </div>

      <TransportationTable key={refreshKey} onEdit={(t) => setEditing(t)} />

      {editing !== null && (
        <TransportationForm
          item={editing} // ✅ pass directly
          onClose={() => setEditing(null)}
          onSaved={() => setRefreshKey(refreshKey + 1)}
        />
      )}
    </div>
  );
}
