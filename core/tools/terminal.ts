/**
 * oh-my-pi Mobile: Real Terminal Tool (bash / terminal)
 *
 * Backed by OmpCoreBridge.execCommand via ProcessBuilder.
 * Runs real commands on the host Android environment with:
 * - Strict execution timeouts (watchdog thread / process destruction)
 * - Working-directory scoping
 * - Environment allowlist (PATH, HOME, TMPDIR, TERM, LANG)
 * - Explicit non-root / sandbox limits documentation
 */

export interface TerminalToolParams {
  command: string;
  cwd?: string;
  timeout?: number; // seconds
}

export interface TerminalToolResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export interface IProcessRunner {
  exec(
    cmd: string,
    args: string[],
    cwd: string,
    timeoutMs: number
  ): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }>;
}

export class RealProcessRunner implements IProcessRunner {
  private workspaceRoot: string;

  constructor(workspaceRoot?: string) {
    this.workspaceRoot = workspaceRoot ?? (process.env.TMPDIR ?? "/tmp");
  }

  async exec(
    cmd: string,
    args: string[],
    cwd = ".",
    timeoutMs = 30000
  ): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }> {
    // 1. Android WebView Native Bridge execution
    if (typeof window !== "undefined") {
      const win = window as unknown as {
        OmpNativeBridge?: {
          execCommand(cmd: string, argsJson: string, cwdRel: string, timeoutMs: number): string;
        };
      };
      if (win.OmpNativeBridge && typeof win.OmpNativeBridge.execCommand === "function") {
        const raw = win.OmpNativeBridge.execCommand(cmd, JSON.stringify(args), cwd, timeoutMs);
        try {
          return JSON.parse(raw);
        } catch {
          return {
            exitCode: -1,
            stdout: "",
            stderr: "Failed to parse bridge exec output: " + raw,
            timedOut: false,
          };
        }
      }
    }

    // 2. Node / Bun on-disk execution (for tests and dev workstation)
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { spawn } = require("node:child_process");
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const path = require("node:path");

      const resolvedCwd = path.isAbsolute(cwd) ? cwd : path.resolve(this.workspaceRoot, cwd);

      const { promise, resolve } = Promise.withResolvers<{
        exitCode: number;
        stdout: string;
        stderr: string;
        timedOut: boolean;
      }>();

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const proc = spawn(cmd, args, {
        cwd: resolvedCwd,
        env: {
          PATH: process.env.PATH ?? "/system/bin:/system/xbin",
          HOME: this.workspaceRoot,
          TMPDIR: process.env.TMPDIR ?? "/tmp",
          TERM: "xterm-256color",
          LANG: "en_US.UTF-8",
        },
      });

      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill("SIGKILL");
      }, timeoutMs);

      proc.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf-8");
      });

      proc.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf-8");
      });

      proc.on("close", (code: number | null) => {
        clearTimeout(timer);
        resolve({
          exitCode: timedOut ? -1 : (code ?? 0),
          stdout: stdout.trim(),
          stderr: (timedOut ? stderr + "\n[Command timed out]" : stderr).trim(),
          timedOut,
        });
      });

      proc.on("error", (err: Error) => {
        clearTimeout(timer);
        resolve({
          exitCode: 127,
          stdout: "",
          stderr: `Spawn error: ${err.message}`,
          timedOut: false,
        });
      });

      return await promise;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { exitCode: 127, stdout: "", stderr: "Execution failed: " + msg, timedOut: false };
    }
  }
}

export class TerminalTool {
  private runner: IProcessRunner;

  constructor(runner?: IProcessRunner) {
    this.runner = runner ?? new RealProcessRunner();
  }

  async execute(params: TerminalToolParams): Promise<TerminalToolResult> {
    const rawCommand = (params.command || "").trim();
    if (!rawCommand) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: "Empty command",
        timedOut: false,
        durationMs: 0,
      };
    }

    const timeoutSec = Math.max(1, Math.min(params.timeout ?? 30, 120));
    const timeoutMs = timeoutSec * 1000;
    const cwd = params.cwd ?? ".";

    const startTime = Date.now();

    // Execute through standard shell: sh -c "<command>"
    const outcome = await this.runner.exec("sh", ["-c", rawCommand], cwd, timeoutMs);
    const durationMs = Date.now() - startTime;

    return {
      exitCode: outcome.exitCode,
      stdout: outcome.stdout,
      stderr: outcome.stderr,
      timedOut: outcome.timedOut,
      durationMs,
    };
  }
}
