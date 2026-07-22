import { test } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveAgentEnv, writeToolEnvFile } from "./sidecar/credentials.js";

test("resolveAgentEnv defaults to Ollama when no keys", () => {
  const prevOpenAi = process.env.OPENAI_API_KEY;
  const prevAnthropic = process.env.ANTHROPIC_API_KEY;
  const prevPlanner = process.env.AGENTIC_PLANNER_MODEL;
  const prevRouter = process.env.ROUTER_OLLAMA_MODEL;
  const prevOllamaHost = process.env.OLLAMA_HOST;
  const prevOllamaBase = process.env.OLLAMA_API_BASE;
  const prevDynamic = process.env.AGENTIC_OPENAI_PROXY_DYNAMIC_AGENT_PROVIDER_IDS;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.AGENTIC_PLANNER_MODEL;
  delete process.env.ROUTER_OLLAMA_MODEL;
  delete process.env.OLLAMA_HOST;
  delete process.env.OLLAMA_API_BASE;
  delete process.env.AGENTIC_OPENAI_PROXY_DYNAMIC_AGENT_PROVIDER_IDS;

  try {
    const env = resolveAgentEnv({ openClawConfig: {} });
    assert.equal(env.OLLAMA_HOST, "http://127.0.0.1:11434");
    assert.equal(env.AGENTIC_PLANNER_MODEL, "ollama/llama3.2:1b");
    assert.equal(env.ROUTER_OLLAMA_MODEL, "llama3.2:1b");
    assert.equal(env.AGENTIC_OPENAI_PROXY_DYNAMIC_AGENT_PROVIDER_IDS, "ollama_llama3_2_1b");
    assert.equal(env.AGENTIC_OLLAMA_KEEPALIVE, "1");
    assert.equal(env.AGENTIC_OLLAMA_KEEP_ALIVE, "-1");
    assert.equal(env.AGENTIC_OLLAMA_KEEPALIVE_INTERVAL_MS, "60000");
  } finally {
    if (prevOpenAi !== undefined) process.env.OPENAI_API_KEY = prevOpenAi;
    else delete process.env.OPENAI_API_KEY;
    if (prevAnthropic !== undefined) process.env.ANTHROPIC_API_KEY = prevAnthropic;
    else delete process.env.ANTHROPIC_API_KEY;
    if (prevPlanner !== undefined) process.env.AGENTIC_PLANNER_MODEL = prevPlanner;
    else delete process.env.AGENTIC_PLANNER_MODEL;
    if (prevRouter !== undefined) process.env.ROUTER_OLLAMA_MODEL = prevRouter;
    else delete process.env.ROUTER_OLLAMA_MODEL;
    if (prevOllamaHost !== undefined) process.env.OLLAMA_HOST = prevOllamaHost;
    else delete process.env.OLLAMA_HOST;
    if (prevOllamaBase !== undefined) process.env.OLLAMA_API_BASE = prevOllamaBase;
    else delete process.env.OLLAMA_API_BASE;
    if (prevDynamic !== undefined) process.env.AGENTIC_OPENAI_PROXY_DYNAMIC_AGENT_PROVIDER_IDS = prevDynamic;
    else delete process.env.AGENTIC_OPENAI_PROXY_DYNAMIC_AGENT_PROVIDER_IDS;
  }
});

test("resolveAgentEnv prefers OpenAI from OpenClaw models.providers", () => {
  const prev = process.env.OPENAI_API_KEY;
  const prevPlanner = process.env.AGENTIC_PLANNER_MODEL;
  const prevOllamaHost = process.env.OLLAMA_HOST;
  delete process.env.OPENAI_API_KEY;
  delete process.env.AGENTIC_PLANNER_MODEL;
  delete process.env.OLLAMA_HOST;
  try {
    const env = resolveAgentEnv({
      openClawConfig: {
        models: {
          providers: {
            openai: { apiKey: "from-config-fixture" },
          },
        },
      },
    });
    assert.equal(env.OPENAI_API_KEY, "from-config-fixture");
    assert.equal(env.AGENTIC_PLANNER_MODEL, "openai/gpt-4o-mini");
  } finally {
    if (prev !== undefined) process.env.OPENAI_API_KEY = prev;
    else delete process.env.OPENAI_API_KEY;
    if (prevPlanner !== undefined) process.env.AGENTIC_PLANNER_MODEL = prevPlanner;
    else delete process.env.AGENTIC_PLANNER_MODEL;
    if (prevOllamaHost !== undefined) process.env.OLLAMA_HOST = prevOllamaHost;
    else delete process.env.OLLAMA_HOST;
  }
});

test("writeToolEnvFile omits API keys from disk", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ao-env-"));
  try {
    const p = writeToolEnvFile(dir, { OPENAI_API_KEY: "abc", AGENTIC_PLANNER_MODEL: "openai/gpt-4o-mini" });
    const text = fs.readFileSync(p, "utf8");
    assert.equal(text.includes("OPENAI_API_KEY"), false);
    assert.match(text, /AGENTIC_PLANNER_MODEL=openai\/gpt-4o-mini/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
