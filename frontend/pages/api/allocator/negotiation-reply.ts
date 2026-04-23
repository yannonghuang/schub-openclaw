// pages/api/allocator/negotiation-reply.ts
// Server-side proxy to the allocator backend's negotiation dispatch endpoint.
// Body: { caseId, sessionKey, action, round?, delayDays?, qtyPct?,
//         baselinePlanRunId?, contingentPlanRunId?, supplyId? }
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const { caseId, ...rest } = req.body ?? {};
  if (typeof caseId !== "number" && typeof caseId !== "string") {
    return res.status(400).json({ error: "caseId is required" });
  }

  const base = process.env.ALLOCATOR_BACKEND_URL ?? "http://allocator-backend:8000";

  try {
    const upstream = await fetch(`${base}/cases/${caseId}/negotiation-reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rest),
    });
    const text = await upstream.text();
    res.status(upstream.status);
    try {
      res.json(JSON.parse(text));
    } catch {
      res.send(text);
    }
  } catch {
    res.status(502).json({ error: "allocator backend unreachable" });
  }
}
