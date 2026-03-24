import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { Button } from "../ui/button";
import { useState } from "react";
import { useAuth } from "../../context/AuthContext";

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative">
      <pre className="bg-gray-900 text-green-200 p-3 rounded text-sm overflow-x-auto">
        {code}
      </pre>
      <Button
        onClick={copyToClipboard}
        className="absolute top-2 right-2"
      >
        {copied ? "Copied!" : "Copy"}
      </Button>
    </div>
  );
}
export function CodeSnippets({
  businessId,
  neighbors,
  selectedPub,
  sockets,
  newMessage,
}: {
  businessId: number | null;
  neighbors: { id: number; name: string; type: string | null }[];
  selectedPub: Record<number, boolean>;
  sockets: Record<number, any>;
  newMessage: string;
}) {
  const { frontendUrl } = useAuth();    
  if (!businessId) return null;

  // Build all subscription URLs
  const subUrls = neighbors
    .filter((n) => sockets[n.id])
    .map(
      (n) =>
        `${frontendUrl}/switch/ws/${n.id}:${
          n.type === "supplier" ? "customer" : "supplier"
        }:${businessId}`
    );

  const recipients = neighbors
    .filter((n) => selectedPub[n.id])
    .map((n) => `${businessId}:${n.type}:${n.id}`);

  const content = newMessage || "Hello World";

  // --- Snippets with multiple subscriptions ---
  const curlSnippet = `# Subscribe (WebSocket client needed, not curl)
# Example: websocat or wscat
${subUrls.map((url) => `wscat -c ${url}`).join("\n")}

# Publish
curl -X POST ${frontendUrl}/switch/publish \\
  -H "Content-Type: application/json" \\
  -d '{
    "sender": "${businessId}",
    "content": "${content}",
    "recipients": ${JSON.stringify(recipients)}
  }'`;

  const pythonSnippet = `import websocket, json, requests, threading

def make_sub(url):
    def on_message(ws, message):
        data = json.loads(message)
        print(f"[{url}] Received:", data)

    ws = websocket.WebSocketApp(url, on_message=on_message)
    ws.run_forever()

# --- Subscribe to all channels ---
${subUrls
  .map(
    (url, i) =>
      `t${i} = threading.Thread(target=make_sub, args=("${url}",))\nt${i}.start()`
  )
  .join("\n")}

# --- Publish ---
resp = requests.post(
    "${frontendUrl}/switch/publish",
    json={
        "sender": "${businessId}",
        "content": "${content}",
        "recipients": ${JSON.stringify(recipients)}
    }
)
print(resp.status_code, resp.text)`;

  const nodeSnippet = `import WebSocket from "ws";
import fetch from "node-fetch";

// --- Subscribe to all channels ---
${subUrls
  .map(
    (url, i) => `const ws${i} = new WebSocket("${url}");
ws${i}.on("open", () => console.log("Connected to ${url}"));
ws${i}.on("message", (msg) => console.log("[${url}] Received:", msg.toString()));`
  )
  .join("\n\n")}

// --- Publish ---
(async () => {
  const resp = await fetch("${frontendUrl}/switch/publish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sender: "${businessId}",
      content: "${content}",
      recipients: ${JSON.stringify(recipients)}
    }),
  });
  console.log(await resp.text());
})();`;

  return (
    <div className="mt-6">
      <Tabs defaultValue="curl" className="mt-2">
        <TabsList>
          <TabsTrigger value="curl">cURL</TabsTrigger>
          <TabsTrigger value="python">Python</TabsTrigger>
          <TabsTrigger value="node">Node.js</TabsTrigger>
        </TabsList>

        <TabsContent value="curl">
          <CodeBlock code={curlSnippet} />
        </TabsContent>

        <TabsContent value="python">
          <CodeBlock code={pythonSnippet} />
        </TabsContent>

        <TabsContent value="node">
          <CodeBlock code={nodeSnippet} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

