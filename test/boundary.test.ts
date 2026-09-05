import { describe, expect, it } from "bun:test";
import { MemoryStorageBackend, OhMyPiCoreEngine } from "../core";
import type { CoreRpcEvent } from "../core/types";

describe("Core Module Boundary & Persistence Verification", () => {
  it("initializes cleanly with default local state", async () => {
    const memory = new MemoryStorageBackend();
    const engine = new OhMyPiCoreEngine({ storageBackend: memory, offlineOnly: true });

    const events: CoreRpcEvent[] = [];
    engine.onEvent((evt) => events.push(evt));

    await engine.init();

    expect(events.some((e) => e.type === "ready")).toBe(true);
    expect(events.some((e) => e.type === "state_update")).toBe(true);

    const state = engine.getState();
    expect(state.sessionId).toBeDefined();
    expect(state.offlineOnly).toBe(true);
    expect(state.activeModel.provider).toBe("google");
  });

  it("handles prompt command and emits turn lifecycle events", async () => {
    const memory = new MemoryStorageBackend();
    const engine = new OhMyPiCoreEngine({ storageBackend: memory, offlineOnly: true });
    await engine.init();

    const events: CoreRpcEvent[] = [];
    engine.onEvent((evt) => events.push(evt));

    await engine.dispatch({ type: "prompt", message: "Verify local core engine" });

    expect(events.some((e) => e.type === "turn_start")).toBe(true);
    expect(events.some((e) => e.type === "message_delta")).toBe(true);
    expect(events.some((e) => e.type === "turn_end")).toBe(true);

    const messages = engine.getMessages();
    expect(messages.length).toBe(2);
    expect(messages[0].role).toBe("user");
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].evidence).toBeDefined();
    expect(messages[1].evidence?.some((ev) => ev.grade === "CONFIRMED")).toBe(true);
  });

  it("persists and restores state across sessions", async () => {
    const memory = new MemoryStorageBackend();
    const engine1 = new OhMyPiCoreEngine({ storageBackend: memory, offlineOnly: true });
    await engine1.init();

    await engine1.dispatch({ type: "prompt", message: "Initial message in session 1" });
    const session1Id = engine1.getState().sessionId;

    // Simulate app restart with same storage backend
    const engine2 = new OhMyPiCoreEngine({ storageBackend: memory, offlineOnly: true });
    await engine2.init();

    expect(engine2.getState().sessionId).toBe(session1Id);
    expect(engine2.getMessages().length).toBe(2);
    expect(engine2.getMessages()[0].content).toBe("Initial message in session 1");
  });
});
