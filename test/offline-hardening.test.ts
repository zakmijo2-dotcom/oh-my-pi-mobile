import { describe, expect, it } from "bun:test";
import {
  HashlineChunk,
  MemoryStorageBackend,
  MobileAgentLoop,
  OhMyPiCoreEngine,
  RpcDispatcher,
  TodoStateMachine,
} from "../core";
import type { CoreRpcEvent } from "../core/types";

describe("Phase 5: Local-Only Offline Hardening", () => {
  it("executes full core workflow in airplane mode with severed network", async () => {
    // Simulate airplane mode by overriding global fetch to always fail
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new TypeError("Airplane mode: network unreachable");
    };

    try {
      const memory = new MemoryStorageBackend();
      const engine = new OhMyPiCoreEngine({ storageBackend: memory, offlineOnly: true });

      const events: CoreRpcEvent[] = [];
      engine.onEvent((e) => events.push(e));

      // 1. Startup offline
      await engine.init();
      expect(events.some((e) => e.type === "ready")).toBe(true);

      // 2. Prompt execution offline
      await engine.dispatch({
        type: "prompt",
        message: "Verify airplane mode operation",
      });

      expect(events.some((e) => e.type === "turn_start")).toBe(true);
      expect(events.some((e) => e.type === "message_end")).toBe(true);
      expect(events.some((e) => e.type === "turn_end")).toBe(true);

      const assistantMsg = engine.getMessages().find((m) => m.role === "assistant");
      expect(assistantMsg).toBeDefined();
      expect(assistantMsg?.evidence?.some((ev) => ev.grade === "CONFIRMED")).toBe(true);

      // 3. Local tool execution offline
      await engine.dispatch({
        type: "execute_tool",
        name: "todo",
        args: {
          op: "init",
          items: ["Offline task 1", "Offline task 2"],
        },
      });

      const todoEnd = events.find((e) => e.type === "tool_end" && e.name === "todo");
      expect(todoEnd).toBeDefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("recovers gracefully from corrupted storage records without crashing", async () => {
    const memory = new MemoryStorageBackend();
    // Intentionally inject invalid corrupted JSON into session keys
    await memory.setItem("omp_active_session_id", "corrupt_session_id");
    await memory.setItem("omp_session_corrupt_session_id", "NOT_JSON_DATA_!!!");
    await memory.setItem("omp_credential_vault", "{{{{invalid-json");

    const engine = new OhMyPiCoreEngine({ storageBackend: memory, offlineOnly: true });

    // Should not throw, should cleanly recover to fresh session
    await engine.init();
    expect(engine.getState().sessionId).toBeDefined();
    expect(engine.getMessages()).toEqual([]);
  });

  it("handles repeated restarts and preserves state integrity", async () => {
    const memory = new MemoryStorageBackend();

    // Session 1: write files and set todos
    const engine1 = new OhMyPiCoreEngine({ storageBackend: memory, offlineOnly: true });
    await engine1.init();
    await engine1.dispatch({ type: "prompt", message: "Turn 1" });
    await engine1.dispatch({
      type: "set_todos",
      phases: [{ phase: "P1", items: [{ id: "1", task: "T1", phase: "P1", status: "done" }] }],
    });
    const session1Id = engine1.getState().sessionId;

    // Simulate App Restart 1
    const engine2 = new OhMyPiCoreEngine({ storageBackend: memory, offlineOnly: true });
    await engine2.init();
    expect(engine2.getState().sessionId).toBe(session1Id);
    expect(engine2.getState().todoPhases.length).toBe(1);
    expect(engine2.getMessages().length).toBe(2);

    // Add another turn
    await engine2.dispatch({ type: "prompt", message: "Turn 2" });

    // Simulate App Restart 2
    const engine3 = new OhMyPiCoreEngine({ storageBackend: memory, offlineOnly: true });
    await engine3.init();
    expect(engine3.getMessages().length).toBe(4);
  });
});
