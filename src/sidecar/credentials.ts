import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentEnvMapping } from "../types.js";

type Logger = { info: (m: string) => void; warn?: (m: string) => void };

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

function plainSecret(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return v.trim();
  const obj = asRecord(v);
  if (!obj) return undefined;
  // OpenClaw SecretInput sometimes materializes as { value: "..." } when resolved.
  if (typeof obj.value === "string" && obj.value.trim()) return obj.value.trim();
  return undefined;
}

function readAuthProfilesFile(filePath: string): AgentEnvMapping {
  const out: AgentEnvMapping = {};
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    const root = asRecord(raw);
    if (!root) return out;
    const profiles = asRecord(root.profiles) ?? asRecord(root);
    if (!profiles) return out;
    for (const [id, profile] of Object.entries(profiles)) {
      const p = asRecord(profile);
      if (!p) continue;
      const provider = String(p.provider || id.split(":")[0] || "").toLowerCase();
      const key =
        plainSecret(p.key) ||
        plainSecret(p.apiKey) ||
        plainSecret(p.token) ||
        plainSecret(p.access) ||
        plainSecret(p.accessToken);
      if (!key) continue;
      if (provider.includes("openai") || provider === "openai") out.OPENAI_API_KEY ??= key;
      if (provider.includes("anthropic") || provider.includes("claude")) {
        out.ANTHROPIC_API_KEY ??= key;
      }
    }
  } catch {
    /* ignore */
  }
  return out;
}

function collectFromOpenClawConfig(config: Record<string, unknown> | undefined): AgentEnvMapping {
  const out: AgentEnvMapping = {};
  if (!config) return out;

  const models = asRecord(config.models);
  const providers = asRecord(models?.providers);
  if (providers) {
    for (const [name, provider] of Object.entries(providers)) {
      const p = asRecord(provider);
      if (!p) continue;
      const key = plainSecret(p.apiKey);
      if (!key) continue;
      const n = name.toLowerCase();
      if (n.includes("openai") || n === "openai") out.OPENAI_API_KEY ??= key;
      if (n.includes("anthropic") || n.includes("claude")) out.ANTHROPIC_API_KEY ??= key;
    }
  }

  const env = asRecord(config.env);
  if (env) {
    for (const k of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OLLAMA_HOST", "OPENAI_BASE_URL"] as const) {
      const v = env[k];
      if (typeof v === "string" && v.trim()) out[k] ??= v.trim();
    }
  }

  return out;
}

function collectFromProcessEnv(): AgentEnvMapping {
  const out: AgentEnvMapping = {};
  for (const k of [
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "OPENAI_BASE_URL",
    "OPENAI_MODEL_NAME",
    "OLLAMA_HOST",
    "OLLAMA_API_BASE",
    "ROUTER_OLLAMA_MODEL",
    "AGENTIC_PLANNER_MODEL",
  ] as const) {
    const v = process.env[k]?.trim();
    if (v) out[k] = v;
  }
  return out;
}

function scanAuthProfilesUnder(stateDir: string): AgentEnvMapping {
  const out: AgentEnvMapping = {};
  const roots = [
    stateDir,
    path.join(stateDir, "agents"),
    path.join(stateDir, "agent"),
  ];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(root);
    } catch {
      continue;
    }
    for (const name of entries) {
      const candidate = path.join(root, name, "auth-profiles.json");
      if (fs.existsSync(candidate)) {
        Object.assign(out, readAuthProfilesFile(candidate));
      }
    }
    const direct = path.join(root, "auth-profiles.json");
    if (fs.existsSync(direct)) Object.assign(out, readAuthProfilesFile(direct));
  }
  return out;
}

/**
 * Prefer OpenClaw / env credentials; otherwise configure Ollama defaults.
 */
export function resolveAgentEnv(params: {
  openClawConfig?: Record<string, unknown>;
  stateDir?: string;
  logger?: Logger;
}): AgentEnvMapping {
  const merged: AgentEnvMapping = {
    ...collectFromProcessEnv(),
    ...collectFromOpenClawConfig(params.openClawConfig),
    ...(params.stateDir ? scanAuthProfilesUnder(params.stateDir) : {}),
  };

  const hasOpenAi = Boolean(merged.OPENAI_API_KEY);
  const hasAnthropic = Boolean(merged.ANTHROPIC_API_KEY);
  const hasOllamaHint = Boolean(merged.OLLAMA_HOST || merged.AGENTIC_PLANNER_MODEL?.startsWith("ollama/"));

  if (!hasOpenAi && !hasAnthropic && !hasOllamaHint) {
    merged.OLLAMA_HOST ??= "http://127.0.0.1:11434";
    merged.OLLAMA_API_BASE ??= merged.OLLAMA_HOST;
    merged.AGENTIC_PLANNER_MODEL ??= "ollama/llama3.2";
    merged.ROUTER_OLLAMA_MODEL ??= "llama3.2";
    params.logger?.info?.(
      "[agentic-orchestration] No OpenClaw cloud API keys found; defaulting planner to Ollama (llama3.2).",
    );
  } else if (hasOpenAi && !merged.AGENTIC_PLANNER_MODEL) {
    merged.AGENTIC_PLANNER_MODEL = "openai/gpt-4o-mini";
    merged.OPENAI_MODEL_NAME ??= "gpt-4o-mini";
  } else if (hasAnthropic && !hasOpenAi && !merged.AGENTIC_PLANNER_MODEL) {
    merged.AGENTIC_PLANNER_MODEL = "anthropic/claude-3-5-sonnet-20241022";
  }

  return merged;
}

export function writeToolEnvFile(toolDir: string, envMap: AgentEnvMapping, logger?: Logger): string {
  const envPath = path.join(toolDir, ".env");
  const lines = [
    "# Generated by @zlatko-lakisic/openclaw-agentic-orchestration managed backend",
    `# ${new Date().toISOString()}`,
    "",
  ];
  for (const [k, v] of Object.entries(envMap)) {
    if (!v) continue;
    // Escape newlines; keep simple KEY=value
    lines.push(`${k}=${v.replace(/\r?\n/g, "")}`);
  }
  lines.push("");
  fs.writeFileSync(envPath, lines.join("\n"), { mode: 0o600 });
  logger?.info?.(`[agentic-orchestration] Wrote managed .env → ${envPath}`);
  return envPath;
}
