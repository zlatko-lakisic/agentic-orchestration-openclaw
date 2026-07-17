export interface OrchestrateRequest {
  text: string;
  sessionId?: string;
  resetSession?: boolean;
  runMode?: "dynamic" | "dynamic-iterative";
  verboseCrew?: boolean;
  /** Restrict planner catalog to these agent_provider ids (e.g. ollama_llama3_2_1b). */
  selectedAgentProviderIds?: string[];
}

export interface OrchestrateResponse {
  ok: true;
  output: string;
}

export interface OrchestrateErrorResponse {
  error: string;
  code?: number;
  stderr?: string;
}

export type AgentEnvMapping = Record<string, string>;

export interface PluginConfig {
  endpoint: string;
  apiKey?: string;
  timeoutMs: number;
  runMode: "dynamic" | "dynamic-iterative";
  sessionPassthrough: boolean;
  fallbackOnError: boolean;
  verboseCrew: boolean;
  /** When true (default), download/start agentic-orchestration-web as a managed worker. */
  managedBackend: boolean;
  repoUrl: string;
  /** Override install root (defaults to `<openclaw-state>/agentic-orchestration`). */
  installDir?: string;
  /** Prefer a sibling/local checkout when found. Default true. */
  preferLocalCheckout: boolean;
  /** git fetch/reset on start when using cloned repo. Default true. */
  autoUpdate: boolean;
  backendHost: string;
  backendPort: number;
  /** Max wait for clone + deps + health check. */
  bootstrapTimeoutMs: number;
  /**
   * Optional catalog restriction for dynamic planning (agent_provider ids).
   * When unset, the managed backend uses AGENTIC_OPENAI_PROXY_DYNAMIC_AGENT_PROVIDER_IDS from .env.
   */
  selectedAgentProviderIds?: string[];
  /**
   * When true (default), map OpenClaw `mcp.servers` into AO MCP provider YAML
   * fragments and expose them via AGENTIC_EXTRA_MCP_PROVIDERS_PATH.
   */
  syncOpenClawMcp: boolean;
  /** Inject OpenClaw workspace bootstrap/memory/skills into orchestrate text. Default true. */
  injectOpenClawContext: boolean;
  /** Host loopback MCP bridge for browser/exec/nodes/memory. Default true. */
  bridgeOpenClawTools: boolean;
  /** Loopback port for the bridge control plane. Default 3848. */
  bridgePort: number;
  /** Do not short-circuit cron/heartbeat sessions (let native OpenClaw handle them). Default true. */
  fallthroughAutomation: boolean;
}

/** Matches OpenClaw PluginHookBeforeAgentReplyEvent (2026.7.x). */
export interface BeforeAgentReplyEvent {
  cleanedBody: string;
}

/** Matches OpenClaw PluginHookAgentContext (subset). */
export interface AgentHookContext {
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  channelId?: string;
  channel?: string;
  senderId?: string;
  workspaceDir?: string;
}

/** Matches OpenClaw PluginHookBeforeAgentReplyResult. */
export interface BeforeAgentReplyResult {
  handled: boolean;
  reply?: { text?: string };
  reason?: string;
}

export interface BeforeResetEvent {
  sessionFile?: string;
  messages?: unknown[];
  reason?: string;
}

export interface PluginConfigSchema {
  safeParse: (value: unknown) => { success: boolean; data?: unknown; error?: unknown };
}

export interface OpenClawPluginServiceContext {
  config?: Record<string, unknown>;
  stateDir: string;
  workspaceDir?: string;
  logger: {
    info: (message: string) => void;
    error: (message: string) => void;
    warn?: (message: string) => void;
  };
}

export interface OpenClawPluginService {
  id: string;
  start: (ctx: OpenClawPluginServiceContext) => void | Promise<void>;
  stop?: (ctx: OpenClawPluginServiceContext) => void | Promise<void>;
}

/** Minimal shape for OpenClaw plugin API used by this plugin. */
export interface OpenClawPluginApi {
  pluginConfig?: Record<string, unknown>;
  config?: Record<string, unknown>;
  rootDir?: string;
  logger: {
    info: (message: string) => void;
    error: (message: string) => void;
    warn?: (message: string) => void;
  };
  registerService?: (service: OpenClawPluginService) => void;
  on(
    event: "before_agent_reply",
    handler: (
      event: BeforeAgentReplyEvent,
      ctx: AgentHookContext,
    ) => Promise<BeforeAgentReplyResult | void> | BeforeAgentReplyResult | void,
    options?: { priority?: number; timeoutMs?: number },
  ): void;
  on(
    event: "before_model_resolve",
    handler: (
      event: unknown,
      ctx: AgentHookContext,
    ) =>
      | Promise<{ modelOverride?: string; providerOverride?: string } | void>
      | { modelOverride?: string; providerOverride?: string }
      | void,
    options?: { priority?: number; timeoutMs?: number },
  ): void;
  on(
    event: "before_reset",
    handler: (
      event: BeforeResetEvent,
      ctx: AgentHookContext,
    ) => Promise<void> | void,
    options?: { priority?: number; timeoutMs?: number },
  ): void;
  registerProvider?: (provider: Record<string, unknown>) => void;
  runtime?: {
    config?: {
      mutateConfigFile?: (opts: {
        afterWrite: { mode: string; reason?: string };
        mutate: (draft: Record<string, unknown>) => void;
      }) => Promise<unknown>;
      current?: () => Record<string, unknown>;
    };
    gateway?: {
      request?: (
        method: string,
        params?: Record<string, unknown>,
        options?: { timeoutMs?: number },
      ) => Promise<unknown>;
    };
    nodes?: {
      list?: (opts?: Record<string, unknown>) => Promise<unknown> | unknown;
      invoke?: (opts?: Record<string, unknown>) => Promise<unknown> | unknown;
    };
    agent?: {
      session?: {
        listSessionEntries?: (opts?: { agentId?: string }) => Array<{ sessionKey: string }>;
        patchSessionEntry?: (opts: {
          agentId?: string;
          sessionKey: string;
          preserveActivity?: boolean;
          update: (entry: Record<string, unknown>) => Record<string, unknown>;
        }) => Promise<unknown>;
      };
      resolveAgentWorkspaceDir?: (cfg: Record<string, unknown>, agentId?: string) => string;
    };
  };
}
