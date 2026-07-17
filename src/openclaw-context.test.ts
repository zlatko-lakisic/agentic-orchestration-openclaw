import { test } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildOpenClawContextPreamble,
  composeOrchestrateText,
  shouldFallthroughAutomation,
} from "./openclaw-context.js";

test("shouldFallthroughAutomation detects cron/heartbeat", () => {
  assert.equal(shouldFallthroughAutomation("agent:main:cron:job1"), true);
  assert.equal(shouldFallthroughAutomation("agent:main:heartbeat"), true);
  assert.equal(shouldFallthroughAutomation("agent:main:dashboard:abc"), false);
  assert.equal(shouldFallthroughAutomation("agent:main:cron:job1", false), false);
});

test("buildOpenClawContextPreamble includes bootstrap files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ao-ctx-"));
  try {
    fs.writeFileSync(path.join(root, "AGENTS.md"), "Be helpful.");
    fs.writeFileSync(path.join(root, "SOUL.md"), "Calm tone.");
    fs.mkdirSync(path.join(root, "skills", "demo"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "skills", "demo", "SKILL.md"),
      "---\ndescription: Demo skill\n---\n# Demo\n",
    );
    const preamble = buildOpenClawContextPreamble({
      workspaceDir: root,
      sessionKey: "agent:main:chat",
    });
    assert.match(preamble, /AGENTS\.md/);
    assert.match(preamble, /Be helpful/);
    assert.match(preamble, /demo:/);
    assert.match(preamble, /openclaw_bridge/);
    const composed = composeOrchestrateText("Hello", preamble);
    assert.match(composed, /User message:\nHello$/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
