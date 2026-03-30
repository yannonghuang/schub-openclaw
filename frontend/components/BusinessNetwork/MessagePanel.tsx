import { useEffect, useState, useCallback, useRef } from "react";
import { Card, CardContent } from "../ui/card";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import toast from "react-hot-toast";
import { CodeSnippets } from "./CodeSnippets"
import GuidedMessageEditor from "./GuidedMessageEditor"
import useReliableWebsocket from "./useReliableWebsocket"
import { useAgentPanel } from "../../context/AgentPanelContext";
import { useNeighbors, Neighbor } from "./useNeighbors";
import ChannelSelector from "./ChannelSelector"

//-- type Neighbor = { id: number; name: string; type: "supplier" | "customer" | "system" | null };

type Message = { id: number; from: string; to: string; content: string; time: string };

const SYSTEM_NODE_ID = (process.env.SYSTEM_NODE || -1) as number;

export default function MessagePanel({
  businessId = null,
  suppliers = [],
  customers = [],
  target = null,
  onUnsubscribe = null,   // 👈 new callback prop
  setSelectedRecipients = null,   // 👈 new callback prop
  setSelectedSenders = null,   // 👈 new callback prop
}: {
  businessId?: number | null;
  suppliers?: Omit<Neighbor, "type">[];
  customers?: Omit<Neighbor, "type">[];
  target?: string | null;
  onUnsubscribe?: (fn: any) => void | null; // parent can ask to unsubscribe a neighbor
  setSelectedRecipients?: (fn: Record<number, boolean>) => void | null;
  setSelectedSenders?: (fn: Record<number, boolean>) => void | null;
}) {
  const { openPubsubThread } = useAgentPanel();

  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");

  const [triggerAgent, setTriggerAgent] = useState(true);
  const triggerAgentRef = useRef(triggerAgent);

  useEffect(() => {
    triggerAgentRef.current = triggerAgent;
  }, [triggerAgent]);
  const { subscribe, unsubscribe } = useReliableWebsocket((data) => {
    //if (data.type === "pong") return;

    setMessages((prev) => [...prev, {
      id: Date.now(),
      from: data.from,
      to: String(businessId),
      content: data.text,
      time: new Date().toLocaleTimeString(),
    }]);

    if (triggerAgentRef.current) {
      setSenders((prev) => ({ ...prev, [data.from]: true }));
      let agentMsg = data.text;
      if (businessId) {
        try {
          const parsed = JSON.parse(data.text);
          if (typeof parsed === "object" && parsed !== null && !parsed.business_id) {
            parsed.business_id = businessId;
          }
          agentMsg = JSON.stringify(parsed);
        } catch {
          // not JSON — pass through as-is
        }
      }
      openPubsubThread(agentMsg);
    }
  });

  const [showSubChannels, setShowSubChannels] = useState(false);
  const [showPubChannels, setShowPubChannels] = useState(false);
  const [senders, setSenders] = useState<Record<number, boolean>>({});

  const [showEditor, setShowEditor] = useState(false);
  const [showCode, setShowCode] = useState(false);

  const isSystemUser = !businessId;

  // Initialize neighbors with type field
  const neighbors: Neighbor[] = isSystemUser
    ? []
    : target
      ? [
        ...suppliers.map((s) => ({ ...s, type: "supplier" as const })),
        ...customers.map((c) => ({ ...c, type: "customer" as const }))
      ]
      : [
        {id: SYSTEM_NODE_ID, name: "system", type: "system"}
      ];

  const suffix = !target
    ? ""
    : target === "supplier"
    ? ":customer" + `:${businessId}`
    : ":supplier" + `:${businessId}`;

  const {
    subscribedMap,
    toggleSub,
    unsubscribeAll,

    publishMap,
    togglePub,
    clearAllPub,
  } = useNeighbors({
    neighbors,
    suffix,
    subscribe,
    unsubscribe,
    onUnsubscribe,
  });

  useEffect(() => {
    if (!setSelectedSenders) return;
    
    setSelectedSenders(senders);
  }, [senders]);

  // Publish → always to current business’s channel
  const publishMessage = async () => {
    if (!newMessage.trim()) return;

    if (businessId && !target) return;

    let payload = null;

    ////////////////////
    // system messages
    ////////////////////
    if (!businessId) {
      payload = JSON.stringify({
        sender: String(SYSTEM_NODE_ID),
        content: newMessage,
        recipients: [String(SYSTEM_NODE_ID)],
      });
    } else {
    ////////////////////
    // business messages
    ////////////////////

      // notifying parent component of the selected recipients
      if (setSelectedRecipients) setSelectedRecipients(publishMap);
      
      // build recipients list from checked neighbors
      const recipients = neighbors
        .filter((n) => publishMap[n.id])
        .map(
          (n) =>
            `${businessId}:${n.type}:${n.id}` // convention
        );

      if (recipients.length === 0) {
        toast.error("Please select at least one publish channel");
        return;
      }

      payload = JSON.stringify({
        sender: String(businessId),
        content: newMessage,
        //recipients: [String(businessId) + ":" + target],
        recipients
      });
    }

    await fetch(`/switch/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload
    });

    setNewMessage("");
  };

  return (
    <Card>
      <h2 className="text-xl font-semibold">Message Panel</h2>
      <CardContent>     
        {businessId && (
          <>
            {/* Collapsible sub channel list */}
            <div className="mb-4">
              <button
                onClick={() => setShowSubChannels(!showSubChannels)}
                className="w-full flex justify-between items-center px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded"
              >
                <span className="font-medium">Subscription Channels</span>
                <span
                  className={`transform transition-transform ${
                    showSubChannels ? "rotate-90" : ""
                  }`}
                >
                  ▶
                </span>
              </button>

              {showSubChannels && 
                <ChannelSelector
                  mode="sub"
                  neighbors={neighbors}
                  map={subscribedMap}
                  toggle={toggleSub}
                  clearAll={unsubscribeAll}
                  triggerAgent={triggerAgent}
                  setTriggerAgent={setTriggerAgent}
                />
              }
            </div>

            {/* Received Messages */}
            <h3 className="font-medium">
              Received Messages
            </h3>
            <div className="mb-4 max-h-64 overflow-y-auto border p-2 rounded">
              {messages.map((m) => (
                <div key={m.id} className="mb-2 border-b pb-1">
                  <div className="text-sm text-gray-600">
                    From {m.from} → To {m.to} ({m.time})
                  </div>
                  <div>{m.content}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Collapsible publication channels */}
        {(target) && (<div className="mb-4">
          <button
            onClick={() => setShowPubChannels(!showPubChannels)}
            className="w-full flex justify-between items-center px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded"
          >
            <span className="font-medium">Publication Channels</span>
            <span
              className={`transform transition-transform ${
                showPubChannels ? "rotate-90" : ""
              }`}
            >
              ▶
            </span>
          </button>

          {showPubChannels && 
            <ChannelSelector
              mode="pub"
              neighbors={neighbors}
              map={publishMap}
              toggle={togglePub}
              clearAll={clearAllPub}
            />
          }
        </div>)}
        {/* New message input */}
        {(isSystemUser || target) && (<>
          <h3 className="font-medium">
            Sent Messages
          </h3>  

          {!isSystemUser && <>
            {/* Header with toggle */}
            <div
              className="flex items-center cursor-pointer select-none mb-2"
              onClick={() => setShowEditor((s) => !s)}
            >
              <span
                className={`transform transition-transform mr-2 ${
                  showEditor ? "rotate-90" : ""
                }`}
              >
                ▶
              </span>
              <h2 className="text-sm font-semibold">Editor</h2>
            </div>

            {/* Collapsible editor */}
            {showEditor && (
              <GuidedMessageEditor
                businessId={businessId!}
                target={target}
                neighbors={neighbors}
                selectedPub={publishMap}
                onMessageBuilt={(msg) => setNewMessage(msg)}
              />
            )}
          </>}
          
          <div className="flex gap-2">        
            <Input
              placeholder="Type a message"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              className="flex-1"
            />
            <Button
              onClick={publishMessage}
              className="bg-green-500 hover:bg-green-600"
            >
              Publish
            </Button>
          </div>
        </>)}

        {/* Header with toggle */}
        {!isSystemUser && <>
          <div
            className="flex items-center cursor-pointer select-none mb-2"
            onClick={() => setShowCode((s) => !s)}
          >
            <span
              className={`transform transition-transform mr-2 ${
                showCode ? "rotate-90" : ""
              }`}
            >
              ▶
            </span>
            <h2 className="text-xl font-semibold">Generated Code</h2>
          </div>

          {/* Collapsible editor */}
          {showCode && <CodeSnippets
            businessId={businessId}
            neighbors={neighbors}
            selectedPub={publishMap}
            sockets={subscribedMap}
            newMessage={newMessage}
          />}
        </>}
      </CardContent>
    </Card>

  );
}
