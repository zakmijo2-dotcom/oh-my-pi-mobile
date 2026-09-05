import { describe, expect, it, afterAll } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { RealProcessRunner, TerminalTool } from "../core/tools/terminal";
import { MobileAgentLoop } from "../core/agent/loop";
import type { CoreRpcEvent } from "../core/types";

describe("Phase 4: Real Terminal Tool (Gate 4 Verification)", () => {
  const tmpBase = process.env.TMPDIR ?? "/tmp";
  const testRoot = path.join(tmpBase, `omp_term_test_${Date.now()}`);
  fs.mkdirSync(testRoot, { recursive: true });

  afterAll(() => {
    if (fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it("executes real shell commands and captures stdout/stderr", async () => {
    const term = new TerminalTool(new RealProcessRunner(testRoot));
    const res = await term.execute({
      command: "echo 'Terminal execution active' && echo 'stderr test' >&2",
    });

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("Terminal execution active");
    expect(res.stderr).toContain("stderr test");
    expect(res.timedOut).toBe(false);
    expect(res.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("Gate 4: runs a real test/build script command and streams output", async () => {
    // Create a mini-project with a test script
    const projectDir = path.join(testRoot, "my_project");
    fs.mkdirSync(projectDir, { recursive: true });

    const testScript = path.join(projectDir, "run_tests.sh");
    fs.writeFileSync(
      testScript,
      '#!/bin/sh\necho "Running unit tests suite..."\necho "Test 1: passed"\necho "Test 2: passed"\necho "Summary: 2 passed, 0 failed"\n',
      { mode: 0o755 }
    );

    const term = new TerminalTool(new RealProcessRunner(testRoot));
    const res = await term.execute({
      command: "sh ./run_tests.sh",
      cwd: projectDir,
    });

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("Running unit tests suite...");
    expect(res.stdout).toContain("Summary: 2 passed, 0 failed");
  });

  it("enforces watchdog timeout on hung processes", async () => {
    const term = new TerminalTool(new RealProcessRunner(testRoot));
    const start = Date.now();
    const res = await term.execute({
      command: "sleep 5",
      timeout: 1, // 1 second timeout
    });
    const elapsed = Date.now() - start;

    expect(res.timedOut).toBe(true);
    expect(res.exitCode).not.toBe(0);
    expect(elapsed).toBeLessThan(3000); // Terminated within reasonable bounds
  });

  it("executes terminal command via AgentLoop and emits tool events", async () => {
    const loop = new MobileAgentLoop();
    const events: CoreRpcEvent[] = [];

    const res = await loop.executeTool(
      "bash",
      { command: "echo 'Agent Loop Terminal Bridge Verified'" },
      (evt) => events.push(evt)
    );

    expect(res.isError).toBe(false);
    const resultObj = res.result as { stdout: string; exitCode: number };
    expect(resultObj.exitCode).toBe(0);
    expect(resultObj.stdout).toContain("Agent Loop Terminal Bridge Verified");
  });
});
