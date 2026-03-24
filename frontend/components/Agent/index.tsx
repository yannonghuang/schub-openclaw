import { useState, useEffect } from "react";
import axios from "axios";
import { useAuth } from "../../context/AuthContext";
import { useRouter } from "next/router";
import toast from "react-hot-toast";

import OrgGraph from "./OrgGraph";
import MCPExplorer from "./MCPExplorer";


export default function Agent() {
  const { user } = useAuth();
  const router = useRouter();

  const businessId = user?.business?.id;

  // ------------ BUSINESS STATE ------------
  const [business, setBusiness] = useState<any>([]);
  const [servers, setServers] = useState<any[]>([]);
  const [tools, setTools] = useState<any[]>([]);
  const [editingServer, setEditingServer] = useState<any | null>(null);
  const [editingTool, setEditingTool] = useState<any | null>(null);
  const [creatingServer, setCreatingServer] = useState(false);
  const [creatingTool, setCreatingTool] = useState(false);

  // ------------ SUB-AGENT STATE ------------
  const [subAgents, setSubAgents] = useState<any[]>([]);
  const [selectedSubAgent, setSelectedSubAgent] = useState<any | null>(null);

  const [subServers, setSubServers] = useState<any[]>([]);
  const [subTools, setSubTools] = useState<any[]>([]);
  const [editingSubServer, setEditingSubServer] = useState<any | null>(null);
  const [editingSubTool, setEditingSubTool] = useState<any | null>(null);
  const [creatingSubServer, setCreatingSubServer] = useState(false);
  const [creatingSubTool, setCreatingSubTool] = useState(false);

  const [editingSubAgent, setEditingSubAgent] = useState<any | null>(null);
  const [creatingSubAgent, setCreatingSubAgent] = useState(false);

  const TOOLS = ["email", "broadcast", "unicast"];

  const selectedId = selectedSubAgent?.id ?? business?.id ?? null;
  const [editingBusiness, setEditingBusiness] = useState(true);

  // ------------ INFRA PROMPT STATE ------------
  const [infraPrompt, setInfraPrompt] = useState<string>("");

  // ------------ REDIRECT IF NOT LOGGED IN ------------
  useEffect(() => {
    if (!user) router.push("/signin");
  }, [user, router]);

  // ------------ LOAD BUSINESS + MAIN AGENT MCP + TOOLS ------------
  useEffect(() => {
    if (businessId) {
      axios.get(`/business/${businessId}`).then(res =>
        setBusiness({
          id: res.data.id,
          name: res.data.name,
          agent_prompt: res.data.agent_prompt,
        })
      );

      axios.get(`/system/prompt/email_protocol`).then(res =>
        setInfraPrompt(res.data.content)
      ).catch(() => {});

      axios.get(`/mcp/${businessId}/registry`).then(res => setServers(res.data));
      axios.get(`/tool/${businessId}`).then(res => setTools(res.data));

      axios
        .get(`/subagent/business/${businessId}`)
        .then(res => setSubAgents(res.data));
    }
  }, [businessId]);

  // ------------ LOAD SELECTED SUB-AGENT DETAILS ------------
  const loadSubAgentDetails = async sa => {
    setSelectedSubAgent(sa);

    const [regs, tls] = await Promise.all([
      axios.get(`/subagent/${sa.id}/mcp_registry`),
      axios.get(`/subagent/${sa.id}/tools`),
    ]);

    setSubServers(regs.data);
    setSubTools(tls.data);
  };

  // =====================================================================================
  // BUSINESS EDITORS
  // =====================================================================================

  const saveBusiness = async (businessId: number, updates: any) => {
    try {
      const res = await axios.put(`/business/${businessId}`, updates);
      setBusiness(res.data);
      toast.success("Business updated!");
    } catch (error) {
      toast.error("Update failed");
      console.error(error);
    }
  };

  const saveInfraPrompt = async (content: string) => {
    try {
      const res = await axios.put(`/system/prompt/email_protocol`, { content });
      setInfraPrompt(res.data.content);
      toast.success("Infrastructure prompt updated!");
    } catch (error) {
      toast.error("Update failed");
      console.error(error);
    }
  };

  const PromptPanel = ({ label, sublabel, value, onChange, onSave, accent }) => {
    const colors = {
      green:  { border: "border-green-500", badge: "bg-green-100 text-green-800", btn: "bg-green-600 hover:bg-green-700" },
      orange: { border: "border-orange-400", badge: "bg-orange-100 text-orange-800", btn: "bg-orange-500 hover:bg-orange-600" },
    };
    const c = colors[accent] ?? colors.green;
    return (
      <div className={`flex flex-col border-2 ${c.border} rounded-lg p-4 space-y-2`}>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${c.badge}`}>{label}</span>
        </div>
        {sublabel && <p className="text-xs text-gray-400">{sublabel}</p>}
        <textarea
          value={value ?? ""}
          rows={16}
          onChange={e => onChange(e.target.value)}
          className="border border-gray-200 p-2 rounded w-full font-mono text-sm resize-y flex-1"
        />
        <button
          onClick={onSave}
          className={`${c.btn} text-white text-sm px-4 py-1.5 rounded self-start`}
        >
          Save
        </button>
      </div>
    );
  };

  const PromptsEditor = ({ businessPrompt, onSaveBusiness, infraPromptValue, onSaveInfra }) => {
    const [biz, setBiz] = useState(businessPrompt ?? "");
    const [infra, setInfra] = useState(infraPromptValue ?? "");
    return (
      <div className="grid grid-cols-2 gap-4 mb-8">
        <PromptPanel
          label="Business Prompt"
          sublabel="Agent-specific instructions and workflow logic."
          value={biz}
          onChange={setBiz}
          onSave={() => onSaveBusiness(biz)}
          accent="green"
        />
        <PromptPanel
          label="Infrastructure Prompt"
          sublabel="Tool discipline, email protocol, and routing rules. Shared across all agents."
          value={infra}
          onChange={setInfra}
          onSave={() => onSaveInfra(infra)}
          accent="orange"
        />
      </div>
    );
  };

  // =====================================================================================
  // SUB-AGENT CRUD
  // =====================================================================================

  const createSubAgent = async updates => {
    try {
      await axios.post(`/subagent/business/${businessId}`, updates);
      const res = await axios.get(`/subagent/business/${businessId}`);
      setSubAgents(res.data);
      setCreatingSubAgent(false);
      toast.success("Sub-agent created!");
    } catch {
      toast.error("Create failed");
    }
  };

  const saveSubAgent = async (id, updates) => {
    try {
      const res = await axios.put(`/subagent/${id}`, updates);
      setSubAgents(subAgents.map(s => (s.id === id ? res.data : s)));
      setEditingSubAgent(null);
      toast.success("Sub-agent updated!");
    } catch {
      toast.error("Update failed");
    }
  };

  const deleteSubAgent = async id => {
    try {
      await axios.delete(`/subagent/${id}`);
      setSubAgents(subAgents.filter(s => s.id !== id));
      if (selectedSubAgent?.id === id) setSelectedSubAgent(null);
      toast.success("Sub-agent deleted");
    } catch {
      toast.error("Delete failed");
    }
  };

  const SubAgentEditor = ({ sa, onSave, onCancel }) => {
    const [form, setForm] = useState(sa);

    return (
      <div className="space-y-2 border p-3 rounded bg-gray-50">
        <label>Name</label>
        <input
          type="text"
          value={form.name}
          onChange={e => setForm({ ...form, name: e.target.value })}
          className="border p-1 rounded w-full"
        />

        <label>Description</label>
        <input
          type="text"
          value={form.description ?? ""}
          onChange={e => setForm({ ...form, description: e.target.value })}
          className="border p-1 rounded w-full"
        />

        <label>Prompt</label>
        <textarea
          value={form.prompt ?? ""}
          rows={4}
          onChange={e => setForm({ ...form, prompt: e.target.value })}
          className="border p-1 rounded w-full"
        />

        <div className="space-x-2">
          <button onClick={() => onSave(form)} className="bg-green-600 text-white px-3 py-1 rounded">Save</button>
          <button onClick={onCancel} className="bg-gray-600 text-white px-3 py-1 rounded">Cancel</button>
        </div>
      </div>
    );
  };

  // =====================================================================================
  // SERVER & TOOL EDITORS (REUSED FOR BOTH BUSINESS + SUBAGENTS)
  // =====================================================================================

  const isValidUrl = (value: string) => {
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  };

  const ServerEditor = ({ server, onSave, onCancel }) => {
    const [form, setForm] = useState(server);
    const [errors, setErrors] = useState({ url: "" });

    const validate = () => {
      const errs: any = {};
      if (!form.url || !isValidUrl(form.url)) errs.url = "Invalid URL";
      setErrors(errs);
      return Object.keys(errs).length === 0;
    };

    const handleSave = () => {
      if (validate()) onSave(form);
    };

    return (
      <div className="space-y-2 border p-3 rounded bg-gray-50">
        <label>URL</label>
        <input
          type="text"
          value={form.url}
          onChange={e => setForm({ ...form, url: e.target.value })}
          className="border p-1 rounded w-full"
        />
        {errors.url && <p className="text-red-500">{errors.url}</p>}

        {/* MCP Explorer — inline tool browser */}
        <MCPExplorer
          url={form.url}
          onPromptSuggested={text => setForm(f => ({ ...f, prompt: text }))}
        />

        <label>Name</label>
        <input
          type="text"
          value={form.name ?? ""}
          onChange={e => setForm({ ...form, name: e.target.value })}
          className="border p-1 rounded w-full"
        />

        <label>Description</label>
        <input
          type="text"
          value={form.description ?? ""}
          onChange={e => setForm({ ...form, description: e.target.value })}
          className="border p-1 rounded w-full"
        />

        <label>Prompt</label>
        <textarea
          value={form.prompt ?? ""}
          onChange={e => setForm({ ...form, prompt: e.target.value })}
          className="border p-1 rounded w-full"
          rows={3}
        />

        <button onClick={handleSave} className="bg-green-600 text-white px-3 py-1 rounded">Save</button>
        <button onClick={onCancel} className="bg-gray-600 text-white px-3 py-1 rounded">Cancel</button>
      </div>
    );
  };

  const ToolEditor = ({ tool, onSave, onCancel }) => {
    const [form, setForm] = useState(tool);

    return (
      <div className="space-y-2 border p-3 rounded bg-gray-50">
        <label>Name</label>
        <select
          value={form.name ?? ""}
          onChange={e => setForm({ ...form, name: e.target.value })}
          className="border p-1 rounded w-full"
          disabled={!!tool.id}
        >
          <option value="">-- select tool --</option>
          {TOOLS.map(t => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        <label>Description</label>
        <input
          type="text"
          value={form.description ?? ""}
          onChange={e => setForm({ ...form, description: e.target.value })}
          className="border p-1 rounded w-full"
        />

        <button onClick={() => onSave(form)} className="bg-green-600 text-white px-3 py-1 rounded">Save</button>
        <button onClick={onCancel} className="bg-gray-600 text-white px-3 py-1 rounded">Cancel</button>
      </div>
    );
  };

  // =====================================================================================
  // BUSINESS MCP / TOOLS CRUD HANDLERS
  // =====================================================================================

  const createServer = async updates => {
    try {
      await axios.post(`/mcp/${businessId}`, updates);
      const res = await axios.get(`/mcp/${businessId}/registry`);
      setServers(res.data);
      setCreatingServer(false);
      toast.success("Server created!");
    } catch {
      toast.error("Create failed");
    }
  };

  const saveServer = async (id, updates) => {
    try {
      const res = await axios.put(`/mcp/${businessId}/registry/${id}`, updates);
      setServers(servers.map(s => (s.id === id ? res.data : s)));
      setEditingServer(null);
      toast.success("Updated!");
    } catch {
      toast.error("Update failed");
    }
  };

  const deleteServer = async id => {
    try {
      await axios.delete(`/mcp/${businessId}/registry/${id}`);
      setServers(servers.filter(s => s.id !== id));
      toast.success("Deleted");
    } catch {
      toast.error("Delete failed");
    }
  };

  const createTool = async updates => {
    try {
      await axios.post(`/tool/${businessId}`, updates);
      const res = await axios.get(`/tool/${businessId}`);
      setTools(res.data);
      setCreatingTool(false);
      toast.success("Tool created!");
    } catch {
      toast.error("Create failed");
    }
  };

  const saveTool = async (id, updates) => {
    try {
      const res = await axios.put(`/tool/${businessId}/tool/${id}`, updates);
      setTools(tools.map(t => (t.id === id ? res.data : t)));
      setEditingTool(null);
      toast.success("Updated!");
    } catch {
      toast.error("Update failed");
    }
  };

  const deleteTool = async id => {
    try {
      await axios.delete(`/tool/${businessId}/tool/${id}`);
      setTools(tools.filter(t => t.id !== id));
      toast.success("Deleted");
    } catch {
      toast.error("Delete failed");
    }
  };

  // =====================================================================================
  // SUB-AGENT MCP + TOOL HANDLERS
  // =====================================================================================

  const createSubServer = async updates => {
    try {
      console.log(`updates = ${JSON.stringify(updates)}`)
      
      await axios.post(`/subagent/${selectedSubAgent.id}/mcp_registry`, updates);
      const res = await axios.get(`/subagent/${selectedSubAgent.id}/mcp_registry`);
      setSubServers(res.data);
      setCreatingSubServer(false);
    } catch {
      toast.error("Create failed");
    }
  };

  const saveSubServer = async (sid, updates) => {
    try {
      const res = await axios.put(
        `/subagent/${selectedSubAgent.id}/mcp_registry/${sid}`,
        updates
      );
      setSubServers(subServers.map(s => (s.id === sid ? res.data : s)));
      setEditingSubServer(null);
    } catch {
      toast.error("Update failed");
    }
  };

  const deleteSubServer = async sid => {
    try {
      await axios.delete(
        `/subagent/${selectedSubAgent.id}/mcp_registry/${sid}`
      );
      setSubServers(subServers.filter(s => s.id !== sid));
    } catch {
      toast.error("Delete failed");
    }
  };

  const createSubTool = async updates => {
    try {
      await axios.post(`/subagent/${selectedSubAgent.id}/tools`, updates);
      const res = await axios.get(`/subagent/${selectedSubAgent.id}/tools`);
      setSubTools(res.data);
      setCreatingSubTool(false);
    } catch {
      toast.error("Create failed");
    }
  };

  const saveSubTool = async (tid, updates) => {
    try {
      const res = await axios.put(
        `/subagent/${selectedSubAgent.id}/tools/${tid}`,
        updates
      );
      setSubTools(subTools.map(t => (t.id === tid ? res.data : t)));
      setEditingSubTool(null);
    } catch {
      toast.error("Update failed");
    }
  };

  const deleteSubTool = async tid => {
    try {
      await axios.delete(`/subagent/${selectedSubAgent.id}/tools/${tid}`);
      setSubTools(subTools.filter(t => t.id !== tid));
    } catch {
      toast.error("Delete failed");
    }
  };

  // =====================================================================================
  // RENDER
  // =====================================================================================

  return (
    <div className="p-4 space-y-10">
      {/* ===================== ORG HIERARCHY ===================== */}
      <OrgGraph
        business={{ id: business.id, name: business.name }}
        subAgents={subAgents}
        selectedId={selectedId}
        onSelect={(type, id) => {
          if (type === "business") {
            setEditingBusiness(true);
            setSelectedSubAgent(null);
          } else {
            setEditingBusiness(false);
            const sa = subAgents.find(s => s.id === id);
            if (sa) {
              loadSubAgentDetails(sa);
              setEditingSubAgent(sa);
            }
          }
        }}
        onDeleteSubAgent={subAgentId => {
          if (!confirm("Remove this subagent?")) return;
          deleteSubAgent(subAgentId); 
          setEditingBusiness(true)}
        }
        onEditSubAgent={subAgentId => {}}
      />

      {editingBusiness && <div>
      {/* ===================== MAIN BUSINESS ===================== */}
        <PromptsEditor
          businessPrompt={business.agent_prompt}
          onSaveBusiness={prompt => saveBusiness(business.id, { ...business, agent_prompt: prompt })}
          infraPromptValue={infraPrompt}
          onSaveInfra={saveInfraPrompt}
        />

        {/* Create new sub-agent */}
        <h2 className="text-xl font-bold mb-3">New Sub-agent</h2>
        {creatingSubAgent ? (
          <SubAgentEditor
            sa={{ name: "", description: "", prompt: "" }}
            onSave={form => createSubAgent(form)}
            onCancel={() => setCreatingSubAgent(false)}
          />
        ) : (
          <button
            onClick={() => setCreatingSubAgent(true)}
            className="bg-blue-600 text-white px-3 py-1 rounded mb-3"
          >
            + New Sub-agent
          </button>
        )}
        
        {/* ===================== BUSINESS MCP ===================== */}
        <div>
          <h2 className="text-xl font-bold mb-3">Business MCP Registry</h2>

          {creatingServer ? (
            <ServerEditor
              server={{ url: "", name: "", description: "", prompt: "" }}
              onSave={form => createServer(form)}
              onCancel={() => setCreatingServer(false)}
            />
          ) : (
            <button
              onClick={() => setCreatingServer(true)}
              className="bg-blue-600 text-white px-3 py-1 rounded mb-3"
            >
              + New Server
            </button>
          )}

          <ul className="space-y-2">
            {servers.map(s => (
              <li key={s.id} className="border p-2 rounded">
                {editingServer?.id === s.id ? (
                  <ServerEditor
                    server={s}
                    onSave={form => saveServer(s.id, form)}
                    onCancel={() => setEditingServer(null)}
                  />
                ) : (
                  <div className="flex justify-between">
                    <span>{s.name || s.url}</span>
                    <div className="space-x-2">
                      <button
                        onClick={() => setEditingServer(s)}
                        className="bg-yellow-500 text-white px-3 py-1 rounded"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => deleteServer(s.id)}
                        className="bg-red-500 text-white px-3 py-1 rounded"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>

        {/* ===================== BUSINESS TOOLS ===================== */}
        <div>
          <h2 className="text-xl font-bold mb-3">Business Built-in Tools</h2>

          {creatingTool ? (
            <ToolEditor
              tool={{ name: "", description: "" }}
              onSave={form => createTool(form)}
              onCancel={() => setCreatingTool(false)}
            />
          ) : (
            <button
              onClick={() => setCreatingTool(true)}
              className="bg-blue-600 text-white px-3 py-1 rounded mb-3"
            >
              + New Tool
            </button>
          )}

          <ul className="space-y-2">
            {tools.map(t => (
              <li key={t.id} className="border p-2 rounded">
                {editingTool?.id === t.id ? (
                  <ToolEditor
                    tool={t}
                    onSave={form => saveTool(t.id, form)}
                    onCancel={() => setEditingTool(null)}
                  />
                ) : (
                  <div className="flex justify-between">
                    <span>{t.name}</span>
                    <div className="space-x-2">
                      <button
                        onClick={() => setEditingTool(t)}
                        className="bg-yellow-500 text-white px-3 py-1 rounded"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => deleteTool(t.id)}
                        className="bg-red-500 text-white px-3 py-1 rounded"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>

      </div>}

      {!editingBusiness && <div>
        {/* ===================== SUB-AGENTS ===================== */}
        {editingSubAgent && (() => {
          const sa = editingSubAgent;
          return (
            <div className="mb-6 space-y-3">
              <h2 className="text-xl font-bold">Sub-agent: {sa.name}</h2>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-xs text-gray-500">Name</label>
                  <input
                    type="text"
                    defaultValue={sa.name}
                    onBlur={e => setEditingSubAgent({ ...sa, name: e.target.value })}
                    className="border p-1 rounded w-full text-sm"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-xs text-gray-500">Description</label>
                  <input
                    type="text"
                    defaultValue={sa.description ?? ""}
                    onBlur={e => setEditingSubAgent({ ...sa, description: e.target.value })}
                    className="border p-1 rounded w-full text-sm"
                  />
                </div>
              </div>
              <PromptsEditor
                businessPrompt={sa.prompt}
                onSaveBusiness={prompt => saveSubAgent(sa.id, { ...sa, prompt })}
                infraPromptValue={infraPrompt}
                onSaveInfra={saveInfraPrompt}
              />
            </div>
          );
        })()}

        {/* ===================== SUB-AGENT DETAILS (IF SELECTED) ===================== */}
        {selectedSubAgent && (
          <div className="border p-4 rounded bg-gray-50">
            {/* ========== SUB-AGENT MCP TOOLS ========== */}
            <div>
              <h3 className="text-lg font-semibold mb-2">MCP Registry</h3>

              {creatingSubServer ? (
                <ServerEditor
                  server={{ url: "", name: "", description: "", prompt: "" }}
                  onSave={form => createSubServer(form)}
                  onCancel={() => setCreatingSubServer(false)}
                />
              ) : (
                <button
                  onClick={() => setCreatingSubServer(true)}
                  className="bg-blue-600 text-white px-3 py-1 rounded mb-3"
                >
                  + Add MCP Server
                </button>
              )}

              <ul className="space-y-2">
                {subServers.map(s => (
                  <li key={s.id} className="border p-2 rounded">
                    {editingSubServer?.id === s.id ? (
                      <ServerEditor
                        server={s}
                        onSave={form => saveSubServer(s.id, form)}
                        onCancel={() => setEditingSubServer(null)}
                      />
                    ) : (
                      <div className="flex justify-between">
                        <span>{s.name || s.url}</span>
                        <div className="space-x-2">
                          <button
                            onClick={() => setEditingSubServer(s)}
                            className="bg-yellow-500 text-white px-3 py-1 rounded"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => deleteSubServer(s.id)}
                            className="bg-red-500 text-white px-3 py-1 rounded"
                          >
                            Delete
                          </button>
                        </div>
                    </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            {/* ========== SUB-AGENT BUILT-IN TOOLS ========== */}
            <div className="mt-6">
              <h3 className="text-lg font-semibold mb-2">Built-in Tools</h3>

              {creatingSubTool ? (
                <ToolEditor
                  tool={{ name: "", description: "" }}
                  onSave={form => createSubTool(form)}
                  onCancel={() => setCreatingSubTool(false)}
                />
              ) : (
                <button
                  onClick={() => setCreatingSubTool(true)}
                  className="bg-blue-600 text-white px-3 py-1 rounded mb-3"
                >
                  + Add Tool
                </button>
              )}

              <ul className="space-y-2">
                {subTools.map(t => (
                  <li key={t.id} className="border p-2 rounded">
                    {editingSubTool?.id === t.id ? (
                      <ToolEditor
                        tool={t}
                        onSave={form => saveSubTool(t.id, form)}
                        onCancel={() => setEditingSubTool(null)}
                      />
                    ) : (
                      <div className="flex justify-between">
                        <span>{t.name}</span>
                        <div className="space-x-2">
                          <button
                            onClick={() => setEditingSubTool(t)}
                            className="bg-yellow-500 text-white px-3 py-1 rounded"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => deleteSubTool(t.id)}
                            className="bg-red-500 text-white px-3 py-1 rounded"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

      </div>}

    </div>
  );
}
