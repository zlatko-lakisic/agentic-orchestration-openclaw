import type { OpenClawPluginApi, PluginConfig } from "../types.js";
import { resolveAgentEnv, writeToolEnvFile } from "./credentials.js";
import { ensureSidecarInstalled } from "./install.js";
import { resolveDataRoot, resolveManagedEndpoint } from "./paths.js";
import { BackendProcess } from "./process.js";

export class SidecarManager {
  private backend: BackendProcess | null = null;
  private ready = false;
  private lastError: string | undefined;
  private effectiveConfig: PluginConfig;

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

  async start(stateDir: string, openClawConfig?: Record<string, unknown>): Promise<void> {
    if (!this.effectiveConfig.managedBackend) {
      this.ready = true;
      this.api.logger.info(
        `[agentic-orchestration] managedBackend=false; expecting external server at ${this.effectiveConfig.endpoint}`,
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
    const dataRoot = resolveDataRoot(stateDir, this.effectiveConfig);

    try {
      const ensured = ensureSidecarInstalled({
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
      writeToolEnvFile(ensured.toolDir, envMap, this.api.logger);

      const { reusedExisting } = await this.backend.start({
        webDir: ensured.webDir,
        toolDir: ensured.toolDir,
        pythonPath: ensured.pythonPath,
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

  async stop(): Promise<void> {
    if (this.backend) {
      await this.backend.stop();
      this.backend = null;
    }
    this.ready = false;
  }
}
