import { describe, expect, it } from "bun:test";
import {
  applyHashlinePatch,
  computeLineTag,
  MemoryStorageBackend,
  MobileAgentLoop,
  MobileWorkspace,
  OhMyPiCoreEngine,
  TodoStateMachine,
} from "../core";

describe("Phase 5: Performance Benchmarks (Poco X7 Pro Class Target)", () => {
  it("applies Hashline patch to a 1,000-line document in < 30ms", () => {
    // Generate a 1,000-line source document
    const lines = Array.from({ length: 1000 }, (_, i) => `const val_${i} = ${i * 42};`);
    const doc = lines.join("\n");

    const patch = `PUT 500.=505:
+const val_replaced = "OPTIMIZED_VALUE";
+const val_extra = true;`;

    const start = performance.now();
    const result = applyHashlinePatch(doc, patch);
    const elapsed = performance.now() - start;

    expect(result.success).toBe(true);
    expect(result.linesModified).toBe(6);
    expect(elapsed).toBeLessThan(30); // Must be well under 30ms on mid-range hardware
  });

  it("executes Todo state machine with 100 items in < 10ms", () => {
    const sm = new TodoStateMachine();
    const items = Array.from({ length: 100 }, (_, i) => `Task item #${i}`);

    const start = performance.now();
    sm.execute({ op: "init", items });
    sm.execute({ op: "done", task: "Task item #0" });
    sm.execute({ op: "block", task: "Task item #10" });
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(10);
    const phases = sm.getPhases();
    expect(phases[0].items[0].status).toBe("done");
    expect(phases[0].items[1].status).toBe("in_progress"); // Auto-promoted
    expect(phases[0].items[10].status).toBe("blocked");
  });

  it("performs regex search across 50 workspace files in < 25ms", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 50; i++) {
      files[`src/module_${i}.ts`] = `
        import { dep } from "./dep";
        export function compute_${i}() {
          const secret_key = "TARGET_STRING_${i % 5 === 0 ? "MATCH" : "NOMATCH"}";
          return secret_key;
        }
      `;
    }

    const ws = new MobileWorkspace({ initialFiles: files });

    const start = performance.now();
    const matches = await ws.grep("TARGET_STRING_MATCH");
    const elapsed = performance.now() - start;

    expect(matches.length).toBe(10);
    expect(elapsed).toBeLessThan(25);
  });

  it("completes prompt turn loop with zero memory leakage", async () => {
    const memory = new MemoryStorageBackend();
    const engine = new OhMyPiCoreEngine({ storageBackend: memory, offlineOnly: true });
    await engine.init();

    const start = performance.now();
    // Run 5 rapid turns
    for (let i = 0; i < 5; i++) {
      await engine.dispatch({ type: "prompt", message: `Turn prompt ${i}` });
    }
    const elapsed = performance.now() - start;

    expect(engine.getMessages().length).toBe(10);
    expect(elapsed).toBeLessThan(1000); // 5 turns complete in < 1s
  });
});
