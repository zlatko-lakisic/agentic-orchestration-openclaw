import type { OrchestrateRequest, OrchestrateResponse, PluginConfig } from "./types.js";

export class AgenticOrchestrationClient {
  constructor(private config: PluginConfig) {}

  async orchestrate(req: OrchestrateRequest): Promise<string> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.config.timeoutMs);

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
      });
    } catch (err) {
      clearTimeout(timeoutHandle);
      const isTimeout = (err as Error)?.name === "AbortError";
      throw new Error(
        isTimeout
          ? `Agentic orchestration timed out after ${this.config.timeoutMs}ms`
          : `Agentic orchestration unreachable: ${(err as Error)?.message}`,
      );
    }
    clearTimeout(timeoutHandle);

    if (!response.ok) {
      let detail = "";
      try {
        const body = (await response.json()) as { error?: string };
        detail = body.error ?? "";
      } catch {
        /* ignore */
      }
      throw new Error(
        `Agentic orchestration returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
      );
    }

    const data = (await response.json()) as OrchestrateResponse;
    if (!data.ok || typeof data.output !== "string") {
      throw new Error("Agentic orchestration returned an unexpected response shape");
    }
    return data.output;
  }
}
