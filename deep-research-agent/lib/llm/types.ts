export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the arguments (object type). */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface ChatOptions {
  /** System instruction (kept separate so each provider maps it natively). */
  system?: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  /** When false, tools are not offered (used for the final writing call). */
  allowTools?: boolean;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  /** Called with incremental text as it streams. */
  onDelta?: (text: string) => void;
}

export interface ChatResult {
  text: string;
  toolCalls: ToolCall[];
  finishReason?: string;
  usage?: Usage;
}

export interface LLMClient {
  provider: string;
  model: string;
  /** Human label, e.g. "Gemini · gemini-2.5-flash". */
  label: string;
  chat(opts: ChatOptions): Promise<ChatResult>;
}

export class LlmHttpError extends Error {
  constructor(
    public status: number,
    public bodyText: string,
  ) {
    super(`HTTP ${status}`);
    this.name = 'LlmHttpError';
  }
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 4));
}
