import { spawn, type ChildProcess } from "node:child_process";
import type { PluginConfig } from "../types.js";
import { DEFAULT_BACKEND_HOST, DEFAULT_BACKEND_PORT, resolveManagedBaseUrl } from "./paths.js";

type Logger = {
  info: (m: string) => void;
  error: (m: string) => void;
  warn?: (m: string) => void;
};

export async function isBackendHealthy(baseUrl: string, timeoutMs = 2_000): Promise<boolean> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/ping`, {
      signal: controller.signal,
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: boolean };
    return body.ok === true;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

export async function waitForBackendHealthy(params: {
  baseUrl: string;
  timeoutMs: number;
  logger: Logger;
}): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < params.timeoutMs) {
    if (await isBackendHealthy(params.baseUrl)) {
      params.logger.info(`[agentic-orchestration] Backend healthy at ${params.baseUrl}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error(
    `Backend did not become healthy at ${params.baseUrl} within ${params.timeoutMs}ms`,
  );
}

export class BackendProcess {
  private child: ChildProcess | null = null;
  private owned = false;

  constructor(
    private readonly config: PluginConfig,
    private readonly logger: Logger,
  ) {}

  get isOwned(): boolean {
    return this.owned && this.child != null && !this.child.killed;
  }

  async start(params: {
    webDir: string;
    toolDir: string;
    pythonPath: string;
  }): Promise<{ reusedExisting: boolean }> {
    const baseUrl = resolveManagedBaseUrl(this.config);
    if (await isBackendHealthy(baseUrl)) {
      this.logger.info(
        `[agentic-orchestration] Backend already running at ${baseUrl}; reusing it.`,
      );
      this.owned = false;
      return { reusedExisting: true };
    }

    const host = this.config.backendHost || DEFAULT_BACKEND_HOST;
    const port = String(this.config.backendPort || DEFAULT_BACKEND_PORT);

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      AGENTIC_WEB_HOST: host,
      AGENTIC_WEB_PORT: port,
      AGENTIC_PYTHON: params.pythonPath,
      AGENTIC_TOOL_ROOT: params.toolDir,
      AGENTIC_WEB_AUTO_INSTALL_REQUIREMENTS: "1",
      AGENTIC_AUTO_ENSURE_RUNTIME: process.env.AGENTIC_AUTO_ENSURE_RUNTIME || "1",
    };
    if (this.config.apiKey) {
      env.AGENTIC_ORCHESTRATE_API_KEY = this.config.apiKey;
    }

    this.logger.info(
      `[agentic-orchestration] Starting agentic-orchestration-web on ${host}:${port}`,
    );

    this.child = spawn("node", ["server.mjs"], {
      cwd: params.webDir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });
    this.owned = true;

    const pipe = (buf: Buffer, level: "info" | "error") => {
      const text = buf.toString("utf8").trimEnd();
      if (!text) return;
      for (const line of text.split(/\r?\n/)) {
        if (level === "error") this.logger.error(`[agentic-web] ${line}`);
        else this.logger.info(`[agentic-web] ${line}`);
      }
    };
    this.child.stdout?.on("data", (b: Buffer) => pipe(b, "info"));
    this.child.stderr?.on("data", (b: Buffer) => pipe(b, "error"));
    this.child.on("exit", (code, signal) => {
      this.logger.warn?.(
        `[agentic-orchestration] Backend exited (code=${code} signal=${signal ?? ""})`,
      );
      this.child = null;
      this.owned = false;
    });

    await waitForBackendHealthy({
      baseUrl,
      timeoutMs: this.config.bootstrapTimeoutMs,
      logger: this.logger,
    });

    return { reusedExisting: false };
  }

  async stop(): Promise<void> {
    if (!this.owned || !this.child) return;
    const child = this.child;
    this.owned = false;
    this.child = null;
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      child.once("exit", done);
      try {
        child.kill("SIGTERM");
      } catch {
        done();
        return;
      }
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
        done();
      }, 5_000).unref?.();
    });
  }
}
