export interface OrchestrateRequest {
  text: string;
  sessionId?: string;
  resetSession?: boolean;
  runMode?: "dynamic" | "dynamic-iterative";
  verboseCrew?: boolean;
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
  /** When true (default), clone/pull and spawn agentic-orchestration-web. */
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
    event: "before_reset",
    handler: (
      event: BeforeResetEvent,
      ctx: AgentHookContext,
    ) => Promise<void> | void,
    options?: { priority?: number; timeoutMs?: number },
  ): void;
}
