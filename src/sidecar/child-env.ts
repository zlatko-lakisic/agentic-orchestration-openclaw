/**
 * Build a minimal env for child processes — never spread process.env.
 * Passing the full parent env into a networked child trips ClawHub
 * `suspicious.env_credential_access`.
 */

const PASSTHROUGH_KEYS = [
  "PATH",
  "PATHEXT",
  "HOME",
  "USER",
  "USERPROFILE",
  "LOGNAME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "SHELL",
  "SystemRoot",
  "ComSpec",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "OS",
  "PROCESSOR_ARCHITECTURE",
  "NUMBER_OF_PROCESSORS",
  "NODE_OPTIONS",
  "NODE_PATH",
  "NODE_ENV",
  "npm_config_registry",
  "npm_config_cache",
  "npm_config_prefix",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "REQUESTS_CA_BUNDLE",
  "CURL_CA_BUNDLE",
  "GIT_SSL_CAINFO",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_SYSTEM",
] as const;

const PREFIXES = [
  "AGENTIC_",
  "OPENAI_",
  "ANTHROPIC_",
  "OLLAMA_",
  "HF_",
  "HUGGINGFACE_",
  "ROUTER_",
  "CREWAI_",
  "LITELLM_",
] as const;

function copyKey(out: NodeJS.ProcessEnv, key: string): void {
  const v = process.env[key];
  if (v !== undefined) out[key] = v;
}

/** Env for git / python / npm bootstrap (no credential spray beyond allowlisted keys). */
export function buildBootstrapEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const k of PASSTHROUGH_KEYS) copyKey(out, k);
  for (const key of Object.keys(process.env)) {
    if (PREFIXES.some((p) => key.startsWith(p))) copyKey(out, key);
  }
  if (extra) Object.assign(out, extra);
  return out;
}

/** Env for the managed agentic-orchestration-web process. */
export function buildBackendEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return buildBootstrapEnv(extra);
}
