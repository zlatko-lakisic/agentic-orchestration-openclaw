import { test } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { writeOpenClawBridgeProvider } from "./bridge/provider-yaml.js";
import { mapOpenClawMcpServer } from "./sidecar/openclaw-mcp-sync.js";
import { composeOrchestrateText, buildOpenClawContextPreamble } from "./openclaw-context.js";

test("composeOrchestrateText keeps User message: last for goal matching", () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "ao-ctx-"));
  try {
    fs.writeFileSync(path.join(ws, "AGENTS.md"), "Be helpful.");
    const preamble = buildOpenClawContextPreamble({
      workspaceDir: ws,
      sessionKey: "agent:main:chat",
    });
    const composed = composeOrchestrateText("Who are you?", preamble);
    const idx = composed.lastIndexOf("User message:");
    assert.ok(idx >= 0);
    assert.equal(composed.slice(idx).includes("Who are you?"), true);
    assert.equal(composed.trim().endsWith("Who are you?"), true);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("openclaw_bridge yaml has stdio shape CrewAI expects after normalize", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ao-bridge-"));
  const pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ao-plugin-"));
  try {
    fs.mkdirSync(path.join(pluginRoot, "mcp"), { recursive: true });
    fs.writeFileSync(path.join(pluginRoot, "mcp", "openclaw-bridge-server.mjs"), "// stub\n");
    const out = writeOpenClawBridgeProvider({
      dataRoot: root,
      pluginRootDir: pluginRoot,
      bridgeUrl: "http://127.0.0.1:3848",
      bridgeToken: "tok",
    });
    const yaml = fs.readFileSync(out, "utf8");
    assert.match(yaml, /id: openclaw_bridge/);
    assert.match(yaml, /stdio:/);
    assert.match(yaml, /--url/);
    assert.match(yaml, /--token/);
    assert.match(yaml, /command:/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(pluginRoot, { recursive: true, force: true });
  }
});

test("synced filesystem mcp is stdio dict-compatible", () => {
  const mapped = mapOpenClawMcpServer("filesystem", {
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp/ws"],
  });
  assert.equal(mapped.ok, true);
  if (!mapped.ok) return;
  assert.match(mapped.yaml, /stdio:/);
  assert.match(mapped.yaml, /server-filesystem/);
});
