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

/** Map a GitHub repo URL to a pinned source archive (no git binary required). */
export function archiveUrlFromRepoUrl(repoUrl: string, ref: string = "v1.14.0"): string {
  const cleaned = repoUrl.trim().replace(/\.git$/i, "");
  const m = cleaned.match(/github\.com[/:]([^/]+)\/([^/#?]+)/i);
  if (!m) {
    throw new Error(`Cannot derive GitHub archive URL from repoUrl: ${repoUrl}`);
  }
  const owner = m[1];
  const repo = m[2].replace(/\.git$/i, "");
  const trimmed = (ref || "v1.14.0").trim() || "v1.14.0";
  // Semver release tags use refs/tags; everything else is treated as a branch.
  const isTag = /^v?\d+\.\d+\.\d+([.-].+)?$/.test(trimmed);
  const kind = isTag ? "tags" : "heads";
  return `https://github.com/${owner}/${repo}/archive/refs/${kind}/${encodeURIComponent(trimmed)}.tar.gz`;
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
  const archiveUrl = archiveUrlFromRepoUrl(
    config.repoUrl || DEFAULT_REPO_URL,
    config.backendRef || "v1.14.0",
  );
  if (!looksLikeCheckout(repoDir)) {
    await downloadAndExtractArchive(archiveUrl, repoDir, logger);
    return;
  }
  if (config.autoUpdate === true) {
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
 * Prefer python3.12 across the whole PATH before falling back to python3/python.
 */
export function findPythonOnPath(): string | undefined {
  const pathEnv = process.env.PATH || process.env.Path || "";
  const dirs = pathEnv.split(path.delimiter).filter(Boolean);
  const preferred =
    process.platform === "win32"
      ? ["python3.12.exe", "python3.exe", "python.exe", "python"]
      : ["python3.12", "python3", "python"];
  for (const name of preferred) {
    for (const dir of dirs) {
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

  // Pinned releases ship /api/v1/orchestrate; inject only when an older checkout is missing it.
  ensureOrchestrateEndpoint(webDir, logger);

  // Prefer an existing tool venv — never point AGENTIC_PYTHON at Homebrew/system
  // python (PEP 668 blocks pip install there).
  const isWin = process.platform === "win32";
  const venvPython = isWin
    ? path.join(toolDir, ".venv", "Scripts", "python.exe")
    : path.join(toolDir, ".venv", "bin", "python");
  let pythonPath: string | undefined;
  if (fs.existsSync(venvPython)) {
    pythonPath = venvPython;
    logger.info(`[agentic-orchestration] Using tool venv Python: ${pythonPath}`);
  } else {
    pythonPath = findPythonOnPath();
    if (pythonPath) {
      logger.warn?.(
        `[agentic-orchestration] No tool .venv yet; bootstrap Python is ${pythonPath}. ` +
          "The web server should create .venv on first run — if PEP 668 errors appear, create the venv manually.",
      );
    } else {
      logger.warn?.(
        "[agentic-orchestration] No python3/python found on PATH; the managed web server may fail to create its venv.",
      );
    }
  }

  return { repoDir, toolDir, webDir, pythonPath, fromLocalCheckout };
}
