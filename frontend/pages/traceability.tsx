// src/pages/EventsDashboard.tsx
import React, { useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { useRouter } from "next/router";
import { LiveFeed } from "../components/audit/LiveFeed"
import { ChannelDistributionChart } from "../components/audit/ChannelDistributionChart"
import { TemporalDistributionChart } from "../components/audit/TemporalDistributionChart";
import { AuditSearchPage } from "../components/audit/Search";
import { serverSideTranslations } from "next-i18next/pages/serverSideTranslations";

export async function getStaticProps({ locale }: { locale: string }) {
  return { props: { ...(await serverSideTranslations(locale, ["common", "agent", "audit"])) } };
}

// --- Page ---
export default function EventsDashboard() {
  const { user } = useAuth();
  const router = useRouter();

  // Redirect if not logged in
  useEffect(() => {
    if (!user) router.push("/signin");
  }, [user, router]);

  /*
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
      <ChannelDistributionChart />
      <TemporalDistributionChart/>
      <LiveFeed />
      <AuditSearchPage />
    </div>
  */
  return (

    <AuditSearchPage />

  );
}
