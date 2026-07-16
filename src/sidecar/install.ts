import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as tar from "tar";
import { DEFAULT_REPO_URL, findLocalCheckout, resolveRepoDir, resolveToolDir, resolveWebDir } from "./paths.js";
import { ensureOrchestrateEndpoint } from "./inject-orchestrate.js";
import type { PluginConfig } from "../types.js";

type Logger = {
  info: (m: string) => void;
  error: (m: string) => void;
  warn?: (m: string) => void;
};

/** Map a GitHub repo URL to the main-branch source archive (no git binary required). */
export function archiveUrlFromRepoUrl(repoUrl: string): string {
  const cleaned = repoUrl.trim().replace(/\.git$/i, "");
  const m = cleaned.match(/github\.com[/:]([^/]+)\/([^/#?]+)/i);
  if (!m) {
    throw new Error(`Cannot derive GitHub archive URL from repoUrl: ${repoUrl}`);
  }
  const owner = m[1];
  const repo = m[2].replace(/\.git$/i, "");
  return `https://github.com/${owner}/${repo}/archive/refs/heads/main.tar.gz`;
}

async function downloadAndExtractArchive(
  archiveUrl: string,
  repoDir: string,
  logger: Logger,
): Promise<void> {
  logger.info(`[agentic-orchestration] Downloading ${archiveUrl}`);
  const res = await fetch(archiveUrl, { redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download backend archive (${res.status} ${res.statusText}): ${archiveUrl}`);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ao-backend-"));
  try {
    await pipeline(Readable.fromWeb(res.body as never), createGunzip(), tar.x({ cwd: tmp }));
    const entries = fs.readdirSync(tmp).filter((n) => !n.startsWith("."));
    if (entries.length !== 1) {
      throw new Error(`Unexpected archive layout under ${tmp}: ${entries.join(", ") || "(empty)"}`);
    }
    const extracted = path.join(tmp, entries[0]!);
    fs.mkdirSync(path.dirname(repoDir), { recursive: true });
    if (fs.existsSync(repoDir)) {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
    fs.renameSync(extracted, repoDir);
    logger.info(`[agentic-orchestration] Backend source ready at ${repoDir}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function looksLikeCheckout(repoDir: string): boolean {
  return (
    fs.existsSync(path.join(repoDir, "agentic-orchestration-web", "server.mjs")) &&
    fs.existsSync(path.join(repoDir, "agentic-orchestration-tool", "main.py"))
  );
}

async function ensureRemoteRepo(
  repoDir: string,
  config: PluginConfig,
  logger: Logger,
): Promise<void> {
  const archiveUrl = archiveUrlFromRepoUrl(config.repoUrl || DEFAULT_REPO_URL);
  if (!looksLikeCheckout(repoDir)) {
    await downloadAndExtractArchive(archiveUrl, repoDir, logger);
    return;
  }
  if (config.autoUpdate !== false) {
    try {
      await downloadAndExtractArchive(archiveUrl, repoDir, logger);
    } catch (err) {
      logger.warn?.(
        `[agentic-orchestration] auto-update download skipped: ${(err as Error).message}. Using existing checkout.`,
      );
    }
  }
}

/**
 * Resolve a python binary path by probing PATH (no process spawn).
 * The managed web server creates the venv / installs deps itself.
 */
export function findPythonOnPath(): string | undefined {
  const pathEnv = process.env.PATH || process.env.Path || "";
  const names =
    process.platform === "win32"
      ? ["python.exe", "python3.exe", "python"]
      : ["python3.12", "python3", "python"];
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = path.join(dir, name);
      try {
        if (fs.existsSync(candidate)) return candidate;
      } catch {
        /* ignore */
      }
    }
  }
  return undefined;
}

export interface EnsuredSidecar {
  repoDir: string;
  toolDir: string;
  webDir: string;
  pythonPath?: string;
  fromLocalCheckout: boolean;
}

/**
 * Ensure agentic-orchestration sources are present.
 * Uses HTTPS archive download (no git/npm/python child processes in this plugin).
 * Python venv + pip install are handled by agentic-orchestration-web on startup.
 */
export async function ensureSidecarInstalled(params: {
  dataRoot: string;
  config: PluginConfig;
  pluginRootDir?: string;
  logger: Logger;
}): Promise<EnsuredSidecar> {
  const { dataRoot, config, pluginRootDir, logger } = params;
  fs.mkdirSync(dataRoot, { recursive: true });

  let repoDir = resolveRepoDir(dataRoot);
  let fromLocalCheckout = false;

  const local = config.preferLocalCheckout !== false ? findLocalCheckout(pluginRootDir) : undefined;
  if (local) {
    logger.info(`[agentic-orchestration] Using local checkout: ${local}`);
    repoDir = local;
    fromLocalCheckout = true;
  } else {
    await ensureRemoteRepo(repoDir, config, logger);
  }

  const toolDir = resolveToolDir(repoDir);
  const webDir = resolveWebDir(repoDir);
  if (!fs.existsSync(path.join(webDir, "server.mjs"))) {
    throw new Error(`agentic-orchestration-web/server.mjs missing under ${repoDir}`);
  }
  if (!fs.existsSync(path.join(toolDir, "main.py"))) {
    throw new Error(`agentic-orchestration-tool/main.py missing under ${repoDir}`);
  }

  // Upstream main may not ship /api/v1/orchestrate yet — inject when missing.
  ensureOrchestrateEndpoint(webDir, logger);

  const pythonPath = findPythonOnPath();
  if (!pythonPath) {
    logger.warn?.(
      "[agentic-orchestration] No python3/python found on PATH; the managed web server may fail to create its venv.",
    );
  }

  return { repoDir, toolDir, webDir, pythonPath, fromLocalCheckout };
}
