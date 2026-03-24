import { useEffect, useMemo, useState } from "react";
import { Button } from "../ui/button";
import { Neighbor } from "./useNeighbors";

type Material = {
  id: number;
  name: string;
};

export default function ChannelSelector({
  mode, // "sub" | "pub"
  neighbors,
  map,
  toggle,
  clearAll,
  triggerAgent,
  setTriggerAgent,
}: {
  mode: "sub" | "pub";
  neighbors: Neighbor[];
  map: Record<number, boolean>;
  toggle: (n: Neighbor) => void;
  clearAll: () => void;
  triggerAgent?: boolean;
  setTriggerAgent?: (v: boolean) => void;
}) {
  /** -----------------------------
   * Material filter state
   * ----------------------------- */
  const [materialFilter, setMaterialFilter] = useState<number | "all">("all");

  /** -----------------------------
   * Collect unique materials from neighbors
   * ----------------------------- */
  const materials: Material[] = useMemo(() => {
    const seen = new Map<number, Material>();
    neighbors.forEach(n => {
      if (n.material) {
        seen.set(n.material.id, n.material);
      }
    });
    return Array.from(seen.values());
  }, [neighbors]);

  /** -----------------------------
   * Filtered neighbors
   * ----------------------------- */
  const filteredNeighbors = useMemo(() => {
    if (materialFilter === "all") return neighbors;
    return neighbors.filter(n => n.material?.id === materialFilter);
  }, [neighbors, materialFilter]);

  /** -----------------------------
   * Reset selection when filter changes
   * ----------------------------- */
  useEffect(() => {
    clearAll();
  }, [materialFilter]);

  /** -----------------------------
   * Scoped "all selected" (filtered only)
   * ----------------------------- */
  const allSelected =
    filteredNeighbors.length > 0 &&
    filteredNeighbors.every(n => map[n.id]);

  /** -----------------------------
   * Scoped bulk actions
   * ----------------------------- */
  const selectFiltered = () => {
    filteredNeighbors.forEach(n => {
      if (!map[n.id]) toggle(n);
    });
  };

  const clearFiltered = () => {
    filteredNeighbors.forEach(n => {
      if (map[n.id]) toggle(n);
    });
  };

  /** -----------------------------
   * Render
   * ----------------------------- */
  return (
    <div className="p-2 space-y-3 border rounded-b bg-white">
      {/* Material filter */}
      <div className="flex items-center gap-2">
        <label className="text-sm text-gray-600">Material:</label>
        <select
          value={materialFilter}
          onChange={e =>
            setMaterialFilter(
              e.target.value === "all"
                ? "all"
                : Number(e.target.value)
            )
          }
          className="border rounded px-2 py-1 text-sm"
        >
          <option value="all">All</option>
          {materials.map(m => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>

      {/* Select / Clear (scoped to filter) */}
      <div className="flex justify-end">
        <Button
          onClick={allSelected ? clearFiltered : selectFiltered}
          className={
            allSelected
              ? "bg-red-500 hover:bg-red-600 text-white"
              : "bg-blue-500 hover:bg-blue-600 text-white"
          }
        >
          {allSelected
            ? mode === "sub"
              ? "Unsubscribe Filtered"
              : "Deselect Filtered"
            : mode === "sub"
              ? "Subscribe Filtered"
              : "Select Filtered"}
        </Button>
      </div>

      {/* Neighbor list */}
      {filteredNeighbors.map(n => {
        const active = !!map[n.id];
        return (
          <div
            key={n.id}
            className="flex justify-between items-center"
          >
            <div className="flex items-center gap-2">
              <span
                className={`w-3 h-3 rounded-full ${
                  active ? "bg-green-500" : "bg-gray-300"
                }`}
              />
              <span className="text-sm">
                {n.name} ({n.type})
                {n.material && (
                  <span className="text-gray-400">
                    {" "}
                    · {n.material.name}
                  </span>
                )}
              </span>
            </div>

            <button
              onClick={() => toggle(n)}
              className={
                active
                  ? "bg-red-500 hover:bg-red-600 text-white px-2 py-1 rounded text-sm"
                  : "bg-blue-500 hover:bg-blue-600 text-white px-2 py-1 rounded text-sm"
              }
            >
              {active
                ? mode === "sub"
                  ? "Unsubscribe"
                  : "Remove"
                : mode === "sub"
                  ? "Subscribe"
                  : "Add"}
            </button>
          </div>
        );
      })}

      {/* Trigger agent */}
      {mode === "sub" && triggerAgent !== undefined && (
        <label className="flex items-center justify-end gap-2 text-sm text-gray-600 pt-2">
          <input
            type="checkbox"
            checked={triggerAgent}
            onChange={e => setTriggerAgent?.(e.target.checked)}
          />
          Auto-trigger agent
        </label>
      )}
    </div>
  );
}
