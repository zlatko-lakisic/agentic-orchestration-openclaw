import { test } from "node:test";
import { strict as assert } from "node:assert";
import { registerAgentReplyHook } from "./hook.js";
import type { OpenClawPluginApi, PluginConfig } from "./types.js";

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
  syncOpenClawMcp: true,
  injectOpenClawContext: true,
  bridgeOpenClawTools: true,
  bridgePort: 3848,
  fallthroughAutomation: true,
};

test("hook registers before_agent_reply with priority and timeout", () => {
  const registrations: Array<{ event: string; opts?: { priority?: number; timeoutMs?: number } }> =
    [];
  const api: OpenClawPluginApi = {
    logger: { info() {}, error() {} },
    on(event, _handler, opts) {
      registrations.push({ event, opts });
    },
  };

  registerAgentReplyHook(api, () => baseConfig);

  assert.equal(registrations.length, 3);
  assert.equal(registrations[0]?.event, "before_reset");
  assert.equal(registrations[1]?.event, "before_model_resolve");
  assert.equal(registrations[2]?.event, "before_agent_reply");
  assert.equal(registrations[2]?.opts?.priority, 100);
  assert.equal(registrations[2]?.opts?.timeoutMs, 10_000);
});

test("hook returns handled reply from client", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ ok: true, output: "hello from crew" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;

  try {
    let replyHandler:
      | ((
          event: { cleanedBody: string },
          ctx: { sessionKey?: string },
        ) => Promise<{ handled: boolean; reply?: { text?: string } } | void>)
      | undefined;

    const api: OpenClawPluginApi = {
      logger: { info() {}, error() {} },
      on(event, handler) {
        if (event === "before_agent_reply") {
          replyHandler = handler as typeof replyHandler;
        }
      },
    };

    registerAgentReplyHook(api, () => baseConfig);
    assert.ok(replyHandler);
    const result = await replyHandler!({ cleanedBody: "hi" }, { sessionKey: "sess-1" });
    assert.deepEqual(result, {
      handled: true,
      reply: { text: "hello from crew" },
      reason: "agentic-orchestration",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
