/**
 * Tests for MCPExplorer component.
 *
 * Uses MSW v2 to intercept POST /mcp/explore calls.
 * Run: npm test -- MCPExplorer
 */

import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import MCPExplorer from "../../../components/Agent/MCPExplorer";

// ---------------------------------------------------------------------------
// MSW server
// ---------------------------------------------------------------------------

const TOOLS_PAYLOAD = {
  url: "http://localhost:9500/mcp",
  server_name: "MyTools",
  tools: [
    {
      name: "calculate_expression",
      description: "Calculates a math expression safely.",
      input_schema: {
        type: "object",
        properties: { expression: { type: "string" } },
        required: ["expression"],
      },
    },
    {
      name: "another_tool",
      description: "Does something else.",
      input_schema: {},
    },
  ],
};

const server = setupServer(
  http.post("/mcp/explore", () => HttpResponse.json(TOOLS_PAYLOAD))
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

const noop = () => {};

function renderExplorer(url = "http://localhost:9500/mcp", onPrompt = noop) {
  return render(<MCPExplorer url={url} onPromptSuggested={onPrompt} />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MCPExplorer", () => {
  it("renders Explore button", () => {
    renderExplorer();
    expect(screen.getByRole("button", { name: /explore/i })).toBeInTheDocument();
  });

  it("disables Explore button when URL is empty", () => {
    renderExplorer("");
    expect(screen.getByRole("button", { name: /explore/i })).toBeDisabled();
  });

  it("disables Explore button for non-http URL", () => {
    renderExplorer("not-a-url");
    expect(screen.getByRole("button", { name: /explore/i })).toBeDisabled();
  });

  it("shows 'Connecting…' while loading", async () => {
    // make the request hang briefly so we can observe loading state
    server.use(
      http.post("/mcp/explore", async () => {
        await new Promise(r => setTimeout(r, 50));
        return HttpResponse.json(TOOLS_PAYLOAD);
      })
    );
    renderExplorer();
    fireEvent.click(screen.getByRole("button", { name: /explore/i }));
    expect(await screen.findByText(/connecting/i)).toBeInTheDocument();
  });

  it("renders tool cards after successful explore", async () => {
    renderExplorer();
    fireEvent.click(screen.getByRole("button", { name: /explore/i }));
    expect(await screen.findByText("calculate_expression")).toBeInTheDocument();
    expect(screen.getByText("another_tool")).toBeInTheDocument();
    expect(screen.getByText(/Calculates a math expression/i)).toBeInTheDocument();
  });

  it("shows server name and tool count in header", async () => {
    renderExplorer();
    fireEvent.click(screen.getByRole("button", { name: /explore/i }));
    expect(await screen.findByText(/MyTools.*2 tools/i)).toBeInTheDocument();
  });

  it("expands schema on 'Schema' click and shows parameter table", async () => {
    renderExplorer();
    fireEvent.click(screen.getByRole("button", { name: /explore/i }));
    await screen.findByText("calculate_expression");

    // find the first Schema toggle (calculate_expression card)
    const schemaToggles = screen.getAllByText(/▸ Schema/i);
    fireEvent.click(schemaToggles[0]);

    expect(await screen.findByText("expression")).toBeInTheDocument();
    expect(screen.getByText("string")).toBeInTheDocument();
    expect(screen.getByText("yes")).toBeInTheDocument(); // required
  });

  it("collapses schema on second click", async () => {
    renderExplorer();
    fireEvent.click(screen.getByRole("button", { name: /explore/i }));
    await screen.findByText("calculate_expression");

    const toggle = screen.getAllByText(/▸ Schema/i)[0];
    fireEvent.click(toggle);
    await screen.findByText(/▾ Hide schema/i);
    fireEvent.click(screen.getByText(/▾ Hide schema/i));

    await waitFor(() =>
      expect(screen.queryByText(/▾ Hide schema/i)).not.toBeInTheDocument()
    );
  });

  it("calls onPromptSuggested with generated text on 'Use as Prompt'", async () => {
    const onPrompt = jest.fn();
    renderExplorer("http://localhost:9500/mcp", onPrompt);
    fireEvent.click(screen.getByRole("button", { name: /explore/i }));
    await screen.findByRole("button", { name: /use as prompt/i });

    fireEvent.click(screen.getByRole("button", { name: /use as prompt/i }));

    expect(onPrompt).toHaveBeenCalledTimes(1);
    const prompt: string = onPrompt.mock.calls[0][0];
    expect(prompt).toContain("calculate_expression");
    expect(prompt).toContain("another_tool");
    expect(prompt).toMatch(/You have access to the following tools/i);
  });

  it("shows error message on 502 response", async () => {
    server.use(
      http.post("/mcp/explore", () =>
        HttpResponse.json({ detail: "MCP server returned 403: http://x" }, { status: 502 })
      )
    );
    renderExplorer();
    fireEvent.click(screen.getByRole("button", { name: /explore/i }));
    expect(await screen.findByText(/MCP server returned 403/i)).toBeInTheDocument();
  });

  it("shows timeout error on 504 response", async () => {
    server.use(
      http.post("/mcp/explore", () =>
        HttpResponse.json({ detail: "MCP server timed out: http://slow" }, { status: 504 })
      )
    );
    renderExplorer();
    fireEvent.click(screen.getByRole("button", { name: /explore/i }));
    expect(await screen.findByText(/timed out/i)).toBeInTheDocument();
  });

  it("shows 'No tools' message when server has no tools", async () => {
    server.use(
      http.post("/mcp/explore", () =>
        HttpResponse.json({ url: "http://x", server_name: "Empty", tools: [] })
      )
    );
    renderExplorer();
    fireEvent.click(screen.getByRole("button", { name: /explore/i }));
    expect(await screen.findByText(/No tools registered/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /use as prompt/i })).not.toBeInTheDocument();
  });

  it("clears previous results before a new explore", async () => {
    renderExplorer();
    fireEvent.click(screen.getByRole("button", { name: /explore/i }));
    await screen.findByText("calculate_expression");

    // second call returns an error
    server.use(
      http.post("/mcp/explore", () =>
        HttpResponse.json({ detail: "error" }, { status: 502 })
      )
    );
    fireEvent.click(screen.getByRole("button", { name: /explore/i }));
    await screen.findByText(/error/i);
    expect(screen.queryByText("calculate_expression")).not.toBeInTheDocument();
  });
});
