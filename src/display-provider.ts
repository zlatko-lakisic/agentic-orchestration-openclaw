import type { OpenClawPluginApi } from "./types.js";
import {
  DISPLAY_PROVIDER_ID,
  DISPLAY_PROVIDER_LABEL,
  DisplayModelState,
  type DisplayModelState as DisplayModelStateType,
} from "./display-model.js";

type RegisterProviderFn = (provider: Record<string, unknown>) => void;

/**
 * Registers a display-only provider so Control UI shows
 * AgenticOrchestrator / <current model> instead of openai/gpt-5.5.
 *
 * Turns are still handled by before_agent_reply (short-circuit). This provider
 * exists for catalog/footer identity + allowlisting — it is not a real LLM API.
 */
export function registerDisplayProvider(
  api: OpenClawPluginApi,
  display: DisplayModelStateType,
): void {
  const register = (api as OpenClawPluginApi & { registerProvider?: RegisterProviderFn })
    .registerProvider;
  if (typeof register !== "function") {
    api.logger.warn?.(
      "[agentic-orchestration] api.registerProvider unavailable; UI will keep showing the OpenClaw default model.",
    );
    return;
  }

  register.call(api, {
    id: DISPLAY_PROVIDER_ID,
    label: DISPLAY_PROVIDER_LABEL,
    envVars: [],
    auth: [],
    // Always "configured" — no API key; orchestrator owns routing.
    isConfigured: () => true,
    catalog: {
      order: "simple",
      run: async () => ({
        provider: {
          baseUrl: "http://127.0.0.1:3847/v1",
          api: "openai-completions",
          apiKey: "agentic-orchestration-local",
          models: [display.catalogEntry()],
        },
      }),
    },
    staticCatalog: {
      order: "simple",
      run: async () => ({
        provider: {
          baseUrl: "http://127.0.0.1:3847/v1",
          api: "openai-completions",
          apiKey: "agentic-orchestration-local",
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
        baseUrl: "http://127.0.0.1:3847/v1",
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
    `[agentic-orchestration] Registered display provider ${DISPLAY_PROVIDER_LABEL} (current model=${display.id})`,
  );
}

export type { DisplayModelStateType };
export { DisplayModelState };
