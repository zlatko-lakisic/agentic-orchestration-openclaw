import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import type { PluginConfig } from "../types.js";

export const DEFAULT_REPO_URL = "https://github.com/zlatko-lakisic/agentic-orchestration.git";
export const DEFAULT_BACKEND_HOST = "127.0.0.1";
export const DEFAULT_BACKEND_PORT = 3847;

/** Prefer IPv4 loopback — Node often resolves `localhost` to ::1 first, and the managed server binds IPv4-only. */
export function normalizeLoopbackUrl(url: string): string {
  return url.replace(/:\/\/localhost(?=[:/]|$)/gi, "://127.0.0.1");
}

export function resolveDataRoot(stateDir: string, config: PluginConfig): string {
  if (config.installDir) {
    return path.resolve(config.installDir);
  }
  return path.join(stateDir, "agentic-orchestration");
}

export function resolveRepoDir(dataRoot: string): string {
  return path.join(dataRoot, "repo");
}

export function resolveToolDir(repoDir: string): string {
  return path.join(repoDir, "agentic-orchestration-tool");
}

export function resolveWebDir(repoDir: string): string {
  return path.join(repoDir, "agentic-orchestration-web");
}

export function resolveManagedEndpoint(config: PluginConfig): string {
  const host = config.backendHost || DEFAULT_BACKEND_HOST;
  const port = config.backendPort || DEFAULT_BACKEND_PORT;
  return normalizeLoopbackUrl(`http://${host}:${port}/api/v1/orchestrate`);
}

export function resolveManagedBaseUrl(config: PluginConfig): string {
  const host = config.backendHost || DEFAULT_BACKEND_HOST;
  const port = config.backendPort || DEFAULT_BACKEND_PORT;
  return normalizeLoopbackUrl(`http://${host}:${port}`);
}

/** Prefer an existing checkout when developing next to this plugin. */
export function findLocalCheckout(pluginRootDir?: string): string | undefined {
  const candidates: string[] = [];
  if (pluginRootDir) {
    candidates.push(path.resolve(pluginRootDir, "..", "agentic-orchestration"));
    candidates.push(path.resolve(pluginRootDir, "..", "..", "agentic-orchestration"));
  }
  const envRoot = process.env.AGENTIC_ORCHESTRATION_ROOT?.trim();
  if (envRoot) candidates.unshift(path.resolve(envRoot));

  const home = os.homedir();
  candidates.push(path.join(home, "Projects", "agentic-orchestration"));

  for (const c of candidates) {
    if (
      fs.existsSync(path.join(c, "agentic-orchestration-web", "server.mjs")) &&
      fs.existsSync(path.join(c, "agentic-orchestration-tool", "main.py"))
    ) {
      return c;
    }
  }
  return undefined;
}
