import { test } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  mapOpenClawMcpServer,
  mergeExtraMcpProvidersPath,
  openClawMcpProviderId,
  syncOpenClawMcpProviders,
} from "./sidecar/openclaw-mcp-sync.js";

test("openClawMcpProviderId sanitizes names", () => {
  assert.equal(openClawMcpProviderId("docs"), "openclaw_docs");
  assert.equal(openClawMcpProviderId("Outlook Graph"), "openclaw_outlook_graph");
  assert.equal(openClawMcpProviderId("123bad"), "openclaw_123bad");
});

test("mapOpenClawMcpServer maps stdio", () => {
  const mapped = mapOpenClawMcpServer("docs", {
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-fetch"],
    env: { FOO: "bar" },
  });
  assert.equal(mapped.ok, true);
  if (!mapped.ok) return;
  assert.equal(mapped.id, "openclaw_docs");
  assert.equal(mapped.kind, "stdio");
  assert.match(mapped.yaml, /stdio:/);
  assert.match(mapped.yaml, /command: "npx"/);
  assert.match(mapped.yaml, /@modelcontextprotocol\/server-fetch/);
  assert.match(mapped.yaml, /"FOO": "bar"/);
});

test("mapOpenClawMcpServer maps streamable-http", () => {
  const mapped = mapOpenClawMcpServer("remote", {
    url: "https://example.com/mcp",
    transport: "streamable-http",
    headers: { Authorization: "Bearer tok" },
  });
  assert.equal(mapped.ok, true);
  if (!mapped.ok) return;
  assert.equal(mapped.kind, "streamable_http");
  assert.match(mapped.yaml, /streamable_http:/);
  assert.match(mapped.yaml, /https:\/\/example\.com\/mcp/);
  assert.match(mapped.yaml, /Bearer tok/);
});

test("mapOpenClawMcpServer skips oauth and sse and disabled", () => {
  assert.equal(mapOpenClawMcpServer("o", { url: "https://x", auth: "oauth" }).ok, false);
  assert.equal(mapOpenClawMcpServer("s", { url: "https://x", transport: "sse" }).ok, false);
  assert.equal(mapOpenClawMcpServer("d", { command: "npx", enabled: false }).ok, false);
});

test("syncOpenClawMcpProviders writes and cleans fragments", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ao-mcp-sync-"));
  try {
    const first = syncOpenClawMcpProviders({
      dataRoot: root,
      openClawConfig: {
        mcp: {
          servers: {
            docs: { command: "uvx", args: ["context7-mcp"] },
            gone: { command: "echo", args: ["hi"] },
          },
        },
      },
    });
    assert.deepEqual(first.written.sort(), ["openclaw_docs", "openclaw_gone"]);
    assert.ok(fs.existsSync(path.join(first.catalogDir, "openclaw_docs.yaml")));

    const second = syncOpenClawMcpProviders({
      dataRoot: root,
      openClawConfig: {
        mcp: {
          servers: {
            docs: { command: "uvx", args: ["context7-mcp"] },
          },
        },
      },
    });
    assert.deepEqual(second.written, ["openclaw_docs"]);
    assert.equal(fs.existsSync(path.join(second.catalogDir, "openclaw_gone.yaml")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("mergeExtraMcpProvidersPath prepends without dupes", () => {
  const sep = process.platform === "win32" ? ";" : ":";
  const a = path.resolve("/tmp/ao-a");
  const b = path.resolve("/tmp/ao-b");
  const merged = mergeExtraMcpProvidersPath(`${b}${sep}${a}`, a);
  assert.equal(merged.split(sep)[0], a);
  assert.equal(merged.split(sep).filter((p) => path.resolve(p) === a).length, 1);
});
