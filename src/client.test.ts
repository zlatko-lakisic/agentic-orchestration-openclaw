import { test } from "node:test";
import { strict as assert } from "node:assert";
import { AgenticOrchestrationClient } from "./client.js";
import type { PluginConfig } from "./types.js";

const baseConfig: PluginConfig = {
  endpoint: "http://localhost:3847/api/v1/orchestrate",
  timeoutMs: 5_000,
  runMode: "dynamic",
  sessionPassthrough: true,
  fallbackOnError: false,
  verboseCrew: false,
  managedBackend: false,
  repoUrl: "https://github.com/zlatko-lakisic/agentic-orchestration.git",
  preferLocalCheckout: true,
  autoUpdate: true,
  backendHost: "localhost",
  backendPort: 3847,
  bootstrapTimeoutMs: 60_000,
};

test("client posts JSON and returns output", async () => {
  const originalFetch = globalThis.fetch;
  let seenUrl = "";
  let seenInit: RequestInit | undefined;

  globalThis.fetch = asynchronously(async (input, init) => {
    seenUrl = String(input);
    seenInit = init;
    return new Response(JSON.stringify({ ok: true, output: "Paris" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const client = new AgenticOrchestrationClient({
      ...baseConfig,
      apiKey: "tok",
    });
    const out = await client.orchestrate({ text: "capital of France?", sessionId: "s1" });
    assert.equal(out, "Paris");
    assert.equal(seenUrl, baseConfig.endpoint);
    assert.equal(seenInit?.method, "POST");
    const headers = seenInit?.headers as Record<string, string>;
    assert.equal(headers["Authorization"], "Bearer tok");
    assert.equal(headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(String(seenInit?.body)), {
      text: "capital of France?",
      sessionId: "s1",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("client throws on HTTP error", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = asynchronously(async () => {
    return new Response(JSON.stringify({ error: "body.text is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const client = new AgenticOrchestrationClient(baseConfig);
    await assert.rejects(
      () => client.orchestrate({ text: "x" }),
      /HTTP 400: body\.text is required/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("client throws on unexpected shape", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = asynchronously(async () => {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const client = new AgenticOrchestrationClient(baseConfig);
    await assert.rejects(
      () => client.orchestrate({ text: "x" }),
      /unexpected response shape/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function asynchronously<T extends (...args: never[]) => unknown>(fn: T): T {
  return fn;
}
