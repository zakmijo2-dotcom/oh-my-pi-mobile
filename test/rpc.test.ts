import { describe, expect, it } from "bun:test";
import { RpcDispatcher } from "../core/rpc/dispatcher";
import type { CoreRpcEvent } from "../core/types";

describe("RPC Protocol Dispatcher Parity", () => {
  it("emits ready frame upon initialization", async () => {
    const events: CoreRpcEvent[] = [];
    const rpc = new RpcDispatcher((frame) => {
      events.push(JSON.parse(frame));
    });

    await rpc.init();

    expect(events.some((e) => e.type === "ready")).toBe(true);
    expect(events.some((e) => e.type === "state_update")).toBe(true);
  });

  it("handles prompt command and streams turns through NDJSON", async () => {
    const events: CoreRpcEvent[] = [];
    const rpc = new RpcDispatcher((frame) => {
      events.push(JSON.parse(frame));
    });
    await rpc.init();

    await rpc.handleInputLine(JSON.stringify({ type: "prompt", message: "Run mobile test" }));

    expect(events.some((e) => e.type === "turn_start")).toBe(true);
    expect(events.some((e) => e.type === "message_start")).toBe(true);
    expect(events.some((e) => e.type === "message_delta")).toBe(true);
    expect(events.some((e) => e.type === "turn_end")).toBe(true);
  });

  it("updates model and thinking level via RPC commands", async () => {
    const events: CoreRpcEvent[] = [];
    const rpc = new RpcDispatcher((frame) => {
      events.push(JSON.parse(frame));
    });
    await rpc.init();

    await rpc.handleInputLine(
      JSON.stringify({ type: "set_model", provider: "anthropic", modelId: "claude-sonnet-4.5" })
    );
    expect(rpc.getState().activeModel.id).toBe("claude-sonnet-4.5");

    await rpc.handleInputLine(
      JSON.stringify({ type: "set_thinking_level", level: "high" })
    );
    expect(rpc.getState().thinkingLevel).toBe("high");
  });

  it("executes tools directly over RPC", async () => {
    const events: CoreRpcEvent[] = [];
    const rpc = new RpcDispatcher((frame) => {
      events.push(JSON.parse(frame));
    });
    await rpc.init();

    await rpc.handleInputLine(
      JSON.stringify({
        type: "execute_tool",
        name: "write",
        args: { path: "test.txt", content: "data from RPC" },
      })
    );

    const toolEnd = events.find((e) => e.type === "tool_end");
    expect(toolEnd).toBeDefined();
    expect(toolEnd && "isError" in toolEnd && toolEnd.isError).toBe(false);
  });
});
