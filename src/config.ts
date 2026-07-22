import type { PluginConfig } from "./types.js";
import { DEFAULT_BACKEND_REF } from "./types.js";
import {
  DEFAULT_BACKEND_HOST,
  DEFAULT_BACKEND_PORT,
  DEFAULT_REPO_URL,
  normalizeLoopbackUrl,
} from "./sidecar/paths.js";

export function resolveConfig(raw: Record<string, unknown> | undefined | null): PluginConfig {
  const cfg = raw && typeof raw === "object" ? raw : {};
  const endpoint =
    typeof cfg.endpoint === "string"
      ? cfg.endpoint
      : `http://${DEFAULT_BACKEND_HOST}:${DEFAULT_BACKEND_PORT}/api/v1/orchestrate`;
  return {
    endpoint: normalizeLoopbackUrl(endpoint),
    apiKey: typeof cfg.apiKey === "string" ? cfg.apiKey : undefined,
    timeoutMs: typeof cfg.timeoutMs === "number" ? cfg.timeoutMs : 120_000,
    runMode: cfg.runMode === "dynamic-iterative" ? "dynamic-iterative" : "dynamic",
    sessionPassthrough: cfg.sessionPassthrough !== false,
    fallbackOnError: cfg.fallbackOnError === true,
    verboseCrew: cfg.verboseCrew === true,
    managedBackend: cfg.managedBackend !== false,
    repoUrl: typeof cfg.repoUrl === "string" ? cfg.repoUrl : DEFAULT_REPO_URL,
    backendRef:
      typeof cfg.backendRef === "string" && cfg.backendRef.trim()
        ? cfg.backendRef.trim()
        : DEFAULT_BACKEND_REF,
    installDir: typeof cfg.installDir === "string" ? cfg.installDir : undefined,
    preferLocalCheckout: cfg.preferLocalCheckout !== false,
    // Opt-in: floating re-download was a ClawHub supply-chain concern.
    autoUpdate: cfg.autoUpdate === true,
    // Opt-in: do not materialize discovered API keys into tool/.env by default.
    persistCredentials: cfg.persistCredentials === true,
    // Opt-in: do not walk auth-profiles.json trees unless explicitly enabled.
    discoverAuthProfiles: cfg.discoverAuthProfiles === true,
    backendHost: typeof cfg.backendHost === "string" ? cfg.backendHost : DEFAULT_BACKEND_HOST,
    backendPort: typeof cfg.backendPort === "number" ? cfg.backendPort : DEFAULT_BACKEND_PORT,
    bootstrapTimeoutMs:
      typeof cfg.bootstrapTimeoutMs === "number" ? cfg.bootstrapTimeoutMs : 600_000,
    selectedAgentProviderIds: Array.isArray(cfg.selectedAgentProviderIds)
      ? cfg.selectedAgentProviderIds.map((x) => String(x).trim()).filter(Boolean)
      : ["ollama_llama3_2_1b"],
    syncOpenClawMcp: cfg.syncOpenClawMcp !== false,
    injectOpenClawContext: cfg.injectOpenClawContext !== false,
    bridgeOpenClawTools: cfg.bridgeOpenClawTools !== false,
    bridgePort: typeof cfg.bridgePort === "number" ? cfg.bridgePort : 3848,
    fallthroughAutomation: cfg.fallthroughAutomation !== false,
  };
}
