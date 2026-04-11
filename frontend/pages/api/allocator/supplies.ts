// pages/api/allocator/supplies.ts
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).end();

  const q = (req.query.q as string) ?? "";
  const base = process.env.ALLOCATOR_BACKEND_URL ?? "http://allocator-backend:8000";

  try {
    const upstream = await fetch(`${base}/supplies?q=${encodeURIComponent(q)}`);
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch {
    res.status(502).json({ error: "allocator backend unreachable" });
  }
}
