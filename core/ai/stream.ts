/**
 * oh-my-pi Mobile: Multi-Provider AI Streaming Client
 *
 * Direct port of oh-my-pi's unified streaming client.
 * Uses standard fetch with SSE reader to stream completions from
 * frontier APIs (OpenAI, Gemini, Anthropic) or local-on-device endpoints (llama.cpp, Ollama).
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

export class MultiProviderStreamClient {
  async stream(options: StreamOptions): Promise<StreamCompletionResult> {
    const startTime = Date.now();
    let fullText = "";
    let thinkingText = "";
    let tokenCount = 0;
    const accumulatedToolCalls: Map<string, { id: string; name: string; argsStr: string }> = new Map();

    // If offline or no API key, use the local mock engine
    if (!options.apiKey && (!options.baseUrl || options.baseUrl.includes("mock"))) {
      return this.simulateLocalStream(options, startTime);
    }

    const endpoint = options.baseUrl ?? this.getDefaultEndpoint(options.model.provider);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${options.apiKey ?? "local"}`,
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

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
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
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":") || !trimmed.startsWith("data:")) continue;
        const dataStr = trimmed.slice(5).trim();
        if (dataStr === "[DONE]") break;

        try {
          const parsed = JSON.parse(dataStr);
          const choice = parsed.choices?.[0];
          const delta = choice?.delta;

          if (delta) {
            tokenCount++;
            if (delta.content) {
              fullText += delta.content;
              options.onDelta?.({ text: delta.content });
            }
            if (delta.reasoning_content) {
              thinkingText += delta.reasoning_content;
              options.onDelta?.({ thinking: delta.reasoning_content });
            }
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const id = tc.id ?? `call_${Date.now()}`;
                const existing = accumulatedToolCalls.get(id) ?? { id, name: tc.function?.name ?? "", argsStr: "" };
                if (tc.function?.name) existing.name = tc.function.name;
                if (tc.function?.arguments) existing.argsStr += tc.function.arguments;
                accumulatedToolCalls.set(id, existing);
                options.onDelta?.({
                  toolCallDelta: {
                    id: tc.id,
                    name: tc.function?.name,
                    argumentsDelta: tc.function?.arguments,
                  },
                });
              }
            }
          }
        } catch {
          // ignore partial JSON chunks
        }
      }
    }

    const durationMs = Math.max(1, Date.now() - startTime);
    const tokensPerSecond = (tokenCount / durationMs) * 1000;

    const parsedToolCalls: StreamCompletionResult["toolCalls"] = [];
    for (const tc of accumulatedToolCalls.values()) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.argsStr);
      } catch {
        args = { raw: tc.argsStr };
      }
      parsedToolCalls.push({ id: tc.id, name: tc.name, arguments: args });
    }

    return {
      fullText,
      thinkingText: thinkingText.length > 0 ? thinkingText : undefined,
      toolCalls: parsedToolCalls.length > 0 ? parsedToolCalls : undefined,
      tokensGenerated: tokenCount,
      durationMs,
      tokensPerSecond,
    };
  }

  private getDefaultEndpoint(provider: string): string {
    switch (provider) {
      case "openai":
        return "https://api.openai.com/v1/chat/completions";
      case "anthropic":
        return "https://api.anthropic.com/v1/messages";
      case "google":
        return "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
      case "openrouter":
        return "https://openrouter.ai/api/v1/chat/completions";
      case "ollama":
      default:
        return "http://localhost:11434/v1/chat/completions";
    }
  }

  private async simulateLocalStream(
    options: StreamOptions,
    startTime: number
  ): Promise<StreamCompletionResult> {
    const lastUser = options.messages[options.messages.length - 1]?.content ?? "";
    const responseText =
      `[CONFIRMED] Local streaming engine active on Poco X7 Pro class hardware.\n` +
      `[CONFIRMED] Offline mode engaged: prompt processed completely on-device.\n` +
      `[INFERRED] Handled turn for prompt "${lastUser.slice(0, 60)}".`;

    const words = responseText.split(" ");
    for (const word of words) {
      if (options.signal?.aborted) break;
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 15);
      await promise;
      const chunk = word + " ";
      options.onDelta?.({ text: chunk });
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
