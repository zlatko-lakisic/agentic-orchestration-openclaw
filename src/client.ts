import { Agent } from "undici";
import type { OrchestrateRequest, OrchestrateResponse, PluginConfig } from "./types.js";

function formatFetchError(err: unknown, timeoutMs: number): string {
  const error = err as Error & { cause?: { name?: string; code?: string; message?: string } };
  if (error?.name === "AbortError") {
    return `Agentic orchestration timed out after ${timeoutMs}ms`;
  }
  const cause = error?.cause;
  const causeCode = cause?.code || cause?.name || "";
  if (
    causeCode === "UND_ERR_HEADERS_TIMEOUT" ||
    causeCode === "HeadersTimeoutError" ||
    /headers timeout/i.test(cause?.message || "")
  ) {
    return (
      `Agentic orchestration headers timeout (undici default is 300s; ` +
      `configured timeoutMs=${timeoutMs}). The backend was still working but no HTTP ` +
      `response headers arrived in time.`
    );
  }
  if (
    causeCode === "UND_ERR_BODY_TIMEOUT" ||
    causeCode === "BodyTimeoutError" ||
    /body timeout/i.test(cause?.message || "")
  ) {
    return (
      `Agentic orchestration body timeout while reading the response ` +
      `(configured timeoutMs=${timeoutMs}).`
    );
  }
  return `Agentic orchestration unreachable: ${error?.message || String(err)}`;
}

export class AgenticOrchestrationClient {
  constructor(private config: PluginConfig) {}

  async orchestrate(req: OrchestrateRequest): Promise<string> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.config.timeoutMs);
    // undici defaults headersTimeout/bodyTimeout to 300s. Orchestrate holds the
    // connection open until the crew finishes, so raise both to match timeoutMs.
    const undiciTimeoutMs = this.config.timeoutMs + 30_000;
    const dispatcher = new Agent({
      headersTimeout: undiciTimeoutMs,
      bodyTimeout: undiciTimeoutMs,
      connectTimeout: 30_000,
    });

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.config.apiKey) {
      headers["Authorization"] = `Bearer ${this.config.apiKey}`;
    }

    let response: Response;
    try {
      response = await fetch(this.config.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(req),
        signal: controller.signal,
        dispatcher,
      } as RequestInit);
    } catch (err) {
      clearTimeout(timeoutHandle);
      await dispatcher.close().catch(() => undefined);
      throw new Error(formatFetchError(err, this.config.timeoutMs));
    }
    clearTimeout(timeoutHandle);

    try {
      if (!response.ok) {
        let detail = "";
        let stderrTail = "";
        try {
          const body = (await response.json()) as { error?: string; stderr?: string };
          detail = body.error ?? "";
          stderrTail = (body.stderr || "").trim();
          if (stderrTail.length > 800) stderrTail = stderrTail.slice(-800);
        } catch {
          /* ignore */
        }
        const parts = [
          `Agentic orchestration returned HTTP ${response.status}`,
          detail ? `: ${detail}` : "",
          stderrTail ? `\n\nBackend stderr (tail):\n${stderrTail}` : "",
        ];
        throw new Error(parts.join(""));
      }

      const data = (await response.json()) as OrchestrateResponse;
      if (!data.ok || typeof data.output !== "string") {
        throw new Error("Agentic orchestration returned an unexpected response shape");
      }
      return data.output;
    } finally {
      await dispatcher.close().catch(() => undefined);
    }
  }
}
