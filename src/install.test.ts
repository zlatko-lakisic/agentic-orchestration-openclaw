import { test } from "node:test";
import { strict as assert } from "node:assert";
import { archiveUrlFromRepoUrl, findPythonOnPath } from "./sidecar/install.js";

test("archiveUrlFromRepoUrl maps github git URLs", () => {
  assert.equal(
    archiveUrlFromRepoUrl("https://github.com/zlatko-lakisic/agentic-orchestration.git"),
    "https://github.com/zlatko-lakisic/agentic-orchestration/archive/refs/heads/main.tar.gz",
  );
  assert.equal(
    archiveUrlFromRepoUrl("https://github.com/zlatko-lakisic/agentic-orchestration"),
    "https://github.com/zlatko-lakisic/agentic-orchestration/archive/refs/heads/main.tar.gz",
  );
});

test("findPythonOnPath returns a string or undefined", () => {
  const p = findPythonOnPath();
  assert.ok(p === undefined || typeof p === "string");
});
