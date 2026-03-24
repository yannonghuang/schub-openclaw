import { useEffect, useState, useRef } from "react";
import { Card, CardContent } from "../ui/card";
import { Button } from "../ui/button";
import MessagePanel from "./MessagePanel";

export default function CustomerList({ businessId, customers, setCustomers, listOnly=false }) {
  const [availableCustomers, setAvailableCustomers] = useState<any[]>([]);
  const [materials, setMaterials] = useState<any[]>([]);
  const [newCustomerId, setNewCustomerId] = useState<string>("");
  const [selectedMaterialId, setSelectedMaterialId] = useState<string>("");
  const [showCustomers, setShowCustomers] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [newBusinessName, setNewBusinessName] = useState("");
  const unsubscribeFnRef = useRef<(id: number) => void>();

  const [editedBusinessName, setEditedBusinessName] = useState("");
  const [editedBusinessId, setEditedBusinessId] = useState("");

  // Load available customers
  useEffect(() => {
    const fetchAvailable = async () => {
      const res = await fetch(`/business/${businessId}/available-customers`);
      if (res.ok) {
        setAvailableCustomers(await res.json());
      }
    };
    fetchAvailable();
  }, [businessId, customers]);

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

  // Add customer + material relationship
  const addCustomer = async () => {
    if (!newCustomerId || !selectedMaterialId) return;

    if (newCustomerId === "create-new") {
      setShowModal(true);
      return;
    }

    await fetch(`/business/${businessId}/customers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: Number(newCustomerId), material_id: Number(selectedMaterialId) }),
    });
    setNewCustomerId("");
    setSelectedMaterialId("");
    const res = await fetch(`/business/${businessId}/customers`);
    setCustomers(await res.json());
  };

  // Remove customer
  const removeCustomer = async (id: number) => {
    if (!confirm("Remove this customer?")) return;
    unsubscribeFnRef.current?.(id);
    await fetch(`/business/${businessId}/customers/${id}`, { method: "DELETE" });
    setCustomers(customers.filter((s) => s.id !== id));
  };

  // Update Relationship
  const updateRelationship = async () => {
    await fetch(`/business/relationships/0`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ supplier_id: Number(businessId), customer_id: Number(editedBusinessId), material_id: Number(selectedMaterialId) }),      
    });
    const res = await fetch(`/business/${businessId}/customers`);
    setCustomers(await res.json());

      // Cleanup
    setShowModal(false);
    setNewBusinessName("");
    setNewCustomerId("");
    setEditedBusinessName("");
    setEditedBusinessId("");
    setSelectedMaterialId("");
  };

  // Create new business + link as customer
  const createNewBusiness = async () => {
    if (!newBusinessName.trim() || !selectedMaterialId) return;

    // Step 1: create business
    const res = await fetch(`/business/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newBusinessName }),
    });
    const newBiz = await res.json();

    // Step 2: link as customer with material
    await fetch(`/business/${businessId}/customers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: newBiz.id, material_id: Number(selectedMaterialId) }),
    });

    // Refresh customer list
    const updated = await fetch(`/business/${businessId}/customers`);
    setCustomers(await updated.json());

    // Cleanup
    setShowModal(false);
    setNewBusinessName("");
    setNewCustomerId("");
    setSelectedMaterialId("");
  };

  return (
    <>
      <Card>
        <CardContent>
          {/* Header with toggle */}
          <div
            className="flex items-center cursor-pointer select-none mb-2"
            onClick={() => setShowCustomers((s) => !s)}
          >
            <span
              className={`transform transition-transform mr-2 ${
                showCustomers ? "rotate-90" : ""
              }`}
            >
              ▶
            </span>
            <h2 className="text-xl font-semibold">My Customers</h2>
          </div>

          {/* Collapsible customer list */}
          {showCustomers && (
            <>
              <ul className="mb-4">
                {customers.map((c) => (
                  <li key={c.id} className="flex justify-between items-center mb-1">
                    {c.name}{" "}
                    {c.material?.name && (
                      <span className="ml-2 text-gray-500 text-sm">
                        (Material: {c.material.name})
                      </span>
                    )}

                    <div className="space-x-2">
                      <Button
                        onClick={() => {
                          setShowModal(true); 
                          setEditedBusinessName(c.name); 
                          setEditedBusinessId(`${c.id}`);
                          setSelectedMaterialId(c.material.id)
                        }}
                        className="bg-yellow-500 text-white py-1 px-2 text-sm rounded"
                      >
                        Edit
                      </Button>
                      <Button
                        onClick={() => removeCustomer(c.id)}
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
                  value={newCustomerId}
                  onChange={(e) => setNewCustomerId(e.target.value)}
                  className="flex-1 border rounded p-2"
                >
                  <option value="">Select customer</option>
                  {availableCustomers.map((s) => (
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
                  onClick={addCustomer}
                  disabled={!newCustomerId || !selectedMaterialId}
                  className="bg-blue-500 hover:bg-blue-600 py-1 px-2 text-sm rounded"
                >
                  {newCustomerId === "create-new" ? "Create & Add" : "Add"}
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
                { editedBusinessId ? "Update" : "Create & Link" }
              </Button>
            </div>
          </div>
        </div>
      )}

      {!listOnly && <MessagePanel
        businessId={businessId}
        customers={customers}
        target={"customer"}
        onUnsubscribe={(fn) => {
          unsubscribeFnRef.current = fn;
        }}
      />}
    </>
  );
}
