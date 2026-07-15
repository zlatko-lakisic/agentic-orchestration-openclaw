import { test } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ensureOrchestrateEndpoint } from "./sidecar/inject-orchestrate.js";

test("ensureOrchestrateEndpoint injects when missing and is idempotent", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ao-inject-"));
  const webDir = path.join(dir, "web");
  fs.mkdirSync(webDir);

  // Minimal anchors matching real server.mjs structure.
  const stub = `
function requestUrlHead(req) { return String(req.url || "").split("?")[0]; }
function getRequestPathname(req) { return "/"; }

function isOpenAiResponsesPath(req) {
  return false;
}

function sendAgentProvidersJson(res) {}

function handleHttp(req, res) {
  if (isAgentProvidersApi(req)) {
    sendAgentProvidersJson(res);
    return;
  }
  serveStatic(req, res);
}

function isAgentProvidersApi(req) { return false; }
function serveStatic(req, res) {}
function clientErrorMessage(err, fallback) { return fallback; }
`;
  const serverPath = path.join(webDir, "server.mjs");
  fs.writeFileSync(serverPath, stub);

  const logs: string[] = [];
  const logger = { info: (m: string) => logs.push(m), warn: () => {} };

  assert.equal(ensureOrchestrateEndpoint(webDir, logger), true);
  const once = fs.readFileSync(serverPath, "utf8");
  assert.match(once, /function isApiV1Orchestrate/);
  assert.match(once, /async function handleApiV1Orchestrate/);
  assert.match(once, /if \(isApiV1Orchestrate\(req\)\)/);
  assert.ok(fs.existsSync(`${serverPath}.pre-openclaw-inject`));

  assert.equal(ensureOrchestrateEndpoint(webDir, logger), false);

  fs.rmSync(dir, { recursive: true, force: true });
});
