import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const { jobId } = req.query;
  if (!jobId || typeof jobId !== "string") {
    res.status(400).json({ error: "jobId required" });
    return;
  }
  const base = process.env.ALLOCATOR_BACKEND_URL ?? "http://allocator-backend:8000";
  try {
    const upstream = await fetch(`${base}/material-impact/status/${encodeURIComponent(jobId)}`);
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (err) {
    res.status(502).json({ error: "allocator backend unavailable" });
  }
}
