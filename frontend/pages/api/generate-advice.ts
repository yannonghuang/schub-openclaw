// pages/api/generate-advice.ts

/** 
import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end("Method not allowed");

  try {
    const { room_id, user_session_id } = req.body;
    const OPENAI_SERVICE_URL = process.env.OPENAI_SERVICE_URL || "http://localhost:4020";

    console.log("============== ready to call openai service =================");

    await axios.post(`${OPENAI_SERVICE_URL}/generate-advice`, {
      room_id,
      user_session_id,
    });

    res.status(200).json({ status: "ok" });
  } catch (error) {
    console.error("Advice API error", error);
    res.status(500).json({ error: "Failed to trigger advice generation" });
  }
}


*/

// pages/api/generate-advice.ts
import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { room_id, user_session_id } = req.body;

  if (!room_id || !user_session_id) {
    return res.status(400).json({ error: "Missing room_id or user_session_id" });
  }

  const OPENAI_SERVICE_URL = process.env.OPENAI_SERVICE_URL || "http://localhost:4020";

  try {
    const response = await axios.post(OPENAI_SERVICE_URL + "/generate-advice", {
      room_id,
      user_session_id,
    });

    return res.status(200).json(response.data);
  } catch (err: any) {
    console.error("Error forwarding to openai-service:", err?.message || err);
    return res.status(500).json({ error: "Failed to trigger advice generation" });
  }
}
