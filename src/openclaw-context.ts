/**
 * Collect OpenClaw workspace bootstrap, memory, and skills for AO prompt injection.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const BOOTSTRAP_FILES = [
  "AGENTS.md",
  "SOUL.md",
  "USER.md",
  "IDENTITY.md",
  "TOOLS.md",
  "HEARTBEAT.md",
] as const;

export function resolveOpenClawWorkspaceDir(params: {
  openClawConfig?: Record<string, unknown>;
  workspaceDir?: string;
  stateDir?: string;
}): string {
  const home = os.homedir();
  const dedicated = params.stateDir
    ? path.join(params.stateDir, "workspace")
    : path.join(home, ".openclaw", "workspace");

  const candidates: string[] = [];
  if (params.workspaceDir && params.workspaceDir.trim()) {
    candidates.push(path.resolve(params.workspaceDir.trim()));
  }
  const agents = asRecord(params.openClawConfig?.agents);
  const defaults = asRecord(agents?.defaults);
  const configured = typeof defaults?.workspace === "string" ? defaults.workspace.trim() : "";
  if (configured) candidates.push(path.resolve(expandHome(configured)));
  candidates.push(dedicated);

  // Prefer a dedicated OpenClaw workspace over $HOME when both exist.
  // agents.defaults.workspace is sometimes set to the home directory, which is
  // too broad for bootstrap/memory injection and skill discovery.
  for (const c of candidates) {
    if (!c) continue;
    const resolved = path.resolve(c);
    if (resolved === path.resolve(home) || resolved === path.resolve(home) + path.sep) {
      continue;
    }
    if (fs.existsSync(path.join(resolved, "AGENTS.md")) || fs.existsSync(resolved)) {
      return resolved;
    }
  }
  if (fs.existsSync(dedicated)) return dedicated;
  return candidates[0] ? path.resolve(candidates[0]) : dedicated;
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

function readCapped(filePath: string, maxChars: number): string | undefined {
  try {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return undefined;
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) return undefined;
    if (raw.length <= maxChars) return raw.trim();
    return `${raw.slice(0, maxChars).trim()}\n…(truncated)`;
  } catch {
    return undefined;
  }
}

function listSkillSummaries(workspaceDir: string, stateDir?: string, maxSkills = 24): string[] {
  const roots = [
    path.join(workspaceDir, "skills"),
    path.join(workspaceDir, ".agents", "skills"),
    path.join(os.homedir(), ".agents", "skills"),
  ];
  if (stateDir) roots.push(path.join(stateDir, "skills"));
  roots.push(path.join(os.homedir(), ".openclaw", "skills"));

  const out: string[] = [];
  const seen = new Set<string>();

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const skillMd = path.join(root, ent.name, "SKILL.md");
      if (!fs.existsSync(skillMd)) continue;
      if (seen.has(ent.name)) continue;
      seen.add(ent.name);
      const body = readCapped(skillMd, 1200) || "";
      const desc =
        body.match(/^description:\s*(.+)$/im)?.[1]?.trim() ||
        body.match(/^#\s+(.+)$/m)?.[1]?.trim() ||
        "OpenClaw skill";
      out.push(`- ${ent.name}: ${desc.replace(/\s+/g, " ").slice(0, 160)}`);
      if (out.length >= maxSkills) return out;
    }
  }
  return out;
}

function listRecentMemory(workspaceDir: string, maxFiles = 3, maxCharsEach = 2500): string[] {
  const chunks: string[] = [];
  const memoryMd = readCapped(path.join(workspaceDir, "MEMORY.md"), maxCharsEach);
  if (memoryMd) chunks.push(`### MEMORY.md\n${memoryMd}`);

  const memDir = path.join(workspaceDir, "memory");
  if (!fs.existsSync(memDir)) return chunks;
  let files: string[] = [];
  try {
    files = fs
      .readdirSync(memDir)
      .filter((n) => n.endsWith(".md"))
      .sort()
      .reverse();
  } catch {
    return chunks;
  }
  for (const name of files.slice(0, maxFiles)) {
    const body = readCapped(path.join(memDir, name), maxCharsEach);
    if (body) chunks.push(`### memory/${name}\n${body}`);
  }
  return chunks;
}

export function detectAutomationSource(sessionKey?: string): string | undefined {
  const key = (sessionKey || "").toLowerCase();
  if (!key) return undefined;
  if (key.includes(":cron") || key.includes("cron:")) return "cron";
  if (key.includes("heartbeat")) return "heartbeat";
  if (key.includes("automation")) return "automation";
  return undefined;
}

export function shouldFallthroughAutomation(sessionKey?: string, enabled = true): boolean {
  if (!enabled) return false;
  return Boolean(detectAutomationSource(sessionKey));
}

export function buildOpenClawContextPreamble(params: {
  openClawConfig?: Record<string, unknown>;
  workspaceDir?: string;
  stateDir?: string;
  sessionKey?: string;
  agentId?: string;
  channel?: string;
  maxTotalChars?: number;
}): string {
  const maxTotal = params.maxTotalChars ?? 12_000;
  const workspaceDir = resolveOpenClawWorkspaceDir(params);
  const sections: string[] = [];

  sections.push(
    `[OpenClaw context]`,
    `workspace: ${workspaceDir}`,
    params.sessionKey ? `sessionKey: ${params.sessionKey}` : "",
    params.agentId ? `agentId: ${params.agentId}` : "",
    params.channel ? `channel: ${params.channel}` : "",
    detectAutomationSource(params.sessionKey)
      ? `automationSource: ${detectAutomationSource(params.sessionKey)}`
      : "automationSource: interactive",
  );

  const bootstrapBits: string[] = [];
  for (const name of BOOTSTRAP_FILES) {
    const body = readCapped(path.join(workspaceDir, name), 2200);
    if (body) bootstrapBits.push(`### ${name}\n${body}`);
  }
  if (bootstrapBits.length) {
    sections.push(`## Workspace bootstrap`, ...bootstrapBits);
  }

  const memoryBits = listRecentMemory(workspaceDir);
  if (memoryBits.length) {
    sections.push(`## Memory`, ...memoryBits);
  } else {
    sections.push(`## Memory`, `(no MEMORY.md or memory/*.md found under workspace)`);
  }

  const skills = listSkillSummaries(workspaceDir, params.stateDir);
  if (skills.length) {
    sections.push(`## Skills (names/descriptions only)`, ...skills);
  } else {
    sections.push(`## Skills`, `(no SKILL.md packs found)`);
  }

  sections.push(
    `## Bridged OpenClaw tools`,
    `Host tools (browser/exec/nodes/memory) are available via MCP id openclaw_bridge when needed.`,
    `[/OpenClaw context]`,
    ``,
    `User message:`,
  );

  let out = sections.filter((l) => l !== "").join("\n");
  if (out.length > maxTotal) {
    out = `${out.slice(0, maxTotal)}\n…(OpenClaw context truncated)\n\nUser message:`;
  }
  return out;
}

/** Compose final orchestrate text with optional OpenClaw context prefix. */
export function composeOrchestrateText(userText: string, preamble: string | undefined): string {
  const text = userText.trim();
  if (!preamble?.trim()) return text;
  return `${preamble.trim()}\n${text}`;
}
