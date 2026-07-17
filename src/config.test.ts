import { test } from "node:test";
import { strict as assert } from "node:assert";
import { resolveConfig } from "./config.js";

test("resolveConfig applies defaults including managedBackend", () => {
  const cfg = resolveConfig({});
  assert.equal(cfg.endpoint, "http://127.0.0.1:3847/api/v1/orchestrate");
  assert.equal(cfg.timeoutMs, 120_000);
  assert.equal(cfg.runMode, "dynamic");
  assert.equal(cfg.sessionPassthrough, true);
  assert.equal(cfg.fallbackOnError, false);
  assert.equal(cfg.verboseCrew, false);
  assert.equal(cfg.apiKey, undefined);
  assert.equal(cfg.managedBackend, true);
  assert.equal(cfg.syncOpenClawMcp, true);
  assert.equal(cfg.injectOpenClawContext, true);
  assert.equal(cfg.bridgeOpenClawTools, true);
  assert.equal(cfg.fallthroughAutomation, true);
  assert.equal(cfg.preferLocalCheckout, true);
  assert.equal(cfg.autoUpdate, true);
  assert.equal(cfg.backendHost, "127.0.0.1");
  assert.deepEqual(cfg.selectedAgentProviderIds, ["ollama_llama3_2_1b"]);
  assert.equal(cfg.backendPort, 3847);
  assert.equal(cfg.bootstrapTimeoutMs, 600_000);
});

test("resolveConfig honors provided fields", () => {
  const cfg = resolveConfig({
    endpoint: "http://example:9/api/v1/orchestrate",
    apiKey: "secret",
    timeoutMs: 30_000,
    runMode: "dynamic-iterative",
    sessionPassthrough: false,
    fallbackOnError: true,
    verboseCrew: true,
    managedBackend: false,
    preferLocalCheckout: false,
    autoUpdate: false,
    backendPort: 9999,
  });
  assert.equal(cfg.endpoint, "http://example:9/api/v1/orchestrate");
  assert.equal(cfg.apiKey, "secret");
  assert.equal(cfg.timeoutMs, 30_000);
  assert.equal(cfg.runMode, "dynamic-iterative");
  assert.equal(cfg.sessionPassthrough, false);
  assert.equal(cfg.fallbackOnError, true);
  assert.equal(cfg.verboseCrew, true);
  assert.equal(cfg.managedBackend, false);
  assert.equal(cfg.preferLocalCheckout, false);
  assert.equal(cfg.autoUpdate, false);
  assert.equal(cfg.backendPort, 9999);
});

test("resolveConfig tolerates null/undefined", () => {
  assert.equal(resolveConfig(null).runMode, "dynamic");
  assert.equal(resolveConfig(undefined).managedBackend, true);
});
