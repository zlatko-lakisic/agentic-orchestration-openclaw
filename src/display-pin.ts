import type { OpenClawPluginApi } from "./types.js";
import {
  DISPLAY_MODEL_ALLOWLIST_KEY,
  DISPLAY_PROVIDER_ID,
  DisplayModelState,
} from "./display-model.js";

type MutableConfig = Record<string, unknown>;

function asRecord(v: unknown): MutableConfig | undefined {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as MutableConfig) : undefined;
}

/**
 * Pin OpenClaw's configured primary + allowlist to AgenticOrchestrator so the
 * picker/footer stop advertising ChatGPT. Selection of other providers is also
 * overridden at before_model_resolve.
 */
export async function pinDisplayModelInConfig(
  api: OpenClawPluginApi,
  display: DisplayModelState,
): Promise<void> {
  const runtime = (api as OpenClawPluginApi & {
    runtime?: {
      config?: {
        mutateConfigFile?: (opts: {
          afterWrite: { mode: string; reason?: string };
          mutate: (draft: MutableConfig) => void;
        }) => Promise<unknown>;
        current?: () => MutableConfig;
      };
      agent?: {
        session?: {
          listSessionEntries?: (opts?: { agentId?: string }) => Array<{
            sessionKey: string;
            entry?: MutableConfig;
          }>;
          patchSessionEntry?: (opts: {
            agentId?: string;
            sessionKey: string;
            preserveActivity?: boolean;
            update: (entry: MutableConfig) => MutableConfig;
          }) => Promise<unknown>;
        };
      };
    };
  }).runtime;

  const ref = display.ref;
  const modelId = display.id;

  const mutate = runtime?.config?.mutateConfigFile;
  if (typeof mutate === "function") {
    try {
      await mutate({
        afterWrite: { mode: "auto", reason: "agentic-orchestration display pin" },
        mutate(draft) {
          const agents = asRecord(draft.agents) ?? {};
          draft.agents = agents;
          const defaults = asRecord(agents.defaults) ?? {};
          agents.defaults = defaults;

          // Remember prior primary once so we can document it in logs (not auto-restored).
          const prev = defaults.model;
          defaults.model = { primary: ref };
          // Replace allowlist so ChatGPT / stale agentic-* refs disappear from the picker.
          defaults.models = {
            [DISPLAY_MODEL_ALLOWLIST_KEY]: {},
            [ref]: {},
          };

          api.logger.info(
            `[agentic-orchestration] Pinned agents.defaults.model → ${ref}` +
              (prev ? ` (was ${JSON.stringify(prev)})` : ""),
          );
        },
      });
    } catch (err) {
      api.logger.warn?.(
        `[agentic-orchestration] Could not pin config model: ${(err as Error)?.message ?? err}`,
      );
    }
  } else {
    api.logger.warn?.(
      "[agentic-orchestration] api.runtime.config.mutateConfigFile unavailable; set agents.defaults.model manually to agentic-orchestration/<model>.",
    );
  }

  await syncSessionsToDisplayModel(api, display);
}

/** Update session rows so the footer shows AgenticOrchestrator / current model. */
export async function syncSessionsToDisplayModel(
  api: OpenClawPluginApi,
  display: DisplayModelState,
  sessionKey?: string,
): Promise<void> {
  const sessionApi = (
    api as OpenClawPluginApi & {
      runtime?: {
        agent?: {
          session?: {
            listSessionEntries?: (opts?: { agentId?: string }) => Array<{
              sessionKey: string;
            }>;
            patchSessionEntry?: (opts: {
              agentId?: string;
              sessionKey: string;
              preserveActivity?: boolean;
              update: (entry: Record<string, unknown>) => Record<string, unknown>;
            }) => Promise<unknown>;
          };
        };
      };
    }
  ).runtime?.agent?.session;

  const patch = sessionApi?.patchSessionEntry;
  if (typeof patch !== "function") return;

  const modelId = display.id;
  const keys: string[] = [];
  if (sessionKey) {
    keys.push(sessionKey);
  } else if (typeof sessionApi?.listSessionEntries === "function") {
    try {
      for (const row of sessionApi.listSessionEntries() || []) {
        if (row?.sessionKey) keys.push(row.sessionKey);
      }
    } catch {
      /* ignore */
    }
  }

  for (const key of keys) {
    try {
      await patch({
        sessionKey: key,
        preserveActivity: true,
        update: (entry) => ({
          ...entry,
          providerOverride: DISPLAY_PROVIDER_ID,
          modelOverride: modelId,
          modelOverrideSource: "auto",
          model: modelId,
          modelProvider: DISPLAY_PROVIDER_ID,
        }),
      });
    } catch (err) {
      api.logger.warn?.(
        `[agentic-orchestration] Session display pin failed for ${key}: ${(err as Error)?.message ?? err}`,
      );
    }
  }
}
