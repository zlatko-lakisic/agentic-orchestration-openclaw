import { test } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveAgentEnv, writeToolEnvFile } from "./sidecar/credentials.js";

test("resolveAgentEnv defaults to Ollama when no keys", () => {
  const prevOpenAi = process.env.OPENAI_API_KEY;
  const prevAnthropic = process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  try {
    const env = resolveAgentEnv({ openClawConfig: {} });
    assert.equal(env.OLLAMA_HOST, "http://localhost:11434");
    assert.equal(env.AGENTIC_PLANNER_MODEL, "ollama/llama3.2");
  } finally {
    if (prevOpenAi !== undefined) process.env.OPENAI_API_KEY = prevOpenAi;
    if (prevAnthropic !== undefined) process.env.ANTHROPIC_API_KEY = prevAnthropic;
  }
});

test("resolveAgentEnv prefers OpenAI from OpenClaw models.providers", () => {
  const prev = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const env = resolveAgentEnv({
      openClawConfig: {
        models: {
          providers: {
            openai: { apiKey: "test-openai-key-from-config" },
          },
        },
      },
    });
    assert.equal(env.OPENAI_API_KEY, "test-openai-key-from-config");
    assert.equal(env.AGENTIC_PLANNER_MODEL, "openai/gpt-4o-mini");
  } finally {
    if (prev !== undefined) process.env.OPENAI_API_KEY = prev;
  }
});

test("writeToolEnvFile writes env file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ao-env-"));
  try {
    const p = writeToolEnvFile(dir, { OPENAI_API_KEY: "abc", AGENTIC_PLANNER_MODEL: "openai/gpt-4o-mini" });
    const text = fs.readFileSync(p, "utf8");
    assert.match(text, /OPENAI_API_KEY=abc/);
    assert.match(text, /AGENTIC_PLANNER_MODEL=openai\/gpt-4o-mini/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
