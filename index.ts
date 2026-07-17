import { resolveConfig } from "./src/config.js";
import { DisplayModelState } from "./src/display-model.js";
import { registerDisplayProvider } from "./src/display-provider.js";
import { registerAgentReplyHook } from "./src/hook.js";
import { createBackendService } from "./src/service.js";
import { SidecarManager } from "./src/sidecar/manager.js";
import type { OpenClawPluginApi, PluginConfigSchema } from "./src/types.js";

/**
 * Mirrors openclaw/plugin-sdk definePluginEntry without a hard runtime dep on
 * the full openclaw package (peer). Gateway loaders accept this shape.
 */
function emptyPluginConfigSchema(): PluginConfigSchema {
  return {
    safeParse(value: unknown) {
      return { success: true, data: value ?? {} };
    },
  };
}

function definePluginEntry(def: {
  id: string;
  name: string;
  description: string;
  configSchema?: PluginConfigSchema | (() => PluginConfigSchema);
  register: (api: OpenClawPluginApi) => void;
}) {
  const getConfigSchema = (() => {
    let resolved: PluginConfigSchema | undefined;
    return () => {
      if (!resolved) {
        const raw = def.configSchema ?? emptyPluginConfigSchema;
        resolved = typeof raw === "function" ? raw() : raw;
      }
      return resolved;
    };
  })();

  return {
    id: def.id,
    name: def.name,
    description: def.description,
    get configSchema() {
      return getConfigSchema();
    },
    register: def.register,
  };
}

export default definePluginEntry({
  id: "agentic-orchestration",
  name: "Agentic Orchestration",
  description:
    "Routes OpenClaw agent turns through a deterministic multi-agent backend (CrewAI, model-agnostic, MCP-capable). Auto-installs and starts the backend sidecar by default.",
  configSchema: emptyPluginConfigSchema,

  register(api) {
    const initial = resolveConfig(api.pluginConfig as Record<string, unknown>);
    const sidecar = new SidecarManager(api, initial);
    const display = new DisplayModelState();

    api.logger.info(
      `[agentic-orchestration] Plugin loaded. managedBackend=${initial.managedBackend} | endpoint=${initial.endpoint} | runMode=${initial.runMode}`,
    );

    registerDisplayProvider(api, display);

    if (typeof api.registerService === "function") {
      api.registerService(createBackendService(api, initial, sidecar, display));
    } else {
      api.logger.warn?.(
        "[agentic-orchestration] api.registerService unavailable; managed backend will not auto-start. Start agentic-orchestration-web manually or upgrade OpenClaw.",
      );
    }

    registerAgentReplyHook(api, () => sidecar.config, sidecar, display);
  },
});
