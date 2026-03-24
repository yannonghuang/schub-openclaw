import { useEffect, useRef, useCallback } from "react";
import toast from "react-hot-toast";


type SocketEntry = {
  ws: WebSocket;
  heartbeat?: number;
  reconnect?: number;
  intentionallyClosed: boolean;
};

const HEARTBEAT_INTERVAL = 20_000;
const RECONNECT_DELAY = 3_000;

export default function useReliableWebsocket(onmessage: (data: any) => void) {
  const socketsRef = useRef<Record<string, SocketEntry>>({});

  const subscribe = useCallback((channel: string) => {
    if (socketsRef.current[channel]) return;

    const entry: SocketEntry = {
      ws: null as any,
      intentionallyClosed: false,
    };

    const connect = () => {
      const ws = new WebSocket(`/switch/ws/${channel}`);
      entry.ws = ws;

      //ws.onmessage = (e) => onmessage(JSON.parse(e.data));

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === "pong") return;
        onmessage(data);
      };

      ws.onopen = () => {
        entry.heartbeat = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping" }));
          }
        }, 20_000);
      };

      ws.onclose = () => {
        clearInterval(entry.heartbeat);
        if (!entry.intentionallyClosed) {
          entry.reconnect = window.setTimeout(connect, 3_000);
        }
      };
    };

    socketsRef.current[channel] = entry;
    connect();
  }, [onmessage]);

  const unsubscribe = useCallback((channel: string) => {
    const entry = socketsRef.current[channel];
    if (!entry) return;

    entry.intentionallyClosed = true;
    clearInterval(entry.heartbeat);
    clearTimeout(entry.reconnect);

    // ✅ only close if OPEN
    if (entry.ws?.readyState === WebSocket.OPEN) {
      entry.ws.close(1000, "intentional");
    }
    //entry.ws?.close(1000, "intentional");
    
    delete socketsRef.current[channel];
  }, []);

  useEffect(() => {
    return () => {
      Object.keys(socketsRef.current).forEach(unsubscribe);
    };
  }, [unsubscribe]);

  return { subscribe, unsubscribe };
}
