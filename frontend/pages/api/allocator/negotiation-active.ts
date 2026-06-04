// pages/api/allocator/negotiation-active.ts
// Server-side proxy to the allocator backend's open negotiation-wait.
// Returns the most recent unresolved wait (structured, all card fields) or null.
// The copilot polls this so the negotiation card is driven by authoritative DB
// state — independent of whether/how the material agent narrated the trace.
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).end();

  const base = process.env.ALLOCATOR_BACKEND_URL ?? "http://allocator-backend:8000";

  try {
    const upstream = await fetch(`${base}/negotiation-waits/latest-unresolved`);
    const text = await upstream.text();
    res.status(upstream.status);
    try {
      res.json(JSON.parse(text)); // a wait object, or null
    } catch {
      res.send(text);
    }
  } catch {
    res.status(502).json({ error: "allocator backend unreachable" });
  }
}
