import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

type Logger = {
  info: (m: string) => void;
  warn?: (m: string) => void;
};

const MARKER = "isApiV1Orchestrate";

function patchesDir(): string {
  // dist/src/sidecar/inject-orchestrate.js → ../../../patches
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "../../../patches"),
    path.resolve(here, "../../../../patches"),
    path.resolve(process.cwd(), "patches"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "orchestrate-handler.fragment.js"))) return c;
  }
  throw new Error("patches/ directory with orchestrate fragments not found");
}

function readFragment(name: string): string {
  return fs.readFileSync(path.join(patchesDir(), name), "utf8").trimEnd() + "\n";
}

function findBraceBlockEnd(src: string, start: number): number {
  const braceStart = src.indexOf("{", start);
  if (braceStart === -1) throw new Error("opening brace not found");
  let depth = 0;
  for (let i = braceStart; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  throw new Error("unbalanced braces");
}

/**
 * If cloned upstream `server.mjs` lacks `/api/v1/orchestrate`, inject the OpenClaw bridge.
 * Local checkouts that already include the endpoint are left untouched.
 */
export function ensureOrchestrateEndpoint(webDir: string, logger: Logger): boolean {
  const serverPath = path.join(webDir, "server.mjs");
  const src = fs.readFileSync(serverPath, "utf8");
  if (src.includes(MARKER)) {
    logger.info("[agentic-orchestration] server.mjs already has /api/v1/orchestrate");
    return false;
  }

  const matcher = readFragment("orchestrate-matcher.fragment.js");
  const handler = readFragment("orchestrate-handler.fragment.js");
  const route = readFragment("orchestrate-route.fragment.js");

  let next = src;

  const matcherAnchor = "function isOpenAiResponsesPath(req)";
  const matcherIdx = next.indexOf(matcherAnchor);
  if (matcherIdx === -1) {
    throw new Error(
      "Cannot inject /api/v1/orchestrate: isOpenAiResponsesPath not found in server.mjs",
    );
  }
  const afterMatcherFn = findBraceBlockEnd(next, matcherIdx);
  next = `${next.slice(0, afterMatcherFn)}\n${matcher}${next.slice(afterMatcherFn)}`;

  const handlerAnchor = "function sendAgentProvidersJson(res)";
  const handlerIdx = next.indexOf(handlerAnchor);
  if (handlerIdx === -1) {
    throw new Error(
      "Cannot inject /api/v1/orchestrate: sendAgentProvidersJson not found in server.mjs",
    );
  }
  next = `${next.slice(0, handlerIdx)}${handler}\n${next.slice(handlerIdx)}`;

  const routeAnchor = "if (isAgentProvidersApi(req))";
  const routeIdx = next.indexOf(routeAnchor);
  if (routeIdx === -1) {
    throw new Error(
      "Cannot inject /api/v1/orchestrate: isAgentProvidersApi route not found in server.mjs",
    );
  }
  const afterProvidersBlock = findBraceBlockEnd(next, routeIdx);
  next = `${next.slice(0, afterProvidersBlock)}\n${route}${next.slice(afterProvidersBlock)}`;

  if (!next.includes(MARKER)) {
    throw new Error("Injected server.mjs still missing isApiV1Orchestrate marker");
  }

  const backup = `${serverPath}.pre-openclaw-inject`;
  if (!fs.existsSync(backup)) {
    fs.copyFileSync(serverPath, backup);
  }
  fs.writeFileSync(serverPath, next, "utf8");
  logger.info(
    `[agentic-orchestration] Injected /api/v1/orchestrate into ${serverPath} (backup: ${backup})`,
  );
  return true;
}
