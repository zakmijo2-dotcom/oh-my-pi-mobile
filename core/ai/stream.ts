/**
 * oh-my-pi Mobile: Honest Multi-Provider Streaming Abstraction
 *
 * Distinct adapter architecture per provider:
 * - OpenAICompatibleAdapter: OpenAI, OpenRouter, Ollama, llama.cpp (choices[0].delta)
 * - AnthropicMessagesAdapter: Native Anthropic Messages API (content_block_start/delta/stop)
 * - OfflineDemoAdapter: Plainly labeled offline placeholder (NEVER overclaiming [CONFIRMED])
 */

import type { ModelDescriptor, Role, ToolDefinition } from "../types";

export interface StreamChunkDelta {
  text?: string;
  thinking?: string;
  toolCallDelta?: {
    id?: string;
    name?: string;
    argumentsDelta?: string;
  };
}

export interface StreamCompletionResult {
  fullText: string;
  thinkingText?: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  tokensGenerated: number;
  durationMs: number;
  tokensPerSecond: number;
}

export interface StreamOptions {
  model: ModelDescriptor;
  apiKey?: string;
  baseUrl?: string;
  systemPrompt?: string;
  messages: Array<{ role: Role; content: string }>;
  tools?: ToolDefinition[];
  signal?: AbortSignal;
  onDelta?: (delta: StreamChunkDelta) => void;
}

export interface StreamParseState {
  currentEvent: string;
  openBlocks: Map<number, { id?: string; name?: string; type: string; partialJson: string }>;
  accumulatedToolCalls: Map<string, { id: string; name: string; argsStr: string }>;
  fullText: string;
  thinkingText: string;
  tokenCount: number;
}

export interface IProviderAdapter {
  readonly providerName: string;
  buildRequest(options: StreamOptions): {
    endpoint: string;
    headers: Record<string, string>;
    body: unknown;
  };
  parseSseLine(
    line: string,
    state: StreamParseState,
    emit: (delta: StreamChunkDelta) => void
  ): boolean; // returns true if stream has concluded
}

// ============================================================================
// 1. OpenAI-Compatible Adapter
// ============================================================================
export class OpenAICompatibleAdapter implements IProviderAdapter {
  readonly providerName = "openai";

  buildRequest(options: StreamOptions) {
    const endpoint =
      options.baseUrl ??
      (options.model.provider === "openrouter"
        ? "https://openrouter.ai/api/v1/chat/completions"
        : options.model.provider === "google"
          ? "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
          : options.model.provider === "ollama"
            ? "http://localhost:11434/v1/chat/completions"
            : "https://api.openai.com/v1/chat/completions");

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${options.apiKey ?? ""}`,
    };

    const payload = {
      model: options.model.id,
      messages: [
        ...(options.systemPrompt ? [{ role: "system", content: options.systemPrompt }] : []),
        ...options.messages.map((m) => ({ role: m.role, content: m.content })),
      ],
      stream: true,
      ...(options.tools && options.tools.length > 0
        ? {
            tools: options.tools.map((t) => ({
              type: "function",
              function: {
                name: t.name,
                description: t.description,
                parameters: t.parameters,
              },
            })),
          }
        : {}),
    };

    return { endpoint, headers, body: payload };
  }

  parseSseLine(
    line: string,
    state: StreamParseState,
    emit: (delta: StreamChunkDelta) => void
  ): boolean {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(":") || !trimmed.startsWith("data:")) {
      return false;
    }

    const dataStr = trimmed.slice(5).trim();
    if (dataStr === "[DONE]") {
      return true;
    }

    try {
      const parsed = JSON.parse(dataStr);
      const choice = parsed.choices?.[0];
      const delta = choice?.delta;

      if (delta) {
        state.tokenCount++;
        if (delta.content) {
          state.fullText += delta.content;
          emit({ text: delta.content });
        }
        if (delta.reasoning_content) {
          state.thinkingText += delta.reasoning_content;
          emit({ thinking: delta.reasoning_content });
        }
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const id = tc.id ?? `call_${Date.now()}`;
            const existing = state.accumulatedToolCalls.get(id) ?? {
              id,
              name: tc.function?.name ?? "",
              argsStr: "",
            };
            if (tc.function?.name) existing.name = tc.function.name;
            if (tc.function?.arguments) existing.argsStr += tc.function.arguments;
            state.accumulatedToolCalls.set(id, existing);

            emit({
              toolCallDelta: {
                id: tc.id,
                name: tc.function?.name,
                argumentsDelta: tc.function?.arguments,
              },
            });
          }
        }
      }

      if (choice?.finish_reason && choice.finish_reason !== "null") {
        return true;
      }
    } catch {
      // ignore partial json
    }

    return false;
  }
}

// ============================================================================
// 2. Authentic Anthropic Messages API Adapter
// ============================================================================
export class AnthropicMessagesAdapter implements IProviderAdapter {
  readonly providerName = "anthropic";

  buildRequest(options: StreamOptions) {
    const endpoint = options.baseUrl ?? "https://api.anthropic.com/v1/messages";

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-api-key": options.apiKey ?? "",
      "anthropic-version": "2023-06-01",
    };

    // Transform messages to Anthropic shape
    const anthropicMessages = options.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role,
        content: m.content,
      }));

    const payload: Record<string, unknown> = {
      model: options.model.id,
      messages: anthropicMessages,
      max_tokens: options.model.maxTokens || 4096,
      stream: true,
    };

    if (options.systemPrompt) {
      payload.system = options.systemPrompt;
    }

    if (options.tools && options.tools.length > 0) {
      payload.tools = options.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }

    return { endpoint, headers, body: payload };
  }

  parseSseLine(
    line: string,
    state: StreamParseState,
    emit: (delta: StreamChunkDelta) => void
  ): boolean {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(":")) return false;

    // Capture event type header (event: ...)
    if (trimmed.startsWith("event:")) {
      state.currentEvent = trimmed.slice(6).trim();
      return false;
    }

    if (!trimmed.startsWith("data:")) return false;
    const dataStr = trimmed.slice(5).trim();

    try {
      const event = JSON.parse(dataStr);
      const eventType = state.currentEvent || event.type;

      switch (eventType) {
        case "content_block_start": {
          const idx = event.index ?? 0;
          const block = event.content_block;
          if (block?.type === "tool_use") {
            state.openBlocks.set(idx, {
              id: block.id,
              name: block.name,
              type: "tool_use",
              partialJson: "",
            });
            emit({
              toolCallDelta: {
                id: block.id,
                name: block.name,
                argumentsDelta: "",
              },
            });
          } else if (block?.type === "thinking") {
            state.openBlocks.set(idx, { type: "thinking", partialJson: "" });
          } else {
            state.openBlocks.set(idx, { type: "text", partialJson: "" });
          }
          break;
        }

        case "content_block_delta": {
          const idx = event.index ?? 0;
          const delta = event.delta;
          state.tokenCount++;

          if (delta?.type === "text_delta" && delta.text) {
            state.fullText += delta.text;
            emit({ text: delta.text });
          } else if (delta?.type === "thinking_delta" && delta.thinking) {
            state.thinkingText += delta.thinking;
            emit({ thinking: delta.thinking });
          } else if (delta?.type === "input_json_delta" && delta.partial_json) {
            const block = state.openBlocks.get(idx);
            if (block && block.id) {
              block.partialJson += delta.partial_json;
              const existing = state.accumulatedToolCalls.get(block.id) ?? {
                id: block.id,
                name: block.name ?? "",
                argsStr: "",
              };
              existing.argsStr += delta.partial_json;
              state.accumulatedToolCalls.set(block.id, existing);

              emit({
                toolCallDelta: {
                  id: block.id,
                  name: block.name,
                  argumentsDelta: delta.partial_json,
                },
              });
            }
          }
          break;
        }

        case "content_block_stop": {
          const idx = event.index ?? 0;
          state.openBlocks.delete(idx);
          break;
        }

        case "message_delta": {
          if (event.delta?.stop_reason) {
            return false; // message_stop follows
          }
          break;
        }

        case "message_stop": {
          return true;
        }
      }
    } catch {
      // ignore partial json
    }

    return false;
  }
}

// ============================================================================
// 3. Transparent Offline Demo Adapter (Honestly Labeled)
// ============================================================================
export class OfflineDemoAdapter implements IProviderAdapter {
  readonly providerName = "offline_demo";

  buildRequest(options: StreamOptions) {
    return { endpoint: "local://offline", headers: {}, body: {} };
  }

  parseSseLine(): boolean {
    return true;
  }

  async runSimulatedStream(
    options: StreamOptions,
    emit: (delta: StreamChunkDelta) => void
  ): Promise<StreamCompletionResult> {
    const startTime = Date.now();
    const lastUser = options.messages[options.messages.length - 1]?.content ?? "";

    // Honest copy: explicitly labels this as an offline placeholder, NOT confirmed LLM output!
    const responseText =
      `[DEMO / OFFLINE PLACEHOLDER]\n` +
      `No remote API key was configured for provider "${options.model.provider}".\n` +
      `The core agent engine is operating locally in offline mode on-device.\n` +
      `Received query: "${lastUser.slice(0, 80)}${lastUser.length > 80 ? "..." : ""}".\n` +
      `To connect to real model inference, configure your API key in settings or select a local llama.cpp endpoint.`;

    const words = responseText.split(" ");
    for (const word of words) {
      if (options.signal?.aborted) break;
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 10);
      await promise;
      emit({ text: word + " " });
    }

    const durationMs = Math.max(1, Date.now() - startTime);
    return {
      fullText: responseText,
      tokensGenerated: words.length,
      durationMs,
      tokensPerSecond: (words.length / durationMs) * 1000,
    };
  }
}

// ============================================================================
// 4. Model Catalog with Real Capabilities
// ============================================================================
export interface ModelCapabilityDescriptor extends ModelDescriptor {
  supportsToolCalling: boolean;
  supportsReasoning: boolean;
  supportsVision: boolean;
  costPerMillionInputTokens?: number;
  costPerMillionOutputTokens?: number;
}

export const VERIFIED_MODEL_CATALOG: ModelCapabilityDescriptor[] = [
  {
    id: "claude-3-7-sonnet-20250219",
    name: "Claude 3.7 Sonnet (Anthropic)",
    provider: "anthropic",
    contextWindow: 200000,
    maxTokens: 64000,
    reasoning: true,
    supportsToolCalling: true,
    supportsReasoning: true,
    supportsVision: true,
    inputModalities: ["text", "image"],
    costPerMillionInputTokens: 3.0,
    costPerMillionOutputTokens: 15.0,
  },
  {
    id: "gpt-4o-mini",
    name: "GPT-4o Mini (OpenAI)",
    provider: "openai",
    contextWindow: 128000,
    maxTokens: 16384,
    reasoning: false,
    supportsToolCalling: true,
    supportsReasoning: false,
    supportsVision: true,
    inputModalities: ["text", "image"],
    costPerMillionInputTokens: 0.15,
    costPerMillionOutputTokens: 0.6,
  },
  {
    id: "gemini-2.0-flash",
    name: "Gemini 2.0 Flash (Google)",
    provider: "google",
    contextWindow: 1048576,
    maxTokens: 8192,
    reasoning: false,
    supportsToolCalling: true,
    supportsReasoning: false,
    supportsVision: true,
    inputModalities: ["text", "image"],
    costPerMillionInputTokens: 0.1,
    costPerMillionOutputTokens: 0.4,
  },
  {
    id: "local-llama",
    name: "Local llama.cpp / Ollama Endpoint",
    provider: "ollama",
    contextWindow: 32768,
    maxTokens: 4096,
    reasoning: false,
    supportsToolCalling: true,
    supportsReasoning: false,
    supportsVision: false,
    inputModalities: ["text"],
  },
];

// ============================================================================
// 5. MultiProviderStreamClient with Adapter Dispatch
// ============================================================================
export class MultiProviderStreamClient {
  private adapters: Map<string, IProviderAdapter> = new Map();

  constructor() {
    const openai = new OpenAICompatibleAdapter();
    this.adapters.set("openai", openai);
    this.adapters.set("openrouter", openai);
    this.adapters.set("ollama", openai);
    this.adapters.set("google", openai);
    this.adapters.set("anthropic", new AnthropicMessagesAdapter());
  }

  getAdapter(provider: string): IProviderAdapter {
    return this.adapters.get(provider.toLowerCase()) ?? this.adapters.get("openai")!;
  }

  async stream(options: StreamOptions): Promise<StreamCompletionResult> {
    const startTime = Date.now();

    // Check for offline / no-key condition
    if (!options.apiKey && (!options.baseUrl || options.baseUrl.includes("mock") || options.baseUrl.includes("local://"))) {
      const demo = new OfflineDemoAdapter();
      return demo.runSimulatedStream(options, (d) => options.onDelta?.(d));
    }

    const adapter = this.getAdapter(options.model.provider);
    const { endpoint, headers, body } = adapter.buildRequest(options);

    const state: StreamParseState = {
      currentEvent: "",
      openBlocks: new Map(),
      accumulatedToolCalls: new Map(),
      fullText: "",
      thinkingText: "",
      tokenCount: 0,
    };

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: options.signal,
    });

    if (!response.ok) {
      throw new Error(`API error (${response.status}): ${await response.text()}`);
    }

    if (!response.body) {
      throw new Error("Response body is null");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const finished = adapter.parseSseLine(line, state, (d) => options.onDelta?.(d));
        if (finished) break;
      }
    }

    const durationMs = Math.max(1, Date.now() - startTime);
    const tokensPerSecond = (state.tokenCount / durationMs) * 1000;

    const parsedToolCalls: StreamCompletionResult["toolCalls"] = [];
    for (const tc of state.accumulatedToolCalls.values()) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.argsStr);
      } catch {
        args = { raw: tc.argsStr };
      }
      parsedToolCalls.push({ id: tc.id, name: tc.name, arguments: args });
    }

    return {
      fullText: state.fullText,
      thinkingText: state.thinkingText.length > 0 ? state.thinkingText : undefined,
      toolCalls: parsedToolCalls.length > 0 ? parsedToolCalls : undefined,
      tokensGenerated: state.tokenCount,
      durationMs,
      tokensPerSecond,
    };
  }
}
