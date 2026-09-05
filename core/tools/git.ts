/**
 * oh-my-pi Mobile: Real Git Tool
 *
 * Backed by OmpCoreBridge.gitCommand.
 * Supports status, diff, log, add, commit, checkout, branch, merge, clone, pull, push.
 * Supports HTTPS authentication with Personal Access Token from Keystore secure storage.
 */

export interface GitToolParams {
  op:
    | "init"
    | "status"
    | "diff"
    | "log"
    | "add"
    | "commit"
    | "checkout"
    | "branch"
    | "merge"
    | "clone"
    | "pull"
    | "push";
  args?: string[];
  message?: string;
  files?: string[];
  branch?: string;
  url?: string;
  cwd?: string;
}

export interface GitToolResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  summary: string;
  isError: boolean;
}

export interface IGitRunner {
  run(args: string[], cwd?: string): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  getAuthToken?(): Promise<string | null>;
}

export class RealGitRunner implements IGitRunner {
  private workspaceRoot: string;

  constructor(workspaceRoot?: string) {
    this.workspaceRoot = workspaceRoot ?? (process.env.TMPDIR ?? "/tmp");
  }

  async getAuthToken(): Promise<string | null> {
    if (typeof window !== "undefined") {
      const win = window as unknown as { OmpNativeBridge?: { getSecureValue(k: string): string | null } };
      return win.OmpNativeBridge?.getSecureValue("github_token") ?? null;
    }
    return process.env.GITHUB_TOKEN ?? null;
  }

  async run(args: string[], cwd = "."): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    // 1. Android WebView Native Bridge execution
    if (typeof window !== "undefined") {
      const win = window as unknown as { OmpNativeBridge?: { gitCommand(argsJson: string, cwd: string): string } };
      if (win.OmpNativeBridge && typeof win.OmpNativeBridge.gitCommand === "function") {
        const raw = win.OmpNativeBridge.gitCommand(JSON.stringify(args), cwd);
        try {
          return JSON.parse(raw);
        } catch {
          return { exitCode: -1, stdout: "", stderr: "Failed to parse bridge git output: " + raw };
        }
      }
    }

    // 2. Node / Bun local CLI execution (for tests and dev workstation)
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { spawnSync } = require("node:child_process");
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const path = require("node:path");

      const resolvedCwd = path.isAbsolute(cwd) ? cwd : path.resolve(this.workspaceRoot, cwd);
      const res = spawnSync("git", args, {
        cwd: resolvedCwd,
        encoding: "utf-8",
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
        },
      });

      return {
        exitCode: res.status ?? 0,
        stdout: res.stdout || "",
        stderr: res.stderr || "",
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { exitCode: 127, stdout: "", stderr: "Process execution failed: " + msg };
    }
  }
}

export class GitTool {
  private runner: IGitRunner;

  constructor(runner?: IGitRunner) {
    this.runner = runner ?? new RealGitRunner();
  }

  async execute(params: GitToolParams): Promise<GitToolResult> {
    const gitArgs: string[] = [];
    const cwd = params.cwd ?? ".";

    switch (params.op) {
      case "init": {
        gitArgs.push("init");
        if (params.args) gitArgs.push(...params.args);
        break;
      }
      case "status": {
        gitArgs.push("status", "--short");
        if (params.args) gitArgs.push(...params.args);
        break;
      }
      case "diff": {
        gitArgs.push("diff");
        if (params.args) gitArgs.push(...params.args);
        break;
      }
      case "log": {
        gitArgs.push("log", "-n", "10", "--oneline");
        if (params.args) gitArgs.push(...params.args);
        break;
      }
      case "add": {
        gitArgs.push("add");
        if (params.files && params.files.length > 0) {
          gitArgs.push(...params.files);
        } else {
          gitArgs.push(".");
        }
        break;
      }
      case "commit": {
        gitArgs.push("commit", "-m", params.message || "Update from oh-my-pi Mobile");
        if (params.args) gitArgs.push(...params.args);
        break;
      }
      case "checkout": {
        gitArgs.push("checkout");
        if (params.branch) gitArgs.push(params.branch);
        if (params.args) gitArgs.push(...params.args);
        break;
      }
      case "branch": {
        gitArgs.push("branch");
        if (params.branch) gitArgs.push(params.branch);
        if (params.args) gitArgs.push(...params.args);
        break;
      }
      case "merge": {
        gitArgs.push("merge");
        if (params.branch) gitArgs.push(params.branch);
        if (params.args) gitArgs.push(...params.args);
        break;
      }
      case "clone": {
        gitArgs.push("clone", "--no-hardlinks");
        if (params.url) {
          let cloneUrl = params.url;
          // Support HTTPS token authentication
          const token = this.runner.getAuthToken ? await this.runner.getAuthToken() : null;
          if (token && cloneUrl.startsWith("https://") && !cloneUrl.includes("@")) {
            cloneUrl = cloneUrl.replace("https://", `https://${token}@`);
          }
          gitArgs.push(cloneUrl);
        }
        if (params.args) gitArgs.push(...params.args);
        break;
      }
      case "pull": {
        gitArgs.push("pull");
        if (params.args) gitArgs.push(...params.args);
        break;
      }
      case "push": {
        gitArgs.push("push");
        if (params.args) gitArgs.push(...params.args);
        break;
      }
      default:
        return {
          exitCode: 1,
          stdout: "",
          stderr: `Unknown git operation: ${String(params.op)}`,
          summary: "Unknown git operation",
          isError: true,
        };
    }

    const { exitCode, stdout, stderr } = await this.runner.run(gitArgs, cwd);
    const isError = exitCode !== 0;

    let summary = `git ${params.op} executed (exit code ${exitCode})`;
    if (params.op === "commit" && !isError) {
      summary = `Committed: ${stdout.trim().split("\n")[0]}`;
    } else if (params.op === "status" && !isError) {
      const count = stdout.trim() ? stdout.trim().split("\n").length : 0;
      summary = count === 0 ? "Working tree clean" : `${count} modified/untracked file(s)`;
    }

    return {
      exitCode,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      summary,
      isError,
    };
  }
}
