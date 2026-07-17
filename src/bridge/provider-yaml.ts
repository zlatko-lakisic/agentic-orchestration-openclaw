/**
 * Emit AO MCP fragment for the plugin-hosted OpenClaw tool bridge.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { OPENCLAW_MCP_CATALOG_DIRNAME } from "../sidecar/openclaw-mcp-sync.js";

export const OPENCLAW_BRIDGE_PROVIDER_ID = "openclaw_bridge";

export function writeOpenClawBridgeProvider(params: {
  dataRoot: string;
  pluginRootDir: string;
  bridgeUrl: string;
  bridgeToken: string;
}): string {
  const catalogDir = path.join(params.dataRoot, OPENCLAW_MCP_CATALOG_DIRNAME);
  fs.mkdirSync(catalogDir, { recursive: true });

  const serverJs = path.resolve(params.pluginRootDir, "mcp", "openclaw-bridge-server.mjs");
  // Prefer installed extension path; fall back to source checkout during dev.
  const command = process.execPath;
  const yaml = `# Auto-generated OpenClaw tool bridge (plugin-hosted MCP)
id: ${OPENCLAW_BRIDGE_PROVIDER_ID}
description: >-
  Proxies OpenClaw host tools into AO: browser, exec, paired nodes, and memory search/get.
  Execution stays on the OpenClaw gateway (policy, approvals, pairing).
capabilities: >-
  Browser automation, shell exec via OpenClaw, node/device commands, and OpenClaw memory tools.
good_for: >-
  When the user asks to open a page, run a command, use a phone/Mac node, or search OpenClaw memory.
planner_hint: >-
  Prefer this MCP for OpenClaw-native host actions (browser/exec/nodes/memory) instead of inventing results.
user_goal_keywords:
  - browser
  - open website
  - screenshot
  - shell
  - terminal
  - run command
  - exec
  - node
  - device
  - camera
  - memory
  - remember
  - openclaw
stdio:
  command: ${JSON.stringify(command)}
  args:
    - ${JSON.stringify(serverJs)}
  env:
    "OPENCLAW_BRIDGE_URL": ${JSON.stringify(params.bridgeUrl)}
    "OPENCLAW_BRIDGE_TOKEN": ${JSON.stringify(params.bridgeToken)}
`;

  const outPath = path.join(catalogDir, `${OPENCLAW_BRIDGE_PROVIDER_ID}.yaml`);
  fs.writeFileSync(outPath, yaml, { mode: 0o600 });
  return outPath;
}
