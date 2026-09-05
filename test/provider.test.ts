import { describe, expect, it } from "bun:test";
import {
  AnthropicMessagesAdapter,
  OfflineDemoAdapter,
  OpenAICompatibleAdapter,
  StreamParseState,
  VERIFIED_MODEL_CATALOG,
} from "../core/ai/stream";
import type { ModelDescriptor, ToolDefinition } from "../core/types";

describe("Phase 5: Honest Provider Abstraction & Authentic SSE Parsing", () => {
  const sampleTools: ToolDefinition[] = [
    {
      name: "write",
      description: "Write file to disk",
      parameters: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
        required: ["path", "content"],
      },
      tier: "essential",
    },
  ];

  it("OpenAI adapter builds compliant request and parses choices[0].delta SSE stream", () => {
    const adapter = new OpenAICompatibleAdapter();
    const model: ModelDescriptor = {
      id: "gpt-4o-mini",
      name: "GPT-4o Mini",
      provider: "openai",
      contextWindow: 128000,
      maxTokens: 16384,
      inputModalities: ["text"],
    };

    const req = adapter.buildRequest({
      model,
      apiKey: "sk-openai-test-key",
      systemPrompt: "You are a coding assistant.",
      messages: [{ role: "user", content: "Write code" }],
      tools: sampleTools,
    });

    expect(req.endpoint).toBe("https://api.openai.com/v1/chat/completions");
    expect(req.headers["Authorization"]).toBe("Bearer sk-openai-test-key");
    const body = req.body as any;
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.stream).toBe(true);
    expect(body.tools[0].function.name).toBe("write");

    // Test SSE parsing
    const state: StreamParseState = {
      currentEvent: "",
      openBlocks: new Map(),
      accumulatedToolCalls: new Map(),
      fullText: "",
      thinkingText: "",
      tokenCount: 0,
    };

    const deltas: string[] = [];
    const lines = [
      'data: {"choices":[{"delta":{"content":"Hello "}}]}',
      'data: {"choices":[{"delta":{"content":"world!"}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"id":"call_1","function":{"name":"write","arguments":"{\\"path\\":\\""}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"id":"call_1","function":{"arguments":"test.txt\\"}"}}]}}]}',
      "data: [DONE]",
    ];

    let finished = false;
    for (const l of lines) {
      if (adapter.parseSseLine(l, state, (d) => { if (d.text) deltas.push(d.text); })) {
        finished = true;
      }
    }

    expect(finished).toBe(true);
    expect(state.fullText).toBe("Hello world!");
    expect(state.accumulatedToolCalls.get("call_1")?.name).toBe("write");
    expect(state.accumulatedToolCalls.get("call_1")?.argsStr).toBe('{"path":"test.txt"}');
  });

  it("Gate 5: Anthropic adapter builds authentic Messages API payload and parses native event stream", () => {
    const adapter = new AnthropicMessagesAdapter();
    const model: ModelDescriptor = {
      id: "claude-3-7-sonnet-20250219",
      name: "Claude 3.7 Sonnet",
      provider: "anthropic",
      contextWindow: 200000,
      maxTokens: 64000,
      reasoning: true,
      inputModalities: ["text", "image"],
    };

    const req = adapter.buildRequest({
      model,
      apiKey: "sk-ant-test-key",
      systemPrompt: "You are oh-my-pi Mobile.",
      messages: [{ role: "user", content: "Create file" }],
      tools: sampleTools,
    });

    expect(req.endpoint).toBe("https://api.anthropic.com/v1/messages");
    expect(req.headers["x-api-key"]).toBe("sk-ant-test-key");
    expect(req.headers["anthropic-version"]).toBe("2023-06-01");

    const body = req.body as any;
    expect(body.system).toBe("You are oh-my-pi Mobile.");
    expect(body.tools[0].name).toBe("write");
    expect(body.tools[0].input_schema).toBeDefined();

    // Authentic Anthropic SSE Event Stream
    const state: StreamParseState = {
      currentEvent: "",
      openBlocks: new Map(),
      accumulatedToolCalls: new Map(),
      fullText: "",
      thinkingText: "",
      tokenCount: 0,
    };

    const sseFeed = [
      "event: message_start",
      'data: {"type":"message_start","message":{"id":"msg_123","usage":{"input_tokens":15}}}',
      "event: content_block_start",
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking"}}',
      "event: content_block_delta",
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Planning file structure..."}}',
      "event: content_block_stop",
      'data: {"type":"content_block_stop","index":0}',
      "event: content_block_start",
      'data: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}',
      "event: content_block_delta",
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"I will now create the requested file."}}',
      "event: content_block_stop",
      'data: {"type":"content_block_stop","index":1}',
      "event: content_block_start",
      'data: {"type":"content_block_start","index":2,"content_block":{"type":"tool_use","id":"toolu_999","name":"write"}}',
      "event: content_block_delta",
      'data: {"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\": \\"index.ts\\","}}',
      "event: content_block_delta",
      'data: {"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":" \\"content\\": \\"ok\\"}"}}',
      "event: content_block_stop",
      'data: {"type":"content_block_stop","index":2}',
      "event: message_delta",
      'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":48}}',
      "event: message_stop",
      'data: {"type":"message_stop"}',
    ];

    let ended = false;
    for (const line of sseFeed) {
      if (adapter.parseSseLine(line, state, () => {})) {
        ended = true;
      }
    }

    expect(ended).toBe(true);
    expect(state.thinkingText).toBe("Planning file structure...");
    expect(state.fullText).toBe("I will now create the requested file.");
    expect(state.accumulatedToolCalls.get("toolu_999")?.name).toBe("write");
    expect(state.accumulatedToolCalls.get("toolu_999")?.argsStr).toBe('{"path": "index.ts", "content": "ok"}');
  });

  it("OfflineDemoAdapter honestly labels output and never claims [CONFIRMED]", async () => {
    const demo = new OfflineDemoAdapter();
    const model: ModelDescriptor = {
      id: "demo-model",
      name: "Demo Model",
      provider: "mock",
      contextWindow: 4096,
      maxTokens: 1024,
      inputModalities: ["text"],
    };

    const res = await demo.runSimulatedStream(
      {
        model,
        messages: [{ role: "user", content: "Tell me a joke" }],
      },
      () => {}
    );

    expect(res.fullText).toContain("[DEMO / OFFLINE PLACEHOLDER]");
    expect(res.fullText).not.toContain("[CONFIRMED]");
  });

  it("Verified Model Catalog exposes real capability flags", () => {
    expect(VERIFIED_MODEL_CATALOG.length).toBeGreaterThanOrEqual(4);

    const sonnet = VERIFIED_MODEL_CATALOG.find((m) => m.id.includes("claude"));
    expect(sonnet).toBeDefined();
    expect(sonnet?.supportsToolCalling).toBe(true);
    expect(sonnet?.supportsReasoning).toBe(true);
    expect(sonnet?.contextWindow).toBe(200000);

    const llama = VERIFIED_MODEL_CATALOG.find((m) => m.id === "local-llama");
    expect(llama).toBeDefined();
    expect(llama?.supportsReasoning).toBe(false);
  });
});
