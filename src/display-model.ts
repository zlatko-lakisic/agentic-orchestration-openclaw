/**
 * Display identity for the Control UI when agentic-orchestration owns turns.
 * Provider id must be a slug; label is what the UI shows.
 */
export const DISPLAY_PROVIDER_ID = "agentic";
export const DISPLAY_PROVIDER_LABEL = "AgenticOrchestrator";
export const DISPLAY_MODEL_ALLOWLIST_KEY = `${DISPLAY_PROVIDER_ID}/*`;

const DEFAULT_DISPLAY_MODEL = "llama3.2:3b";

/** Strip LiteLLM-style prefixes so the UI shows a clean model id. */
export function normalizeDisplayModelId(raw: string | undefined | null): string {
  const s = String(raw || "").trim();
  if (!s) return DEFAULT_DISPLAY_MODEL;
  return s
    .replace(/^ollama\//i, "")
    .replace(/^openai\//i, "")
    .replace(/^anthropic\//i, "")
    .trim() || DEFAULT_DISPLAY_MODEL;
}

export function displayModelRef(modelId: string): string {
  return `${DISPLAY_PROVIDER_ID}/${normalizeDisplayModelId(modelId)}`;
}

/**
 * Mutable "what's showing in the footer/picker" state for this process.
 * Updated from planner env on start and from orchestrate results when available.
 */
export class DisplayModelState {
  private modelId = DEFAULT_DISPLAY_MODEL;
  private status: "idle" | "running" = "idle";

  get id(): string {
    return this.modelId;
  }

  get ref(): string {
    return displayModelRef(this.modelId);
  }

  get label(): string {
    return this.status === "running" ? `${this.modelId} (running)` : this.modelId;
  }

  get isRunning(): boolean {
    return this.status === "running";
  }

  setPlannerModel(raw: string | undefined | null): void {
    this.modelId = normalizeDisplayModelId(raw);
    this.status = "idle";
  }

  markRunning(raw?: string | undefined | null): void {
    if (raw) this.modelId = normalizeDisplayModelId(raw);
    this.status = "running";
  }

  markIdle(raw?: string | undefined | null): void {
    if (raw) this.modelId = normalizeDisplayModelId(raw);
    this.status = "idle";
  }

  catalogEntry(): {
    id: string;
    name: string;
    reasoning: boolean;
    input: Array<"text">;
    cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
    contextWindow: number;
    maxTokens: number;
  } {
    return {
      id: this.modelId,
      name: this.label,
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128_000,
      maxTokens: 8192,
    };
  }
}
