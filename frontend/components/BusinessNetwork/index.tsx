import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/router";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../ui/tabs";
import { useAuth } from "../../context/AuthContext";
import MessagePanel from "./MessagePanel";
import SupplierList from "./SupplierList";
import CustomerList from "./CustomerList";

import MiniGraph from "./MiniGraph"
import SystemGraph from "./SystemGraph"

type Material = { 
  id: number; 
  name: string;
  description: string;
  hs_code: string;
  buyer_code: string;
  supplier_code: string
};

type Location = { 
  id: number; 
  name: string;
  description: string;
};

type Transportation = { 
  mode: string; 
  duration: number;
  price: number;
};

type Business = { id: number; name: string, material: Material, location: Location; transportation?: Transportation };
type BusinessLink = { supplier: Business; customer: Business; material: Material; transportation: Transportation };

export default function BusinessNetwork() {
  const [suppliers, setSuppliers] = useState<Business[]>([]);
  const [customers, setCustomers] = useState<Business[]>([]);
  const [relationships, setRelationships] = useState<BusinessLink[]>([]);

  const [activeTab, setActiveTab] = useState("network"); // track tab

  const { user, isSystem } = useAuth();
  const businessId = user?.business?.id;
  const isSystemUser = isSystem();
  const router = useRouter();

  // Redirect if not logged in
  useEffect(() => {
    if (!user) router.push("/signin");
  }, [user, router]);

  // Fetch suppliers/customers
  useEffect(() => {
    if (!isSystemUser) {
      if (businessId) {
        fetch(`/business/${businessId}/suppliers`).then(r => r.json()).then(setSuppliers);
        fetch(`/business/${businessId}/customers`).then(r => r.json()).then(setCustomers);
      }
    } else {
      fetch(`/business/relationships/0`).then(r => r.json()).then(setRelationships);
    }
  }, [isSystemUser]);

  if (!user) return null;

  return (
    <Tabs defaultValue="network" onValueChange={setActiveTab} className="w-full">
      <TabsList className="mb-4">
        <TabsTrigger value="network">Network</TabsTrigger>
        {!isSystemUser && (<TabsTrigger value="suppliers">Suppliers</TabsTrigger>)}
        {!isSystemUser && (<TabsTrigger value="customers">Customers</TabsTrigger>)}
        <TabsTrigger value="messages">System Messages</TabsTrigger>
      </TabsList>

      {/* Network tab */}
      <TabsContent value="network">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {isSystemUser ? (
            <SystemGraph activeTab={activeTab} relationships={relationships} />
          ) : (
            <MiniGraph activeTab={activeTab} suppliers={suppliers} customers={customers} businessId={businessId} setSuppliers={setSuppliers} setCustomers={setCustomers} />
          )}
        </div>
      </TabsContent>

      {!isSystemUser && (<TabsContent value="suppliers">
        <SupplierList businessId={businessId} suppliers={suppliers} setSuppliers={setSuppliers} />
      </TabsContent>)}
      {!isSystemUser && (<TabsContent value="customers">
        <CustomerList businessId={businessId} customers={customers} setCustomers={setCustomers} />
      </TabsContent>)}
      {/* Messages tab */}
      <TabsContent value="messages">
        <MessagePanel businessId={!isSystemUser?Number(businessId):null} suppliers={suppliers} customers={customers} />
      </TabsContent>
    </Tabs>
  );
}
