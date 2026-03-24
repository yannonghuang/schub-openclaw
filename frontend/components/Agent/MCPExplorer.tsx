import { useState } from "react";
import axios from "axios";

interface MCPTool {
  name: string;
  description?: string;
  input_schema: Record<string, any>;
}

interface MCPExploreResult {
  url: string;
  server_name?: string;
  tools: MCPTool[];
}

interface Props {
  url: string;
  onPromptSuggested: (prompt: string) => void;
}

function buildPromptFromTools(tools: MCPTool[]): string {
  const lines = tools.map(t => {
    const desc = t.description ? `: ${t.description}` : "";
    return `- ${t.name}${desc}`;
  });
  return `You have access to the following tools:\n${lines.join("\n")}`;
}

function SchemaView({ schema }: { schema: Record<string, any> }) {
  const props = schema?.properties ?? {};
  const required: string[] = schema?.required ?? [];
  const keys = Object.keys(props);
  if (!keys.length) return <p className="text-xs text-gray-400 italic">No parameters</p>;
  return (
    <table className="w-full text-xs mt-1 border-collapse">
      <thead>
        <tr className="text-left text-gray-500">
          <th className="pr-3 pb-1 font-medium">Parameter</th>
          <th className="pr-3 pb-1 font-medium">Type</th>
          <th className="pb-1 font-medium">Required</th>
        </tr>
      </thead>
      <tbody>
        {keys.map(k => (
          <tr key={k} className="border-t border-gray-100">
            <td className="pr-3 py-0.5 font-mono text-gray-700">{k}</td>
            <td className="pr-3 py-0.5 text-gray-500">{props[k]?.type ?? "any"}</td>
            <td className="py-0.5 text-gray-500">{required.includes(k) ? "yes" : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ToolCard({ tool }: { tool: MCPTool }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-gray-200 rounded p-2 bg-white">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <span className="font-mono text-sm font-semibold text-gray-800">{tool.name}</span>
          {tool.description && (
            <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{tool.description}</p>
          )}
        </div>
        <button
          onClick={() => setOpen(o => !o)}
          className="text-xs text-blue-500 hover:text-blue-700 whitespace-nowrap shrink-0 mt-0.5"
        >
          {open ? "▾ Hide schema" : "▸ Schema"}
        </button>
      </div>
      {open && (
        <div className="mt-2 pt-2 border-t border-gray-100">
          <SchemaView schema={tool.input_schema} />
        </div>
      )}
    </div>
  );
}

export default function MCPExplorer({ url, onPromptSuggested }: Props) {
  const [result, setResult] = useState<MCPExploreResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const explore = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await axios.post<MCPExploreResult>("/mcp/explore", { url });
      setResult(res.data);
    } catch (e: any) {
      const msg =
        e.response?.data?.detail ??
        (e.code === "ECONNABORTED" ? "Request timed out" : "Could not reach server");
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const canExplore = url.startsWith("http");

  return (
    <div className="mt-1">
      {/* Explore button */}
      <button
        type="button"
        onClick={explore}
        disabled={!canExplore || loading}
        className="text-xs px-2 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {loading ? "Connecting…" : "Explore"}
      </button>

      {/* Error */}
      {error && (
        <p className="text-xs text-red-500 mt-1">{error}</p>
      )}

      {/* Results */}
      {result && (
        <div className="mt-2 border border-indigo-100 rounded bg-indigo-50 p-2 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-indigo-700">
              {result.server_name
                ? `${result.server_name} — ${result.tools.length} tool${result.tools.length !== 1 ? "s" : ""}`
                : `${result.tools.length} tool${result.tools.length !== 1 ? "s" : ""} found`}
            </span>
            {result.tools.length > 0 && (
              <button
                type="button"
                onClick={() => onPromptSuggested(buildPromptFromTools(result.tools))}
                className="text-xs px-2 py-0.5 rounded bg-indigo-600 text-white hover:bg-indigo-700"
              >
                Use as Prompt
              </button>
            )}
          </div>

          {result.tools.length === 0 ? (
            <p className="text-xs text-gray-500 italic">No tools registered on this server.</p>
          ) : (
            <div className="space-y-1.5">
              {result.tools.map(t => (
                <ToolCard key={t.name} tool={t} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
