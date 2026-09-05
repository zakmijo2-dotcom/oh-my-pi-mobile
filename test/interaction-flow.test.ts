import { describe, expect, it } from "bun:test";
import {
  applyHashlinePatch,
  computeLineTag,
  MemoryStorageBackend,
  MobileAgentLoop,
  OhMyPiCoreEngine,
  RpcDispatcher,
  TodoStateMachine,
} from "../core";
import type { CoreRpcEvent } from "../core/types";

describe("Gate 4: Full End-to-End Interaction Flow", () => {
  it("executes input -> processing -> graded output -> follow-up action with real logic", async () => {
    // 1. Initialize Core Engine with real local storage backend
    const memoryStore = new MemoryStorageBackend();
    const engine = new OhMyPiCoreEngine({ storageBackend: memoryStore, offlineOnly: true });

    const receivedEvents: CoreRpcEvent[] = [];
    engine.onEvent((evt) => receivedEvents.push(evt));

    await engine.init();
    expect(receivedEvents.some((e) => e.type === "ready")).toBe(true);

    // 2. INPUT: Submit user prompt
    const userPrompt = "Analyze local environment and verify portability risks";
    await engine.dispatch({ type: "prompt", message: userPrompt });

    // 3. PROCESSING: Verify event pipeline
    expect(receivedEvents.some((e) => e.type === "turn_start")).toBe(true);
    expect(receivedEvents.some((e) => e.type === "message_start")).toBe(true);
    expect(receivedEvents.some((e) => e.type === "message_delta")).toBe(true);
    expect(receivedEvents.some((e) => e.type === "turn_end")).toBe(true);

    // 4. GRADED OUTPUT: Verify evidence-graded claims extracted from real output
    const messages = engine.getMessages();
    const assistantMsg = messages.find((m) => m.role === "assistant");
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg?.evidence).toBeDefined();

    const evidence = assistantMsg?.evidence ?? [];
    expect(evidence.length).toBeGreaterThanOrEqual(2);
    expect(evidence.some((ev) => ev.grade === "CONFIRMED")).toBe(true);
    expect(evidence.some((ev) => ev.grade === "INFERRED")).toBe(true);

    // 5. FOLLOW-UP ACTION: Execute real Hashline edit mutation as follow-up
    const agentLoop = new MobileAgentLoop();
    await agentLoop.getWorkspace().writeFile(
      "src/engine.ts",
      "export const version = '1.0.0';\nexport const status = 'alpha';\n"
    );

    const hashlinePatch = "PUT 2.=2:\n+export const status = 'production';";
    const editOutcome = await agentLoop.executeTool("edit", {
      path: "src/engine.ts",
      input: hashlinePatch,
    });

    expect(editOutcome.isError).toBe(false);
    const updatedFile = await agentLoop.getWorkspace().readFile("src/engine.ts");
    expect(updatedFile.content).toContain("export const status = 'production';");

    // 6. FOLLOW-UP ACTION: Execute real Todo state machine auto-promotion
    const todoOutcome = await agentLoop.executeTool("todo", {
      op: "init",
      list: [
        { phase: "Delivery", items: ["Implement UI", "Verify APK"] },
      ],
    });
    expect(todoOutcome.isError).toBe(false);
    const todoPhases = agentLoop.getTodo().getPhases();
    expect(todoPhases[0].items[0].status).toBe("in_progress");

    // Complete the task and observe automatic promotion
    const doneOutcome = await agentLoop.executeTool("todo", {
      op: "done",
      task: "Implement UI",
    });
    expect(doneOutcome.isError).toBe(false);
    const updatedPhases = agentLoop.getTodo().getPhases();
    expect(updatedPhases[0].items[0].status).toBe("done");
    expect(updatedPhases[0].items[1].status).toBe("in_progress"); // Auto-promoted!
  });
});
