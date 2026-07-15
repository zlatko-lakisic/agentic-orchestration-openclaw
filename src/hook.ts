import type {
  AgentHookContext,
  BeforeAgentReplyEvent,
  BeforeAgentReplyResult,
  BeforeResetEvent,
  OpenClawPluginApi,
  PluginConfig,
} from "./types.js";
import { AgenticOrchestrationClient } from "./client.js";
import type { SidecarManager } from "./sidecar/manager.js";

/**
 * Registers before_agent_reply (and before_reset for session continuity).
 *
 * Returning { handled: true, reply: { text } } short-circuits OpenClaw's native model call.
 * Returning undefined / void lets OpenClaw proceed with its own LLM.
 *
 * Non-bundled plugins need:
 *   plugins.entries.agentic-orchestration.hooks.allowConversationAccess = true
 */
export function registerAgentReplyHook(
  api: OpenClawPluginApi,
  getConfig: () => PluginConfig,
  sidecar?: SidecarManager,
): void {
  const resetPending = new Set<string>();

  api.on("before_reset", async (_event: BeforeResetEvent, ctx: AgentHookContext) => {
    const key = ctx.sessionKey;
    if (key) {
      resetPending.add(key);
      api.logger.info(`[agentic-orchestration] Session marked for reset: ${key}`);
    }
  });

  api.on(
    "before_agent_reply",
    async (event: BeforeAgentReplyEvent, ctx: AgentHookContext): Promise<BeforeAgentReplyResult | void> => {
      const text = event.cleanedBody?.trim();
      if (!text) return;

      const config = getConfig();
      const client = new AgenticOrchestrationClient(config);

      if (sidecar && config.managedBackend && !sidecar.isReady) {
        const detail = sidecar.error || "backend is still starting or failed to start";
        if (config.fallbackOnError) return;
        return {
          handled: true,
          reply: {
            text: `⚠️ Agentic orchestration backend is not ready: ${detail}`,
          },
          reason: "agentic-orchestration-not-ready",
        };
      }

      const sessionKey = ctx.sessionKey;
      const sessionId = config.sessionPassthrough ? (sessionKey ?? undefined) : undefined;
      const resetSession = Boolean(sessionKey && resetPending.has(sessionKey));
      if (resetSession && sessionKey) {
        resetPending.delete(sessionKey);
      }

      let output: string;
      try {
        output = await client.orchestrate({
          text,
          sessionId,
          resetSession: resetSession || undefined,
          runMode: config.runMode,
          verboseCrew: config.verboseCrew,
        });
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        api.logger.error(`[agentic-orchestration] Hook error: ${msg}`);

        if (config.fallbackOnError) {
          return;
        }

        const base = config.endpoint.replace(/\/api\/v1\/orchestrate\/?$/i, "");
        return {
          handled: true,
          reply: {
            text: `⚠️ Agentic orchestration error: ${msg}\n\nManaged backend should auto-start with this plugin. Check OpenClaw logs, or set managedBackend=false and run agentic-orchestration-web yourself at ${base || config.endpoint}.`,
          },
          reason: "agentic-orchestration-error",
        };
      }

      return {
        handled: true,
        reply: { text: output },
        reason: "agentic-orchestration",
      };
    },
    {
      priority: 100,
      timeoutMs: getConfig().timeoutMs + 5_000,
    },
  );
}
