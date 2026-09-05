import { describe, expect, it } from "bun:test";
import { TodoStateMachine } from "../core/tools/todo";

describe("Todo State Machine Parity", () => {
  it("initializes phases and auto-promotes earliest pending task", () => {
    const sm = new TodoStateMachine();
    const result = sm.execute({
      op: "init",
      list: [
        { phase: "Setup", items: ["Scaffold project", "Setup persistence"] },
        { phase: "Build", items: ["Compile core", "Build APK"] },
      ],
    });

    expect(result.phases.length).toBe(2);
    expect(result.phases[0].items[0].status).toBe("in_progress");
    expect(result.phases[0].items[1].status).toBe("pending");
    expect(result.activeTask?.task).toBe("Scaffold project");
  });

  it("auto-promotes next pending task upon completing current task", () => {
    const sm = new TodoStateMachine();
    sm.execute({
      op: "init",
      list: [{ phase: "Phase 1", items: ["Task 1", "Task 2"] }],
    });

    const result = sm.execute({ op: "done", task: "Task 1" });
    const p1 = result.phases[0];

    expect(p1.items[0].status).toBe("done");
    expect(p1.items[1].status).toBe("in_progress");
    expect(result.activeTask?.task).toBe("Task 2");
  });

  it("never auto-promotes blocked tasks", () => {
    const sm = new TodoStateMachine();
    sm.execute({
      op: "init",
      list: [{ phase: "Phase 1", items: ["Task 1", "Task 2", "Task 3"] }],
    });

    // Block Task 2
    sm.execute({ op: "block", task: "Task 2", reason: "Awaiting external input" });
    const p1Before = sm.getPhases()[0];
    expect(p1Before.items[1].status).toBe("blocked");

    // Finish Task 1 -> should skip blocked Task 2 and auto-promote Task 3!
    const result = sm.execute({ op: "done", task: "Task 1" });
    const p1After = result.phases[0];

    expect(p1After.items[0].status).toBe("done");
    expect(p1After.items[1].status).toBe("blocked");
    expect(p1After.items[2].status).toBe("in_progress");
    expect(result.activeTask?.task).toBe("Task 3");
  });

  it("keeps only earliest in_progress when multiple are started", () => {
    const sm = new TodoStateMachine();
    sm.execute({
      op: "init",
      items: ["Task A", "Task B", "Task C"],
    });

    // Manually start Task B
    const result = sm.execute({ op: "start", task: "Task B" });
    const items = result.phases[0].items;

    // Task B becomes the single in_progress; Task A was demoted to pending
    expect(items[0].status).toBe("pending");
    expect(items[1].status).toBe("in_progress");
    expect(items[2].status).toBe("pending");
    expect(result.activeTask?.task).toBe("Task B");
  });

  it("unblocks task back to pending", () => {
    const sm = new TodoStateMachine();
    sm.execute({
      op: "init",
      items: ["Task A", "Task B"],
    });
    sm.execute({ op: "block", task: "Task B" });
    const res = sm.execute({ op: "unblock", task: "Task B" });

    expect(res.phases[0].items[1].status).toBe("pending");
  });
});
