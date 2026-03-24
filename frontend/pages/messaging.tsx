// pages/dashboard.tsx
import { useAuth } from "../context/AuthContext";
import { useRouter } from "next/router";
import BusinessNetwork from "../components/BusinessNetwork";
import { useEffect } from "react";

export default function Messaging() {
  const { user } = useAuth();
  const router = useRouter();

  // Redirect if not logged in
  useEffect(() => {
    if (!user) router.push("/signin");
  }, [user, router]);

  return (
    <div className="p-6">
      <BusinessNetwork />
    </div>
  );
}
