#!/usr/bin/env node
/**
 * Stdio MCP server that proxies OpenClaw tools via the plugin bridge control plane.
 * Env: OPENCLAW_BRIDGE_URL, OPENCLAW_BRIDGE_TOKEN
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const baseUrl = (process.env.OPENCLAW_BRIDGE_URL || "http://127.0.0.1:3848").replace(/\/+$/, "");
const token = process.env.OPENCLAW_BRIDGE_TOKEN || "";

async function bridgeInvoke(tool, args = {}) {
  if (!token) {
    throw new Error("OPENCLAW_BRIDGE_TOKEN is not set");
  }
  const res = await fetch(`${baseUrl}/invoke`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ tool, args }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) {
    throw new Error(body.error || `bridge HTTP ${res.status}`);
  }
  return body.result;
}

function asText(result) {
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

const tools = [
  {
    name: "openclaw_browser",
    description:
      "Control the OpenClaw-managed browser (navigate, snapshot, click, type, tabs). Proxied to OpenClaw's browser tool with gateway policy.",
    inputSchema: {
      type: "object",
      additionalProperties: true,
      properties: {
        action: { type: "string", description: "Browser action (e.g. open, snapshot, click)" },
      },
    },
    openclawTool: "browser",
  },
  {
    name: "openclaw_exec",
    description:
      "Run a shell command via OpenClaw's exec tool (approvals/allowlists apply when configured). Prefer for host commands.",
    inputSchema: {
      type: "object",
      additionalProperties: true,
      properties: {
        command: { type: "string" },
      },
    },
    openclawTool: "exec",
  },
  {
    name: "openclaw_memory_search",
    description: "Search OpenClaw workspace memory via memory_search.",
    inputSchema: {
      type: "object",
      additionalProperties: true,
      properties: {
        query: { type: "string" },
      },
      required: ["query"],
    },
    openclawTool: "memory_search",
  },
  {
    name: "openclaw_memory_get",
    description: "Read an OpenClaw memory file via memory_get.",
    inputSchema: {
      type: "object",
      additionalProperties: true,
      properties: {
        path: { type: "string" },
      },
    },
    openclawTool: "memory_get",
  },
  {
    name: "openclaw_nodes_list",
    description: "List paired OpenClaw nodes/devices.",
    inputSchema: { type: "object", additionalProperties: true, properties: {} },
    openclawTool: "nodes_list",
  },
  {
    name: "openclaw_nodes_invoke",
    description:
      "Invoke a command on a paired OpenClaw node (camera, screen, notify, system.run, …). Dangerous commands remain gated by OpenClaw.",
    inputSchema: {
      type: "object",
      additionalProperties: true,
      properties: {
        node: { type: "string" },
        command: { type: "string" },
      },
    },
    openclawTool: "nodes_invoke",
  },
];

const server = new Server(
  { name: "openclaw-bridge", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const args = request.params.arguments || {};
  const def = tools.find((t) => t.name === name);
  if (!def) {
    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }
  try {
    const result = await bridgeInvoke(def.openclawTool, args);
    return { content: [{ type: "text", text: asText(result) }] };
  } catch (err) {
    const msg =
      err instanceof Error
        ? String(err.message || "bridge invoke failed").split(/\r?\n/)[0].slice(0, 400)
        : "bridge invoke failed";
    return {
      content: [{ type: "text", text: msg || "bridge invoke failed" }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
