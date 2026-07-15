import type { OpenClawPluginApi, OpenClawPluginService, PluginConfig } from "./types.js";
import { SidecarManager } from "./sidecar/manager.js";

export function createBackendService(
  api: OpenClawPluginApi,
  config: PluginConfig,
  sidecar: SidecarManager,
): OpenClawPluginService {
  return {
    id: "agentic-orchestration-backend",
    async start(ctx) {
      api.logger.info("[agentic-orchestration] Service start: ensuring managed backend…");
      try {
        await sidecar.start(ctx.stateDir, (ctx.config ?? api.config) as Record<string, unknown>);
      } catch (err) {
        // Keep the plugin loaded; hooks will surface the error (or fall through).
        api.logger.error(
          `[agentic-orchestration] Service start error: ${(err as Error)?.message ?? String(err)}`,
        );
      }
    },
    async stop() {
      api.logger.info("[agentic-orchestration] Service stop: shutting down managed backend…");
      await sidecar.stop();
    },
  };
}
