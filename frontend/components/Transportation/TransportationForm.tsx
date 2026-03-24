"use client";

import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { createTransportation, updateTransportation, getLocations, getMaterials } from "./api";

export default function TransportationForm({
  item,
  onClose,
  onSaved,
}: {
  item: any | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  //const isEdit = !!item; // <-- true if editing
  //const isEdit = !!(item && item.id);
  const isEdit = !!(item && item.material);

  /*
  const [form, setForm] = useState(
    item || {
      source_location_id: "",
      target_location_id: "",
      material_id: "",
      mode: "",
      duration: "",
      price: "",
    }
  );
  */
  const [form, setForm] = useState(
    {
      source_location_id: item.source_location ? item.source_location.id : "",
      target_location_id: item.target_location ? item.target_location.id : "",
      material_id: item.material ? item.material.id : "",
      mode: item.mode ? item.mode : "",
      duration: item.duration ? item.duration : "",
      price: item.price ? item.price : "",
    }
  );

  const [locations, setLocations] = useState<any[]>([]);
  const [materials, setMaterials] = useState<any[]>([]);

  useEffect(() => {
    if (!isEdit) {
      // Only load dropdowns in create mode
      Promise.all([getLocations(), getMaterials()]).then(([locs, mats]) => {
        setLocations(locs);
        setMaterials(mats);
      });
    }
  }, [isEdit]);

  const handleSave = async () => {
    console.log(`form = ${JSON.stringify(form)}`)

    if (isEdit) await updateTransportation(form);
    else await createTransportation(form);
    onSaved();
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-30 flex justify-center items-center z-50">
      <div className="bg-white p-6 rounded-lg shadow-md w-96 space-y-3">
        <h2 className="text-lg font-semibold">
          {isEdit ? "Edit Transportation" : "New Transportation"}
        </h2>

        {/* Source Location */}
        {isEdit ? (
          <Input
            readOnly
            value={item?.source_location?.name || ""}
            placeholder="Source Location"
          />
        ) : (
          <select
            className="w-full border border-gray-300 rounded p-2 text-sm"
            value={form.source_location_id}
            onChange={(e) =>
              setForm({ ...form, source_location_id: e.target.value })
            }
          >
            <option value="">Select Source Location</option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </select>
        )}

        {/* Target Location */}
        {isEdit ? (
          <Input
            readOnly
            value={item?.target_location?.name || ""}
            placeholder="Target Location"
          />
        ) : (
          <select
            className="w-full border border-gray-300 rounded p-2 text-sm"
            value={form.target_location_id}
            onChange={(e) =>
              setForm({ ...form, target_location_id: e.target.value })
            }
          >
            <option value="">Select Target Location</option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </select>
        )}

        {/* Material */}
        {isEdit ? (
          <Input
            readOnly
            value={item?.material?.name || ""}
            placeholder="Material"
          />
        ) : (
          <select
            className="w-full border border-gray-300 rounded p-2 text-sm"
            value={form.material_id}
            onChange={(e) =>
              setForm({ ...form, material_id: e.target.value })
            }
          >
            <option value="">Select Material</option>
            {materials.map((mat) => (
              <option key={mat.id} value={mat.id}>
                {mat.name}
              </option>
            ))}
          </select>
        )}

        {/* Editable Fields (common to both modes) */}
        <Input
          placeholder="Mode"
          value={form.mode}
          onChange={(e) => setForm({ ...form, mode: e.target.value })}
        />
        <Input
          placeholder="Duration"
          value={form.duration}
          onChange={(e) => setForm({ ...form, duration: e.target.value })}
        />
        <Input
          placeholder="Price"
          value={form.price}
          onChange={(e) => setForm({ ...form, price: e.target.value })}
        />

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save</Button>
        </div>
      </div>
    </div>
  );
}
