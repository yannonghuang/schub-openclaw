// pages/dashboard.tsx
import { useAuth } from "../context/AuthContext";
import { useRouter } from "next/router";
import Transportation from "../components/Transportation";
import { useEffect } from "react";
import { serverSideTranslations } from "next-i18next/pages/serverSideTranslations";

export async function getStaticProps({ locale }: { locale: string }) {
  return { props: { ...(await serverSideTranslations(locale, ["common", "agent"])) } };
}

export default function Dashboard() {
  const { user } = useAuth();
  const router = useRouter();

  // Redirect if not logged in
  useEffect(() => {
    if (!user) router.push("/signin");
  }, [user, router]);

  return (
    <div className="p-6">
      <Transportation />
    </div>
  );
}
