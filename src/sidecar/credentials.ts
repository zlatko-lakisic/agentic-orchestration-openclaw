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
    "AGENTIC_OPENAI_PROXY_DYNAMIC_AGENT_PROVIDER_IDS",
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
 * Prefer explicit OpenClaw config / allowlisted process env credentials.
 * Auth-profile disk scans are opt-in (`discoverAuthProfiles`) to avoid broad
 * credential harvesting flagged by ClawHub review.
 */
export function resolveAgentEnv(params: {
  openClawConfig?: Record<string, unknown>;
  stateDir?: string;
  /** When true, also scan auth-profiles.json under the OpenClaw state dir. */
  discoverAuthProfiles?: boolean;
  logger?: Logger;
}): AgentEnvMapping {
  const merged: AgentEnvMapping = {
    ...collectFromProcessEnv(),
    ...collectFromOpenClawConfig(params.openClawConfig),
    ...(params.discoverAuthProfiles && params.stateDir
      ? scanAuthProfilesUnder(params.stateDir)
      : {}),
  };

  const hasOpenAi = Boolean(merged.OPENAI_API_KEY);
  const hasAnthropic = Boolean(merged.ANTHROPIC_API_KEY);
  const hasOllamaHint = Boolean(merged.OLLAMA_HOST || merged.AGENTIC_PLANNER_MODEL?.startsWith("ollama/"));

  if (!hasOpenAi && !hasAnthropic && !hasOllamaHint) {
    merged.OLLAMA_HOST ??= "http://127.0.0.1:11434";
    merged.OLLAMA_API_BASE ??= merged.OLLAMA_HOST;
    // Prefer the 1B variant for local CPU — full llama3.2 (3B) often exceeds 5+ minutes per turn.
    merged.AGENTIC_PLANNER_MODEL ??= "ollama/llama3.2:1b";
    merged.ROUTER_OLLAMA_MODEL ??= "llama3.2:1b";
    merged.AGENTIC_OPENAI_PROXY_DYNAMIC_AGENT_PROVIDER_IDS ??= "ollama_llama3_2_1b";
    params.logger?.info?.(
      "[agentic-orchestration] No OpenClaw cloud API keys found; defaulting planner to Ollama (llama3.2:1b).",
    );
  } else if (!hasOpenAi && !hasAnthropic) {
    // Ollama already hinted (host/model present) — still pin the small local agent unless set.
    merged.OLLAMA_HOST ??= "http://127.0.0.1:11434";
    merged.OLLAMA_API_BASE ??= merged.OLLAMA_HOST;
    if (
      !merged.AGENTIC_PLANNER_MODEL ||
      merged.AGENTIC_PLANNER_MODEL === "ollama/llama3.2" ||
      merged.AGENTIC_PLANNER_MODEL === "ollama/llama3.2:latest"
    ) {
      merged.AGENTIC_PLANNER_MODEL = "ollama/llama3.2:1b";
      merged.ROUTER_OLLAMA_MODEL = "llama3.2:1b";
      params.logger?.info?.(
        "[agentic-orchestration] Switching Ollama planner to llama3.2:1b (smallest local default).",
      );
    }
    merged.ROUTER_OLLAMA_MODEL ??= "llama3.2:1b";
    merged.AGENTIC_OPENAI_PROXY_DYNAMIC_AGENT_PROVIDER_IDS ??= "ollama_llama3_2_1b";
  } else if (hasOpenAi && !merged.AGENTIC_PLANNER_MODEL) {
    merged.AGENTIC_PLANNER_MODEL = "openai/gpt-4o-mini";
    merged.OPENAI_MODEL_NAME ??= "gpt-4o-mini";
  } else if (hasAnthropic && !hasOpenAi && !merged.AGENTIC_PLANNER_MODEL) {
    merged.AGENTIC_PLANNER_MODEL = "anthropic/claude-3-5-sonnet-20241022";
  }

  // Avoid multi-minute LiteLLM startup hangs on SSL fetch of the remote cost map.
  merged.LITELLM_LOCAL_MODEL_COST_MAP ??= "True";

  // CrewAI 1.x first-run prompt blocks stdin for 20s and pollutes orchestrate stdout.
  merged.CREWAI_TESTING ??= "true";
  merged.CREWAI_TRACING_ENABLED ??= "false";

  // Keep local Ollama models resident — default loop is 60s (was 5m).
  merged.AGENTIC_OLLAMA_KEEPALIVE ??= "1";
  merged.AGENTIC_OLLAMA_KEEP_ALIVE ??= "-1";
  merged.AGENTIC_OLLAMA_KEEPALIVE_INTERVAL_MS ??= "60000";

  return merged;
}

export function writeToolEnvFile(toolDir: string, envMap: AgentEnvMapping, logger?: Logger): string {
  const envPath = path.join(toolDir, ".env");
  const secretKeys = new Set(["OPENAI_API_KEY", "ANTHROPIC_API_KEY"]);
  const lines = [
    "# Generated by @zlatko-lakisic/openclaw-agentic-orchestration managed backend",
    `# ${new Date().toISOString()}`,
    "# API keys are omitted here; they are passed via the managed worker environment.",
    "",
  ];
  for (const [k, v] of Object.entries(envMap)) {
    if (!v) continue;
    if (secretKeys.has(k)) continue;
    // Escape newlines; keep simple KEY=value
    lines.push(`${k}=${v.replace(/\r?\n/g, "")}`);
  }
  lines.push("");
  fs.writeFileSync(envPath, lines.join("\n"), { mode: 0o600 });
  logger?.info?.(`[agentic-orchestration] Wrote managed non-secret .env → ${envPath}`);
  return envPath;
}
