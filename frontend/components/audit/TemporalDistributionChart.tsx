import React, { useState, useEffect } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/card";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

interface TemporalItem {
  time: string; // UTC ISO bucket start
  count: number;
}

interface MessageItem {
  id: string;
  timestamp: string;
  sender: string;
  content: string;
}

type Granularity = "hour" | "day" | "week";

export function TemporalDistributionChart() {
  const [data, setData] = useState<TemporalItem[]>([]);
  const [granularity, setGranularity] = useState<Granularity>("week");
  const [history, setHistory] = useState<
    { granularity: Granularity; start?: string; end?: string }[]
  >([]);
  const [range, setRange] = useState<{ start?: string; end?: string }>({});
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [showMessages, setShowMessages] = useState(false);

  // --- Fetch temporal counts ---
  useEffect(() => {
    async function fetchData() {
      const params = new URLSearchParams({ granularity });
      if (range.start) params.append("start", range.start);
      if (range.end) params.append("end", range.end);

      //console.log("fetching with granularity =", granularity)
      const res = await fetch(`/audit/messages/temporal?${params}`);
      const json = await res.json();
      setData(json);
      //console.log(`fetchData = ${JSON.stringify(json)}`)
    }
    fetchData();
  }, [granularity]);
  //}, [granularity, range]);

  // --- Drill down / click handler ---
  const handlePointClick = async (entry: TemporalItem) => {
    if (!entry) return;

    const start = new Date(entry.time); // already UTC
    const end = new Date(start);

    if (granularity === "week") end.setDate(start.getDate() + 7);
    else if (granularity === "day") end.setDate(start.getDate() + 1);
    else end.setHours(start.getHours() + 1);

    if (granularity === "hour") {
      // Fetch actual messages for this hour bucket
      const params = new URLSearchParams({
        start: start.toISOString(),
        end: end.toISOString(),
      });
      const res = await fetch(`/audit/messages/by_time?${params}`);
      const json = await res.json();
      console.log(`Fetched ${json.length} messages for ${start.toISOString()}`);
      setMessages(json);
      setShowMessages(true);
      return;
    }

    // Otherwise drill down one level
    const next =
      granularity === "week" ? "day" : granularity === "day" ? "hour" : "hour";

    setHistory((h) => [...h, { granularity, ...range }]);
    console.log(`before setGranularity(next) = ${next}`)
    setGranularity(next);
    console.log(`after setGranularity(next) = ${next}`)
    try {
      setRange({
        start: start.toISOString(),
        end: end.toISOString(),
      });
    } catch {} 
  };

  const handleBack = () => {
    const prev = history.pop();
    if (prev) {
      setHistory([...history]);
      setGranularity(prev.granularity);
      setRange({ start: prev.start, end: prev.end });
    }
  };

  const labelFormatter = (t: string) => {
    if (granularity === "week") return t; // backend gives "2025-W41"

    const d = new Date(t); // safe now: t = "2025-10-10T00:00:00Z"
    //console.log(`granularity = ${granularity}, labelFormatter(t) = ${t}`)
    //console.log(`d.toString(t) = ${d.toString()}`)
    try {
      if (granularity === "hour") return d.toISOString().slice(11, 16); // HH:mm    
      if (granularity === "day") return d.toISOString().slice(5, 10);   // MM-DD
    } catch {}
    return t;
  };


  return (
    <>
      <Card className="h-[420px]">
        <CardHeader className="flex justify-between items-center">
          <CardTitle>Messages Over Time ({granularity})</CardTitle>
          {history.length > 0 && (
            <Button variant="secondary" size="sm" onClick={handleBack}>
              ← Back
            </Button>
          )}
        </CardHeader>

        <CardContent className="h-full">
          <ResponsiveContainer width="100%" height="90%">
            <LineChart
              data={data}
              onClick={(e) =>
                e && e.activePayload?.[0]?.payload && handlePointClick(e.activePayload[0].payload)
              }
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" tickFormatter={labelFormatter} />
              <YAxis />
              <Tooltip
                labelFormatter={(t) => {const d = new Date(t); return isNaN(d.getTime()) ? "" : d.toLocaleString()}}
                formatter={(value) => [`${value} messages`, "Count"]}
              />
              <Line type="monotone" dataKey="count" stroke="#8884d8" dot />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Message list modal */}
      <Dialog open={showMessages} onOpenChange={setShowMessages}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Messages for selected hour</DialogTitle>
          </DialogHeader>
          {messages.length === 0 ? (
            <p className="text-gray-500">No messages in this hour.</p>
          ) : (
            <ul className="divide-y divide-gray-200 text-sm">
              {messages.map((m) => (
                <li key={m.id} className="py-2">
                  <div className="font-semibold">{m.sender}</div>
                  <div className="text-gray-600">
                    {new Date(m.timestamp).toLocaleString()}
                  </div>
                  <div>{m.content}</div>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
