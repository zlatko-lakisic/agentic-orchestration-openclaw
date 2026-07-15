import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { DEFAULT_REPO_URL, findLocalCheckout, resolveRepoDir, resolveToolDir, resolveWebDir } from "./paths.js";
import { ensureOrchestrateEndpoint } from "./inject-orchestrate.js";
import type { PluginConfig } from "../types.js";

type Logger = {
  info: (m: string) => void;
  error: (m: string) => void;
  warn?: (m: string) => void;
};

function run(
  command: string,
  args: string[],
  opts: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number },
  logger: Logger,
): SpawnSyncReturns<string> {
  logger.info(`[agentic-orchestration] $ ${command} ${args.join(" ")} (cwd=${opts.cwd})`);
  const result = spawnSync(command, args, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    encoding: "utf8",
    timeout: opts.timeoutMs ?? 600_000,
    shell: false,
  });
  if (result.status !== 0) {
    const err = String(result.stderr || result.stdout || result.error || "unknown error").trim();
    throw new Error(`${command} ${args.join(" ")} failed: ${err.slice(0, 2000)}`);
  }
  return result;
}

function ensureGitRepo(repoDir: string, config: PluginConfig, logger: Logger): void {
  const repoUrl = config.repoUrl || DEFAULT_REPO_URL;
  if (!fs.existsSync(path.join(repoDir, ".git"))) {
    fs.mkdirSync(path.dirname(repoDir), { recursive: true });
    if (fs.existsSync(repoDir) && fs.readdirSync(repoDir).length > 0) {
      throw new Error(`Install dir exists but is not a git repo: ${repoDir}`);
    }
    run("git", ["clone", "--depth", "1", repoUrl, repoDir], { cwd: path.dirname(repoDir) }, logger);
    return;
  }
  if (config.autoUpdate !== false) {
    try {
      run("git", ["fetch", "--depth", "1", "origin"], { cwd: repoDir }, logger);
      run("git", ["reset", "--hard", "origin/HEAD"], { cwd: repoDir }, logger);
    } catch (err) {
      logger.warn?.(
        `[agentic-orchestration] git update skipped: ${(err as Error).message}. Using existing checkout.`,
      );
    }
  }
}

function ensurePythonVenv(toolDir: string, logger: Logger): string {
  const isWin = process.platform === "win32";
  const venvPython = isWin
    ? path.join(toolDir, ".venv", "Scripts", "python.exe")
    : path.join(toolDir, ".venv", "bin", "python");

  if (!fs.existsSync(venvPython)) {
    let bootstrap =
      process.env.AGENTIC_BOOTSTRAP_PYTHON?.trim() || (isWin ? "python" : "python3.12");
    if (!isWin && bootstrap === "python3.12") {
      const probe = spawnSync("python3.12", ["-V"], { encoding: "utf8" });
      if (probe.status !== 0) bootstrap = "python3";
    }
    run(bootstrap, ["-m", "venv", ".venv"], { cwd: toolDir }, logger);
  }

  const requirements = path.join(toolDir, "requirements.txt");
  if (!fs.existsSync(requirements)) {
    throw new Error(`Missing requirements.txt at ${requirements}`);
  }

  // Fast check: dotenv importable?
  const check = spawnSync(venvPython, ["-c", "import dotenv"], {
    cwd: toolDir,
    encoding: "utf8",
    timeout: 30_000,
  });
  if (check.status !== 0) {
    run(venvPython, ["-m", "pip", "install", "--upgrade", "pip"], { cwd: toolDir }, logger);
    run(venvPython, ["-m", "pip", "install", "-r", "requirements.txt"], { cwd: toolDir, timeoutMs: 900_000 }, logger);
  }
  return venvPython;
}

function ensureWebDeps(webDir: string, logger: Logger): void {
  if (!fs.existsSync(path.join(webDir, "node_modules", "ws"))) {
    run("npm", ["install", "--omit=dev"], { cwd: webDir, timeoutMs: 300_000 }, logger);
  }
}

export interface EnsuredSidecar {
  repoDir: string;
  toolDir: string;
  webDir: string;
  pythonPath: string;
  fromLocalCheckout: boolean;
}

/**
 * Ensure agentic-orchestration is present and dependencies are installed.
 * Prefer a local sibling checkout when available; otherwise clone into dataRoot.
 */
export function ensureSidecarInstalled(params: {
  dataRoot: string;
  config: PluginConfig;
  pluginRootDir?: string;
  logger: Logger;
}): EnsuredSidecar {
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
    ensureGitRepo(repoDir, config, logger);
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

  const pythonPath = ensurePythonVenv(toolDir, logger);
  ensureWebDeps(webDir, logger);

  return { repoDir, toolDir, webDir, pythonPath, fromLocalCheckout };
}
