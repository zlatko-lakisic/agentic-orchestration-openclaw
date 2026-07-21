/**
 * Loopback control plane for the OpenClaw→AO tool bridge.
 * MCP stdio server calls this; plugin uses api.runtime.gateway.request("tools.invoke").
 */
import * as http from "node:http";
import * as crypto from "node:crypto";
import type { OpenClawPluginApi } from "../types.js";

export type BridgeInvokeFn = (params: {
  tool: string;
  args?: Record<string, unknown>;
  sessionKey?: string;
}) => Promise<unknown>;

export interface BridgeHub {
  port: number;
  token: string;
  baseUrl: string;
  setSessionKey: (sessionKey?: string) => void;
  getSessionKey: () => string | undefined;
  stop: () => Promise<void>;
}

function clientSafeError(err: unknown): string {
  // Never return stack traces or multi-line dumps to the bridge client (CodeQL js/stack-trace-exposure).
  if (err instanceof Error) {
    const msg = String(err.message || "")
      .split(/\r?\n/)[0]
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 400);
    return msg || "internal error";
  }
  return "internal error";
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("JSON object required");
  }
  return parsed as Record<string, unknown>;
}

function authorize(req: http.IncomingMessage, token: string): boolean {
  const hdr = String(req.headers.authorization || "").trim();
  if (hdr === `Bearer ${token}` || hdr === token) return true;
  const q = new URL(req.url || "/", "http://127.0.0.1").searchParams.get("token");
  return q === token;
}

export async function createDefaultBridgeInvoker(api: OpenClawPluginApi): Promise<BridgeInvokeFn> {
  const gatewayRequest = api.runtime?.gateway?.request;
  if (typeof gatewayRequest === "function") {
    return async ({ tool, args, sessionKey }) => {
      return gatewayRequest.call(api.runtime?.gateway, "tools.invoke", {
        name: tool,
        args: args || {},
        sessionKey,
      });
    };
  }

  // Fallback: HTTP /tools/invoke on local gateway
  const cfg = (typeof api.runtime?.config?.current === "function"
    ? api.runtime.config.current()
    : api.config) as Record<string, unknown> | undefined;
  const gateway = (cfg?.gateway && typeof cfg.gateway === "object"
    ? (cfg.gateway as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  const auth = (gateway.auth && typeof gateway.auth === "object"
    ? (gateway.auth as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  const port = typeof gateway.port === "number" && gateway.port > 0 ? gateway.port : 18789;
  const token = typeof auth.token === "string" ? auth.token.trim() : "";
  const base = `http://127.0.0.1:${port}`;

  return async ({ tool, args, sessionKey }) => {
    if (!token) {
      throw new Error(
        "OpenClaw bridge: api.runtime.gateway.request unavailable and no gateway.auth.token for HTTP fallback",
      );
    }
    const res = await fetch(`${base}/tools/invoke`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tool,
        name: tool,
        args: args || {},
        sessionKey,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const err = body.error;
      const msg =
        typeof err === "string"
          ? err
          : err && typeof err === "object" && "message" in err
            ? String((err as { message?: unknown }).message)
            : `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return body;
  };
}

export async function startBridgeHub(params: {
  api: OpenClawPluginApi;
  port?: number;
  token?: string;
  invoke?: BridgeInvokeFn;
}): Promise<BridgeHub> {
  const token = params.token || crypto.randomBytes(24).toString("hex");
  const port = params.port && params.port > 0 ? params.port : 3848;
  const invoke = params.invoke || (await createDefaultBridgeInvoker(params.api));
  let currentSessionKey: string | undefined;

  const nodesList = params.api.runtime?.nodes?.list;
  const nodesInvoke = params.api.runtime?.nodes?.invoke;

  const server = http.createServer(async (req, res) => {
    try {
      if (!req.url || !req.method) {
        json(res, 400, { ok: false, error: "bad request" });
        return;
      }
      if (!authorize(req, token)) {
        json(res, 401, { ok: false, error: "unauthorized" });
        return;
      }

      const url = new URL(req.url, "http://127.0.0.1");
      if (req.method === "GET" && url.pathname === "/health") {
        json(res, 200, { ok: true, sessionKey: currentSessionKey || null });
        return;
      }

      if (req.method === "POST" && url.pathname === "/session") {
        const body = await readJson(req);
        if (typeof body.sessionKey === "string") {
          currentSessionKey = body.sessionKey.trim() || undefined;
        }
        json(res, 200, { ok: true, sessionKey: currentSessionKey || null });
        return;
      }

      if (req.method === "POST" && url.pathname === "/invoke") {
        const body = await readJson(req);
        const tool = String(body.tool || body.name || "").trim();
        if (!tool) {
          json(res, 400, { ok: false, error: "tool is required" });
          return;
        }
        const args =
          body.args && typeof body.args === "object" && !Array.isArray(body.args)
            ? (body.args as Record<string, unknown>)
            : {};
        const sessionKey =
          (typeof body.sessionKey === "string" && body.sessionKey.trim()) ||
          currentSessionKey;

        // Special node helpers when runtime.nodes is available
        if (tool === "nodes_list" && typeof nodesList === "function") {
          const result = await nodesList.call(params.api.runtime?.nodes);
          json(res, 200, { ok: true, result });
          return;
        }
        if (tool === "nodes_invoke" && typeof nodesInvoke === "function") {
          const result = await nodesInvoke.call(params.api.runtime?.nodes, args);
          json(res, 200, { ok: true, result });
          return;
        }

        const result = await invoke({ tool, args, sessionKey });
        json(res, 200, { ok: true, result });
        return;
      }

      json(res, 404, { ok: false, error: "not found" });
    } catch (err) {
      params.api.logger.warn?.(
        `[agentic-orchestration] bridge invoke error: ${clientSafeError(err)}`,
      );
      json(res, 500, {
        ok: false,
        error: clientSafeError(err),
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });

  params.api.logger.info(
    `[agentic-orchestration] OpenClaw tool bridge listening on http://127.0.0.1:${port}`,
  );

  return {
    port,
    token,
    baseUrl: `http://127.0.0.1:${port}`,
    setSessionKey(sessionKey?: string) {
      currentSessionKey = sessionKey?.trim() || undefined;
    },
    getSessionKey() {
      return currentSessionKey;
    },
    stop() {
      return new Promise((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}
