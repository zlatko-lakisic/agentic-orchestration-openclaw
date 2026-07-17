import type { OpenClawPluginApi, PluginConfig } from "./types.js";
import {
  DISPLAY_PROVIDER_ID,
  DISPLAY_PROVIDER_LABEL,
  DisplayModelState,
  type DisplayModelState as DisplayModelStateType,
} from "./display-model.js";

type RegisterProviderFn = (provider: Record<string, unknown>) => void;

const LOCAL_API_KEY = "agentic-orchestration-local";

/**
 * OpenAI-compatible base URL for the AO web proxy (`/v1/chat/completions`).
 *
 * OpenClaw ≥ 2026.7 only runs `before_agent_reply` for cron on the embedded
 * agent path; user turns call this provider like a real OpenAI endpoint. Point
 * it at the same host/port as the orchestrate backend (managed `:3847` or
 * external NodePort / checkout port).
 */
export function openAiCompatBaseUrl(
  config: Pick<PluginConfig, "backendHost" | "backendPort" | "endpoint">,
): string {
  const host = (config.backendHost || "127.0.0.1").trim() || "127.0.0.1";
  const port = Number(config.backendPort) > 0 ? Number(config.backendPort) : 3847;
  if (config.backendHost || config.backendPort) {
    return `http://${host}:${port}/v1`;
  }
  try {
    const u = new URL(config.endpoint);
    return `${u.protocol}//${u.host}/v1`;
  } catch {
    return "http://127.0.0.1:3847/v1";
  }
}

/**
 * Registers the `agentic` provider so Control UI shows AgenticOrchestrator /
 * <current model>, and so OpenClaw can reach AO's OpenAI-compatible proxy when
 * the reply hook does not short-circuit (OpenClaw ≥ 2026.7 embedded path).
 */
export function registerDisplayProvider(
  api: OpenClawPluginApi,
  display: DisplayModelStateType,
  getConfig: () => PluginConfig,
): void {
  const register = (api as OpenClawPluginApi & { registerProvider?: RegisterProviderFn })
    .registerProvider;
  if (typeof register !== "function") {
    api.logger.warn?.(
      "[agentic-orchestration] api.registerProvider unavailable; UI will keep showing the OpenClaw default model.",
    );
    return;
  }

  const baseUrl = () => openAiCompatBaseUrl(getConfig());

  register.call(api, {
    id: DISPLAY_PROVIDER_ID,
    label: DISPLAY_PROVIDER_LABEL,
    envVars: [],
    auth: [],
    // Always "configured" — orchestrator owns routing; paste local key for OpenClaw auth store.
    isConfigured: () => true,
    catalog: {
      order: "simple",
      run: async () => ({
        provider: {
          baseUrl: baseUrl(),
          api: "openai-completions",
          apiKey: LOCAL_API_KEY,
          models: [display.catalogEntry()],
        },
      }),
    },
    staticCatalog: {
      order: "simple",
      run: async () => ({
        provider: {
          baseUrl: baseUrl(),
          api: "openai-completions",
          apiKey: LOCAL_API_KEY,
          models: [display.catalogEntry()],
        },
      }),
    },
    resolveDynamicModel: ({ modelId }: { modelId?: string }) => {
      const id = modelId || display.id;
      return {
        id,
        name: id === display.id ? display.label : id,
        provider: DISPLAY_PROVIDER_ID,
        api: "openai-completions",
        baseUrl: baseUrl(),
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128_000,
        maxTokens: 8192,
      };
    },
    buildUnknownModelHint: () =>
      "Agentic Orchestration owns model selection. The Control UI shows the active orchestrator model; picking other providers is ignored while this plugin is enabled.",
  });

  api.logger.info(
    `[agentic-orchestration] Registered display provider ${DISPLAY_PROVIDER_LABEL} (current model=${display.id}, openaiBase=${baseUrl()})`,
  );
}

export type { DisplayModelStateType };
export { DisplayModelState };
