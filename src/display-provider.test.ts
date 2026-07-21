import { test } from "node:test";
import { strict as assert } from "node:assert";
import { openAiCompatBaseUrl } from "./display-provider.js";

test("openAiCompatBaseUrl prefers endpoint host over backendPort", () => {
  assert.equal(
    openAiCompatBaseUrl({
      backendHost: "127.0.0.1",
      backendPort: 3847,
      endpoint: "http://127.0.0.1:30487/api/v1/orchestrate",
    }),
    "http://127.0.0.1:30487/v1",
  );
});

test("openAiCompatBaseUrl uses backendHost/backendPort when endpoint missing", () => {
  assert.equal(
    openAiCompatBaseUrl({
      backendHost: "127.0.0.1",
      backendPort: 30487,
      endpoint: "",
    }),
    "http://127.0.0.1:30487/v1",
  );
});

test("openAiCompatBaseUrl falls back to endpoint host when host/port unset", () => {
  assert.equal(
    openAiCompatBaseUrl({
      backendHost: "",
      backendPort: 0,
      endpoint: "http://10.0.0.5:9999/api/v1/orchestrate",
    }),
    "http://10.0.0.5:9999/v1",
  );
});
