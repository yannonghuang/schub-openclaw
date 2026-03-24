import { useEffect, useState, useRef } from "react";
import { Card, CardContent } from "../ui/card";
import { Button } from "../ui/button";
import MessagePanel from "./MessagePanel";

export default function SupplierList({ businessId, suppliers, setSuppliers, listOnly=false }) {
  const [availableSuppliers, setAvailableSuppliers] = useState<any[]>([]);
  const [materials, setMaterials] = useState<any[]>([]);
  const [newSupplierId, setNewSupplierId] = useState<string>("");
  const [selectedMaterialId, setSelectedMaterialId] = useState<string>("");
  const [showSuppliers, setShowSuppliers] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [newBusinessName, setNewBusinessName] = useState("");
  const unsubscribeFnRef = useRef<(id: number) => void>();

  const [editedBusinessName, setEditedBusinessName] = useState("");
  const [editedBusinessId, setEditedBusinessId] = useState("");

  // Load available suppliers
  useEffect(() => {
    const fetchAvailable = async () => {
      const res = await fetch(`/business/${businessId}/available-suppliers`);
      if (res.ok) {
        setAvailableSuppliers(await res.json());
      }
    };
    fetchAvailable();
  }, [businessId, suppliers]);

  // Load materials
  useEffect(() => {
    const fetchMaterials = async () => {
      const res = await fetch(`/material`);
      if (res.ok) {
        setMaterials(await res.json());
      }
    };
    fetchMaterials();
  }, []);

  // Add supplier + material relationship
  const addSupplier = async () => {
    if (!newSupplierId || !selectedMaterialId) return;

    if (newSupplierId === "create-new") {
      setShowModal(true);
      return;
    }

    await fetch(`/business/${businessId}/suppliers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: Number(newSupplierId), material_id: Number(selectedMaterialId) }),
    });
    setNewSupplierId("");
    setSelectedMaterialId("");
    const res = await fetch(`/business/${businessId}/suppliers`);
    setSuppliers(await res.json());
  };

  // Remove supplier
  const removeSupplier = async (id: number) => {
    if (!confirm("Remove this supplier?")) return;
    unsubscribeFnRef.current?.(id);
    await fetch(`/business/${businessId}/suppliers/${id}`, { method: "DELETE" });
    setSuppliers(suppliers.filter((s) => s.id !== id));
  };

  // Update Relationship
  const updateRelationship = async () => {
    await fetch(`/business/relationships/0`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ supplier_id: Number(editedBusinessId), customer_id: Number(businessId), material_id: Number(selectedMaterialId) }),      
    });
    const res = await fetch(`/business/${businessId}/suppliers`);
    setSuppliers(await res.json());

      // Cleanup
    setShowModal(false);
    setNewBusinessName("");
    setNewSupplierId("");
    setEditedBusinessName("");
    setEditedBusinessId("");
    setSelectedMaterialId("");
  };

  // Create new business + link as supplier
  const createNewBusiness = async () => {
    if (!newBusinessName.trim() || !selectedMaterialId) return;

    // Step 1: create business
    const res = await fetch(`/business/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newBusinessName }),
    });
    const newBiz = await res.json();

    // Step 2: link as supplier with material
    await fetch(`/business/${businessId}/suppliers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: newBiz.id, material_id: Number(selectedMaterialId) }),
    });

    // Refresh supplier list
    const updated = await fetch(`/business/${businessId}/suppliers`);
    setSuppliers(await updated.json());

    // Cleanup
    setShowModal(false);
    setNewBusinessName("");
    setNewSupplierId("");
    setSelectedMaterialId("");
  };

  return (
    <>
      <Card>
        <CardContent>
          {/* Header with toggle */}
          <div
            className="flex items-center cursor-pointer select-none mb-2"
            onClick={() => setShowSuppliers((s) => !s)}
          >
            <span
              className={`transform transition-transform mr-2 ${
                showSuppliers ? "rotate-90" : ""
              }`}
            >
              ▶
            </span>
            <h2 className="text-xl font-semibold">My Suppliers</h2>
          </div>

          {/* Collapsible supplier list */}
          {showSuppliers && (
            <>
              <ul className="mb-4">
                {suppliers.map((s) => (
                  <li key={s.id} className="flex justify-between items-center mb-1">
                    {s.name}{" "}
                    {s.material?.name && (
                      <span className="ml-2 text-gray-500 text-sm">
                        (Material: {s.material.name})
                      </span>
                    )}

                    <div className="space-x-2">
                      <Button
                        onClick={() => {
                          setShowModal(true); 
                          setEditedBusinessName(s.name); 
                          setEditedBusinessId(`${s.id}`);
                          setSelectedMaterialId(s.material.id)
                        }}
                        className="bg-yellow-500 text-white py-1 px-2 text-sm rounded"
                      >
                        Edit
                      </Button>
                      <Button
                        onClick={() => removeSupplier(s.id)}
                        className="bg-red-500 hover:bg-red-600 py-1 px-2 text-sm rounded"
                      >
                        Remove
                      </Button>
                    </div>

                  </li>
                ))}
              </ul>

              <div className="flex gap-2 items-center">
                <select
                  value={newSupplierId}
                  onChange={(e) => setNewSupplierId(e.target.value)}
                  className="flex-1 border rounded p-2"
                >
                  <option value="">Select supplier</option>
                  {availableSuppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                  <option value="create-new">➕ Create New Business</option>
                </select>

                <select
                  value={selectedMaterialId}
                  onChange={(e) => setSelectedMaterialId(e.target.value)}
                  className="flex-1 border rounded p-2"
                >
                  <option value="">Select material</option>
                  {materials.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>

                <Button
                  onClick={addSupplier}
                  disabled={!newSupplierId || !selectedMaterialId}
                  className="bg-blue-500 hover:bg-blue-600 py-1 px-2 text-sm rounded"
                >
                  {newSupplierId === "create-new" ? "Create & Add" : "Add"}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Modal for creating new business */}
      {showModal && (
        <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-40">
          <div className="bg-white rounded-lg shadow-lg p-6 w-96">
            <h3 className="text-lg font-semibold mb-4">{editedBusinessId ? "Edit Relationship" : "Create New Business" }</h3>
            <input
              type="text"
              value={editedBusinessId ? editedBusinessName : newBusinessName}
              onChange={(e) => setNewBusinessName(e.target.value)}
              placeholder="Business name"
              className="border rounded w-full p-2 mb-4"
            />
            <select
              value={selectedMaterialId}
              onChange={(e) => setSelectedMaterialId(e.target.value)}
              className="border rounded w-full p-2 mb-4"
            >
              <option value="">Select material</option>
              {materials.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <div className="flex justify-end gap-2">
              <Button
                onClick={() => setShowModal(false)}
                className="bg-gray-300 text-black hover:bg-gray-400"
              >
                Cancel
              </Button>
              <Button
                onClick={editedBusinessId ? updateRelationship : createNewBusiness}
                disabled={!editedBusinessId && (!newBusinessName.trim() || !selectedMaterialId)}
                className="bg-blue-500 hover:bg-blue-600"
              >
                {editedBusinessId ? "Update" : "Create & Link" }
              </Button>
            </div>
          </div>
        </div>
      )}

      {!listOnly && <MessagePanel
        businessId={businessId}
        suppliers={suppliers}
        target={"supplier"}
        onUnsubscribe={(fn) => {
          unsubscribeFnRef.current = fn;
        }}
      />}
    </>
  );
}
