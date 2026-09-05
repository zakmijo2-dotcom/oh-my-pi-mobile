import { describe, expect, it, afterAll } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { GitTool, RealGitRunner } from "../core/tools/git";

describe("Phase 3: Real Git Tool (Gate 3 End-to-End Verification)", () => {
  const tmpBase = process.env.TMPDIR ?? "/tmp";
  const testRoot = path.join(tmpBase, `omp_git_test_${Date.now()}`);
  const remoteRepoDir = path.join(testRoot, "remote.git");
  const cloneTargetDir = path.join(testRoot, "cloned_repo");

  // Ensure test directory exists
  fs.mkdirSync(testRoot, { recursive: true });

  afterAll(() => {
    if (fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it("Gate 3: executes real clone -> edit -> commit -> push cycle on real remote repo", async () => {
    // 1. Initialize a real bare remote git repository on disk
    execSync(`git init --bare "${remoteRepoDir}"`, { encoding: "utf-8" });
    expect(fs.existsSync(path.join(remoteRepoDir, "HEAD"))).toBe(true);

    const runner = new RealGitRunner(testRoot);
    const git = new GitTool(runner);

    // 2. CLONE: Execute real git clone via GitTool
    const cloneRes = await git.execute({
      op: "clone",
      url: remoteRepoDir,
      args: [cloneTargetDir],
      cwd: testRoot,
    });
    expect(cloneRes.isError).toBe(false);
    expect(fs.existsSync(path.join(cloneTargetDir, ".git"))).toBe(true);

    // Configure user name and email in cloned repo for commit
    execSync('git config user.name "Oh-My-Pi Tester"', { cwd: cloneTargetDir });
    execSync('git config user.email "test@oh-my-pi.mobile"', { cwd: cloneTargetDir });

    // 3. EDIT: Create a real project file inside cloned repo
    const newFilePath = path.join(cloneTargetDir, "feature.ts");
    fs.writeFileSync(newFilePath, "export const mobileFeature = true;\n", "utf-8");

    // 4. STATUS: Verify dirty working tree via GitTool
    const statusRes = await git.execute({
      op: "status",
      cwd: cloneTargetDir,
    });
    expect(statusRes.isError).toBe(false);
    expect(statusRes.stdout).toContain("feature.ts");

    // 5. ADD: Stage the file via GitTool
    const addRes = await git.execute({
      op: "add",
      files: ["feature.ts"],
      cwd: cloneTargetDir,
    });
    expect(addRes.isError).toBe(false);

    // 6. COMMIT: Commit the change via GitTool
    const commitRes = await git.execute({
      op: "commit",
      message: "feat: add mobile feature via real GitTool",
      cwd: cloneTargetDir,
    });
    expect(commitRes.isError).toBe(false);
    expect(commitRes.summary).toContain("Committed:");

    // 7. PUSH: Push the commit to the real remote repo via GitTool
    const pushRes = await git.execute({
      op: "push",
      args: ["origin", "HEAD:main"],
      cwd: cloneTargetDir,
    });
    expect(pushRes.isError).toBe(false);

    // 8. VERIFY: Check log from the cloned repo
    const logRes = await git.execute({
      op: "log",
      cwd: cloneTargetDir,
    });
    expect(logRes.isError).toBe(false);
    expect(logRes.stdout).toContain("feat: add mobile feature via real GitTool");

    // 9. RE-CLONE VERIFICATION: Clone fresh from remote to confirm commit persisted in remote
    const secondCloneDir = path.join(testRoot, "second_clone");
    execSync(`git clone --no-hardlinks -b main "${remoteRepoDir}" "${secondCloneDir}"`, { encoding: "utf-8" });
    const verifiedContent = fs.readFileSync(path.join(secondCloneDir, "feature.ts"), "utf-8");
    expect(verifiedContent).toBe("export const mobileFeature = true;\n");
  });

  it("handles diff, branch and checkout operations", async () => {
    const gitDir = path.join(testRoot, "branch_repo");
    fs.mkdirSync(gitDir, { recursive: true });
    execSync("git init", { cwd: gitDir });
    execSync('git config user.name "Tester"', { cwd: gitDir });
    execSync('git config user.email "t@t.com"', { cwd: gitDir });

    fs.writeFileSync(path.join(gitDir, "a.txt"), "version 1\n");
    execSync("git add a.txt && git commit -m 'v1'", { cwd: gitDir });

    const git = new GitTool(new RealGitRunner(gitDir));

    // Diff test
    fs.writeFileSync(path.join(gitDir, "a.txt"), "version 2\n");
    const diffRes = await git.execute({ op: "diff", cwd: gitDir });
    expect(diffRes.isError).toBe(false);
    expect(diffRes.stdout).toContain("+version 2");

    // Checkout / branch test
    const branchRes = await git.execute({
      op: "checkout",
      args: ["-b", "feature-branch"],
      cwd: gitDir,
    });
    expect(branchRes.isError).toBe(false);

    const checkBranch = execSync("git branch --show-current", { cwd: gitDir, encoding: "utf-8" });
    expect(checkBranch.trim()).toBe("feature-branch");
  });

  it("supports HTTPS token authentication injection for clone", async () => {
    let capturedUrl = "";
    const mockRunner = {
      run: async (args: string[]) => {
        capturedUrl = args.find((a) => a.startsWith("https://")) || "";
        return { exitCode: 0, stdout: "mock cloned", stderr: "" };
      },
      getAuthToken: async () => "ghp_secure_pat_token_xyz",
    };

    const git = new GitTool(mockRunner);
    await git.execute({
      op: "clone",
      url: "https://github.com/myorg/myrepo.git",
    });

    expect(capturedUrl).toBe("https://ghp_secure_pat_token_xyz@github.com/myorg/myrepo.git");
  });
});
