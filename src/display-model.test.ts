import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  DISPLAY_PROVIDER_ID,
  DisplayModelState,
  displayModelRef,
  normalizeDisplayModelId,
} from "./display-model.js";

test("normalizeDisplayModelId strips provider prefixes", () => {
  assert.equal(normalizeDisplayModelId("ollama/llama3.2:1b"), "llama3.2:1b");
  assert.equal(normalizeDisplayModelId("openai/gpt-4o-mini"), "gpt-4o-mini");
  assert.equal(displayModelRef("ollama/llama3.2:1b"), `${DISPLAY_PROVIDER_ID}/llama3.2:1b`);
});

test("DisplayModelState tracks running label", () => {
  const d = new DisplayModelState();
  d.setPlannerModel("ollama/llama3.2:1b");
  assert.equal(d.id, "llama3.2:1b");
  assert.equal(d.label, "llama3.2:1b");
  d.markRunning();
  assert.equal(d.label, "llama3.2:1b (running)");
  d.markIdle("llama3.2:1b");
  assert.equal(d.label, "llama3.2:1b");
});
