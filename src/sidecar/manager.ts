import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { BridgeHub } from "../bridge/control-server.js";
import { startBridgeHub } from "../bridge/control-server.js";
import { writeOpenClawBridgeProvider } from "../bridge/provider-yaml.js";
import type { OpenClawPluginApi, PluginConfig } from "../types.js";
import { resolveAgentEnv, writeToolEnvFile } from "./credentials.js";
import { ensureSidecarInstalled } from "./install.js";
import {
  mergeExtraMcpProvidersPath,
  OPENCLAW_MCP_CATALOG_DIRNAME,
  syncOpenClawMcpProviders,
} from "./openclaw-mcp-sync.js";
import { resolveDataRoot, resolveManagedEndpoint } from "./paths.js";
import { BackendProcess } from "./process.js";

export class SidecarManager {
  private backend: BackendProcess | null = null;
  private bridge: BridgeHub | null = null;
  private ready = false;
  private lastError: string | undefined;
  private effectiveConfig: PluginConfig;
  private stateDir: string | undefined;

  constructor(
    private readonly api: OpenClawPluginApi,
    config: PluginConfig,
  ) {
    this.effectiveConfig = { ...config };
  }

  get config(): PluginConfig {
    return this.effectiveConfig;
  }

  get isReady(): boolean {
    return this.ready;
  }

  get error(): string | undefined {
    return this.lastError;
  }

  get bridgeHub(): BridgeHub | null {
    return this.bridge;
  }

  setBridgeSessionKey(sessionKey?: string): void {
    this.bridge?.setSessionKey(sessionKey);
  }

  async start(stateDir: string, openClawConfig?: Record<string, unknown>): Promise<void> {
    this.stateDir = stateDir;
    const dataRoot = resolveDataRoot(stateDir, this.effectiveConfig);

    if (this.effectiveConfig.syncOpenClawMcp) {
      // Always materialize fragments so operators can point an external AO at the same dir.
      syncOpenClawMcpProviders({
        dataRoot,
        openClawConfig,
        logger: this.api.logger,
      });
    }

    if (this.effectiveConfig.bridgeOpenClawTools) {
      await this.ensureBridge(dataRoot);
    }

    if (!this.effectiveConfig.managedBackend) {
      this.ready = true;
      this.api.logger.info(
        `[agentic-orchestration] managedBackend=false; expecting external server at ${this.effectiveConfig.endpoint}` +
          (this.effectiveConfig.syncOpenClawMcp
            ? `; OpenClaw MCP fragments at ${path.join(dataRoot, OPENCLAW_MCP_CATALOG_DIRNAME)}`
            : ""),
      );
      return;
    }

    // Point the HTTP client at the managed URL unless the user set a custom endpoint
    // that is not the default managed path (still overwrite when using managed mode).
    this.effectiveConfig = {
      ...this.effectiveConfig,
      endpoint: resolveManagedEndpoint(this.effectiveConfig),
    };

    this.backend = new BackendProcess(this.effectiveConfig, this.api.logger);

    try {
      const ensured = await ensureSidecarInstalled({
        dataRoot,
        config: this.effectiveConfig,
        pluginRootDir: this.api.rootDir,
        logger: this.api.logger,
      });

      const envMap = resolveAgentEnv({
        openClawConfig,
        stateDir,
        logger: this.api.logger,
      });

      if (this.effectiveConfig.syncOpenClawMcp || this.effectiveConfig.bridgeOpenClawTools) {
        const catalogDir = path.join(dataRoot, OPENCLAW_MCP_CATALOG_DIRNAME);
        envMap.AGENTIC_EXTRA_MCP_PROVIDERS_PATH = mergeExtraMcpProvidersPath(
          envMap.AGENTIC_EXTRA_MCP_PROVIDERS_PATH ||
            process.env.AGENTIC_EXTRA_MCP_PROVIDERS_PATH,
          catalogDir,
        );
      }

      writeToolEnvFile(ensured.toolDir, envMap, this.api.logger);

      const { reusedExisting } = await this.backend.start({
        webDir: ensured.webDir,
        toolDir: ensured.toolDir,
        pythonPath: ensured.pythonPath,
        pluginRootDir: this.api.rootDir,
        // Pass planner/Ollama vars into the worker so keep-alive and LiteLLM see them
        // before dotenv (tool .env alone is not enough for process.env at boot).
        extraEnv: envMap,
      });

      this.ready = true;
      this.lastError = undefined;
      this.api.logger.info(
        `[agentic-orchestration] Managed backend ready at ${this.effectiveConfig.endpoint}` +
          (reusedExisting ? " (reused existing process)" : "") +
          (ensured.fromLocalCheckout ? " (local checkout)" : ""),
      );
    } catch (err) {
      this.ready = false;
      this.lastError = (err as Error)?.message ?? String(err);
      this.api.logger.error(`[agentic-orchestration] Managed backend failed: ${this.lastError}`);
      throw err;
    }
  }

  private async ensureBridge(dataRoot: string): Promise<void> {
    if (!this.bridge) {
      this.bridge = await startBridgeHub({
        api: this.api,
        port: this.effectiveConfig.bridgePort,
      });
    }
    const pluginRoot =
      this.api.rootDir ||
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
    writeOpenClawBridgeProvider({
      dataRoot,
      pluginRootDir: pluginRoot,
      bridgeUrl: this.bridge.baseUrl,
      bridgeToken: this.bridge.token,
    });
    this.api.logger.info(
      `[agentic-orchestration] Wrote openclaw_bridge MCP provider (port ${this.bridge.port})`,
    );
  }

  async stop(): Promise<void> {
    if (this.backend) {
      await this.backend.stop();
      this.backend = null;
    }
    if (this.bridge) {
      await this.bridge.stop();
      this.bridge = null;
    }
    this.ready = false;
  }
}
