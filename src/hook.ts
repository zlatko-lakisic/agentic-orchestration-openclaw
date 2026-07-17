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
import { isBackendHealthy } from "./sidecar/process.js";
import { DISPLAY_PROVIDER_ID, type DisplayModelState } from "./display-model.js";
import { syncSessionsToDisplayModel } from "./display-pin.js";
import {
  buildOpenClawContextPreamble,
  composeOrchestrateText,
  shouldFallthroughAutomation,
} from "./openclaw-context.js";

function isSimpleUserTurn(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 120) return false;
  if (/\n/.test(t)) return false;
  return /^(who are you\??|what are you\??|hello!*|hi!*|hey!*|help\??|what can you do\??|thanks!?|thank you\.?)$/i.test(
    t,
  );
}

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
  display?: DisplayModelState,
): void {
  const resetPending = new Set<string>();

  api.on("before_reset", async (_event: BeforeResetEvent, ctx: AgentHookContext) => {
    const key = ctx.sessionKey;
    if (key) {
      resetPending.add(key);
      api.logger.info(`[agentic-orchestration] Session marked for reset: ${key}`);
    }
  });

  // Keep Control UI on AgenticOrchestrator even if the user picks ChatGPT in the panel.
  api.on(
    "before_model_resolve",
    async () => {
      if (!display) return;
      return {
        providerOverride: DISPLAY_PROVIDER_ID,
        modelOverride: display.id,
      };
    },
    { priority: 100 },
  );

  api.on(
    "before_agent_reply",
    async (event: BeforeAgentReplyEvent, ctx: AgentHookContext): Promise<BeforeAgentReplyResult | void> => {
      const text = event.cleanedBody?.trim();
      if (!text) return;

      const config = getConfig();
      const sessionKey = ctx.sessionKey;

      if (shouldFallthroughAutomation(sessionKey, config.fallthroughAutomation)) {
        api.logger.info(
          `[agentic-orchestration] Falling through automation session to native OpenClaw: ${sessionKey}`,
        );
        return;
      }

      const client = new AgenticOrchestrationClient(config);

      // OpenClaw may load the plugin twice (gateway service + agent runtime pre-warm).
      // Only the service instance runs start(); the hook instance can still reach a
      // healthy managed backend via HTTP — probe before failing closed.
      if (sidecar && config.managedBackend && !sidecar.isReady) {
        const baseUrl = config.endpoint.replace(/\/api\/v1\/orchestrate\/?$/i, "") || "http://localhost:3847";
        const healthy = await isBackendHealthy(baseUrl, 2_000);
        if (!healthy) {
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
        api.logger.info(
          "[agentic-orchestration] Sidecar manager not marked ready, but HTTP backend is healthy; proceeding.",
        );
      }

      const sessionId = config.sessionPassthrough ? (sessionKey ?? undefined) : undefined;
      const resetSession = Boolean(sessionKey && resetPending.has(sessionKey));
      if (resetSession && sessionKey) {
        resetPending.delete(sessionKey);
      }

      sidecar?.setBridgeSessionKey(sessionKey);

      const openClawConfig =
        (typeof api.runtime?.config?.current === "function"
          ? api.runtime.config.current()
          : api.config) || undefined;

      const preamble =
        config.injectOpenClawContext && !isSimpleUserTurn(text)
          ? buildOpenClawContextPreamble({
              openClawConfig,
              workspaceDir: ctx.workspaceDir,
              sessionKey,
              agentId: ctx.agentId,
              channel: ctx.channel || ctx.channelId,
            })
          : undefined;
      const orchestrateText = composeOrchestrateText(text, preamble);

      display?.markRunning();
      if (display && sessionKey) {
        void syncSessionsToDisplayModel(api, display, sessionKey);
      }

      const started = Date.now();
      api.logger.info(
        `[agentic-orchestration] Orchestrating session=${sessionKey || "-"} chars=${orchestrateText.length}` +
          (isSimpleUserTurn(text) ? " simpleChat=1" : ""),
      );

      let output: string;
      try {
        output = await client.orchestrate({
          text: orchestrateText,
          sessionId,
          resetSession: resetSession || isSimpleUserTurn(text) || undefined,
          runMode: config.runMode,
          verboseCrew: config.verboseCrew,
          selectedAgentProviderIds: config.selectedAgentProviderIds,
        });
      } catch (err) {
        display?.markIdle();
        if (display && sessionKey) {
          void syncSessionsToDisplayModel(api, display, sessionKey);
        }
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

      display?.markIdle();
      if (display && sessionKey) {
        void syncSessionsToDisplayModel(api, display, sessionKey);
      }

      api.logger.info(
        `[agentic-orchestration] Orchestrate done session=${sessionKey || "-"} ` +
          `elapsed_ms=${Date.now() - started} reply_chars=${output.length}`,
      );

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
