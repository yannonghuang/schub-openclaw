import React, { useEffect, useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";


// --- Types ---
export interface EventMessage {
  id: string;
  channel: string;
  payload: any;
  timestamp: string;
}

// --- Live Feed Component ---
export function LiveFeed() {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [events, setEvents] = useState<EventMessage[]>([]);
  
  useEffect(() => {
    const ws_url = `/audit/ws`;
    const ws = new WebSocket(ws_url); // adjust URL

    ws.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data);
        setEvents((prev) => [...prev.slice(-99), event]); // keep last 100
      } catch (e) {
        console.error("Bad WS message", msg.data);
      }
    };

    return () => ws.close();
  }, []);

  // auto-scroll on new events
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  return (
    <Card className="flex flex-col h-[400px]">
      <CardHeader>
        <CardTitle>Live Feed</CardTitle>
      </CardHeader>
      <CardContent className="overflow-y-auto flex-1 space-y-2">
        {events.map((e) => (
          <div
            key={e.id}
            className="p-2 rounded-md bg-gray-50 border border-gray-200"
          >
            <div className="text-xs text-gray-500">{e.timestamp}</div>
            <div className="text-sm font-semibold">{e.channel}</div>
            <pre className="text-xs">{JSON.stringify(e.payload, null, 2)}</pre>
          </div>
        ))}
        <div ref={bottomRef} />
      </CardContent>
    </Card>
  );
}
