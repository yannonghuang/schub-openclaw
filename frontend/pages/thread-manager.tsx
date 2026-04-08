"use client";

import { useEffect, useState } from "react";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { useAuth } from "../context/AuthContext";
import { useRouter } from "next/router";
import { serverSideTranslations } from "next-i18next/pages/serverSideTranslations";

export async function getStaticProps({ locale }: { locale: string }) {
  return { props: { ...(await serverSideTranslations(locale, ["common", "agent"])) } };
}

export default function ThreadManager() {
  const [threads, setThreads] = useState([]);
  
  const { user } = useAuth();
  const router = useRouter();

  // Redirect if not logged in
  useEffect(() => {
    if (!user) router.push("/signin");
  }, [user, router]);

  const businessId = user?.business?.id;

  async function load() {
    const resp = await fetch(`/thread/${businessId}`);
    const data = await resp.json();
    setThreads(data);
  }

  async function deleteOne(id: number) {
    await fetch(`/thread/${id}`, { method: "DELETE" });
    load();
  }

  async function deleteAll() {
    if (!confirm("Delete ALL threads?")) return;
    await fetch(`/thread//business/${businessId}`, { method: "DELETE" });
    load();
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <Card className="p-4 space-y-4">
      <CardHeader>
        <CardTitle>Thread Manager</CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex justify-between">
          <Button variant="destructive" onClick={deleteAll}>
            Delete All Threads
          </Button>
          <Button onClick={load}>Refresh</Button>
        </div>

        <div className="space-y-2">
          {threads.map((t) => (
            <div
              key={t.id}
              className="p-3 border rounded bg-white flex justify-between items-center"
            >
              <div>
                <div className="font-semibold">
                  {t.external_thread_id || "(no external id)"}
                </div>
                <div className="text-sm text-gray-600">
                  LG UUID: {t.langgraph_thread_id}
                </div>
                <div className="text-xs text-gray-500">
                  Messages: {t.message_count}
                </div>
              </div>

              <Button
                variant="destructive"
                onClick={() => deleteOne(t.id)}
              >
                Delete
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
