import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { PieChart, Pie, Tooltip, Cell, ResponsiveContainer } from "recharts";


interface DistributionItem {
  channel: string;
  count: number;
}

export function ChannelDistributionChart() {
  const [data, setData] = useState<DistributionItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchDistribution() {
      try {
        const res = await fetch("/audit/messages/distribution");
        if (!res.ok) throw new Error("Failed to fetch distribution");
        const json = await res.json();
        setData(json);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchDistribution();

    // 🔄 refresh every 10s
    const interval = setInterval(fetchDistribution, 10000);
    return () => clearInterval(interval);
  }, []);

  const COLORS = ["#8884d8", "#82ca9d", "#ffc658", "#ff8042", "#00c49f"];

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <Card className="h-[400px]">
      <CardHeader>
        <CardTitle>Events by Channel</CardTitle>
      </CardHeader>
      <CardContent className="flex justify-center items-center h-full">
        <ResponsiveContainer width="100%" height="90%">
          <PieChart>
            <Pie
              data={data}
              dataKey="count"
              nameKey="channel"
              cx="50%"
              cy="50%"
              outerRadius={120}
              label
            >
              {data.map((_, i) => (
                <Cell key={`cell-${i}`} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
