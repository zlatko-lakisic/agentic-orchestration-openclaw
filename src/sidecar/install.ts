import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { DEFAULT_REPO_URL, findLocalCheckout, resolveRepoDir, resolveToolDir, resolveWebDir } from "./paths.js";
import { ensureOrchestrateEndpoint } from "./inject-orchestrate.js";
import { buildBootstrapEnv } from "./child-env.js";
import type { PluginConfig } from "../types.js";

type Logger = {
  info: (m: string) => void;
  error: (m: string) => void;
  warn?: (m: string) => void;
};

function execOpts(opts: {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}): ExecFileSyncOptionsWithStringEncoding {
  return {
    cwd: opts.cwd,
    env: opts.env ?? buildBootstrapEnv(),
    encoding: "utf8",
    timeout: opts.timeoutMs ?? 600_000,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  };
}

function failMsg(label: string, err: unknown): Error {
  const e = err as { stderr?: string; stdout?: string; message?: string };
  const detail = String(e.stderr || e.stdout || e.message || "unknown error").trim();
  return new Error(`${label} failed: ${detail.slice(0, 2000)}`);
}

function runGit(args: string[], opts: { cwd: string }, logger: Logger): void {
  logger.info(`[agentic-orchestration] $ git ${args.join(" ")} (cwd=${opts.cwd})`);
  try {
    execFileSync("git", args, execOpts(opts));
  } catch (err) {
    throw failMsg(`git ${args.join(" ")}`, err);
  }
}

function runNpm(args: string[], opts: { cwd: string; timeoutMs?: number }, logger: Logger): void {
  logger.info(`[agentic-orchestration] $ npm ${args.join(" ")} (cwd=${opts.cwd})`);
  try {
    execFileSync("npm", args, execOpts(opts));
  } catch (err) {
    throw failMsg(`npm ${args.join(" ")}`, err);
  }
}

function assertVenvPython(pythonPath: string): void {
  const base = path.basename(pythonPath).toLowerCase();
  const ok =
    base === "python" ||
    base === "python.exe" ||
    /[/\\]\.venv[/\\](bin|scripts)[/\\]python(\.exe)?$/i.test(pythonPath);
  if (!ok) {
    throw new Error(`Refusing to run unexpected python path: ${pythonPath}`);
  }
}

function runPython(
  pythonPath: string,
  args: string[],
  opts: { cwd: string; timeoutMs?: number },
  logger: Logger,
): void {
  assertVenvPython(pythonPath);
  logger.info(`[agentic-orchestration] $ ${pythonPath} ${args.join(" ")} (cwd=${opts.cwd})`);
  try {
    execFileSync(pythonPath, args, execOpts(opts));
  } catch (err) {
    throw failMsg(`${pythonPath} ${args.join(" ")}`, err);
  }
}

function ensureGitRepo(repoDir: string, config: PluginConfig, logger: Logger): void {
  const repoUrl = config.repoUrl || DEFAULT_REPO_URL;
  if (!fs.existsSync(path.join(repoDir, ".git"))) {
    fs.mkdirSync(path.dirname(repoDir), { recursive: true });
    if (fs.existsSync(repoDir) && fs.readdirSync(repoDir).length > 0) {
      throw new Error(`Install dir exists but is not a git repo: ${repoDir}`);
    }
    runGit(["clone", "--depth", "1", repoUrl, repoDir], { cwd: path.dirname(repoDir) }, logger);
    return;
  }
  if (config.autoUpdate !== false) {
    try {
      runGit(["fetch", "--depth", "1", "origin"], { cwd: repoDir }, logger);
      runGit(["reset", "--hard", "origin/HEAD"], { cwd: repoDir }, logger);
    } catch (err) {
      logger.warn?.(
        `[agentic-orchestration] git update skipped: ${(err as Error).message}. Using existing checkout.`,
      );
    }
  }
}

function createVenv(toolDir: string, logger: Logger): void {
  const fromEnv = process.env.AGENTIC_BOOTSTRAP_PYTHON?.trim();
  if (fromEnv) {
    const base = path.basename(fromEnv).toLowerCase();
    if (!["python", "python.exe", "python3", "python3.12"].includes(base)) {
      throw new Error(`AGENTIC_BOOTSTRAP_PYTHON must be a python binary, got: ${base}`);
    }
    logger.info(`[agentic-orchestration] $ ${fromEnv} -m venv .venv (cwd=${toolDir})`);
    try {
      execFileSync(fromEnv, ["-m", "venv", ".venv"], execOpts({ cwd: toolDir }));
    } catch (err) {
      throw failMsg(`${fromEnv} -m venv .venv`, err);
    }
    return;
  }

  if (process.platform === "win32") {
    logger.info(`[agentic-orchestration] $ python -m venv .venv (cwd=${toolDir})`);
    try {
      execFileSync("python", ["-m", "venv", ".venv"], execOpts({ cwd: toolDir }));
    } catch (err) {
      throw failMsg("python -m venv .venv", err);
    }
    return;
  }

  try {
    execFileSync("python3.12", ["-V"], execOpts({ cwd: toolDir, timeoutMs: 10_000 }));
    logger.info(`[agentic-orchestration] $ python3.12 -m venv .venv (cwd=${toolDir})`);
    execFileSync("python3.12", ["-m", "venv", ".venv"], execOpts({ cwd: toolDir }));
  } catch {
    logger.info(`[agentic-orchestration] $ python3 -m venv .venv (cwd=${toolDir})`);
    try {
      execFileSync("python3", ["-m", "venv", ".venv"], execOpts({ cwd: toolDir }));
    } catch (err) {
      throw failMsg("python3 -m venv .venv", err);
    }
  }
}

function ensurePythonVenv(toolDir: string, logger: Logger): string {
  const isWin = process.platform === "win32";
  const venvPython = isWin
    ? path.join(toolDir, ".venv", "Scripts", "python.exe")
    : path.join(toolDir, ".venv", "bin", "python");

  if (!fs.existsSync(venvPython)) {
    createVenv(toolDir, logger);
  }

  const requirements = path.join(toolDir, "requirements.txt");
  if (!fs.existsSync(requirements)) {
    throw new Error(`Missing requirements.txt at ${requirements}`);
  }

  try {
    assertVenvPython(venvPython);
    execFileSync(venvPython, ["-c", "import dotenv"], execOpts({ cwd: toolDir, timeoutMs: 30_000 }));
  } catch {
    runPython(venvPython, ["-m", "pip", "install", "--upgrade", "pip"], { cwd: toolDir }, logger);
    runPython(
      venvPython,
      ["-m", "pip", "install", "-r", "requirements.txt"],
      { cwd: toolDir, timeoutMs: 900_000 },
      logger,
    );
  }
  return venvPython;
}

function ensureWebDeps(webDir: string, logger: Logger): void {
  if (!fs.existsSync(path.join(webDir, "node_modules", "ws"))) {
    runNpm(["install", "--omit=dev"], { cwd: webDir, timeoutMs: 300_000 }, logger);
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
