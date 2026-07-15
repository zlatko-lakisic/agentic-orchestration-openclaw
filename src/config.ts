import type { PluginConfig } from "./types.js";
import { DEFAULT_BACKEND_HOST, DEFAULT_BACKEND_PORT, DEFAULT_REPO_URL } from "./sidecar/paths.js";

export function resolveConfig(raw: Record<string, unknown> | undefined | null): PluginConfig {
  const cfg = raw && typeof raw === "object" ? raw : {};
  return {
    endpoint:
      typeof cfg.endpoint === "string"
        ? cfg.endpoint
        : "http://127.0.0.1:3847/api/v1/orchestrate",
    apiKey: typeof cfg.apiKey === "string" ? cfg.apiKey : undefined,
    timeoutMs: typeof cfg.timeoutMs === "number" ? cfg.timeoutMs : 120_000,
    runMode: cfg.runMode === "dynamic-iterative" ? "dynamic-iterative" : "dynamic",
    sessionPassthrough: cfg.sessionPassthrough !== false,
    fallbackOnError: cfg.fallbackOnError === true,
    verboseCrew: cfg.verboseCrew === true,
    managedBackend: cfg.managedBackend !== false,
    repoUrl: typeof cfg.repoUrl === "string" ? cfg.repoUrl : DEFAULT_REPO_URL,
    installDir: typeof cfg.installDir === "string" ? cfg.installDir : undefined,
    preferLocalCheckout: cfg.preferLocalCheckout !== false,
    autoUpdate: cfg.autoUpdate !== false,
    backendHost: typeof cfg.backendHost === "string" ? cfg.backendHost : DEFAULT_BACKEND_HOST,
    backendPort: typeof cfg.backendPort === "number" ? cfg.backendPort : DEFAULT_BACKEND_PORT,
    bootstrapTimeoutMs:
      typeof cfg.bootstrapTimeoutMs === "number" ? cfg.bootstrapTimeoutMs : 600_000,
  };
}
