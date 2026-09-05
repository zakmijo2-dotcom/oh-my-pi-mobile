import { describe, expect, it, afterAll } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { NodeOnDiskBridgeFS, RealWorkspace } from "../core/tools/fs";

describe("Phase 2: Real On-Disk Workspace Filesystem", () => {
  const tmpBase = process.env.TMPDIR ?? "/tmp";
  const testWorkspaceDir = path.join(tmpBase, `omp_real_fs_test_${Date.now()}`);
  const bridge = new NodeOnDiskBridgeFS(testWorkspaceDir);
  const ws = new RealWorkspace(bridge);

  afterAll(() => {
    if (fs.existsSync(testWorkspaceDir)) {
      fs.rmSync(testWorkspaceDir, { recursive: true, force: true });
    }
  });

  it("writes real files to disk and verifies with native node:fs", async () => {
    await ws.writeFile("src/index.ts", "export const appName = 'oh-my-pi';\nexport const version = '2.0.0';");

    // Verify through the bridge
    const read = await ws.readFile("src/index.ts");
    expect(read.totalLines).toBe(2);
    expect(read.content).toContain("export const appName = 'oh-my-pi';");

    const realDiskPath = path.join(testWorkspaceDir, "src/index.ts");
    expect(fs.existsSync(realDiskPath)).toBe(true);
    const onDiskContent = fs.readFileSync(realDiskPath, "utf-8");
    expect(onDiskContent).toBe("export const appName = 'oh-my-pi';\nexport const version = '2.0.0';");
  });

  it("slices real file lines using selector :N-M", async () => {
    const lines = ["const a = 1;", "const b = 2;", "const c = 3;", "const d = 4;", "const e = 5;"];
    await ws.writeFile("numbers.ts", lines.join("\n"));

    const slice = await ws.readFile("numbers.ts", ":2-4");
    expect(slice.content).toContain("2:const b = 2;");
    expect(slice.content).toContain("3:const c = 3;");
    expect(slice.content).toContain("4:const d = 4;");
    expect(slice.content).not.toContain("1:const a = 1;");
    expect(slice.content).not.toContain("5:const e = 5;");
  });

  it("lists real directory contents and creates directories", async () => {
    await ws.mkdir("packages/core/src");
    await ws.writeFile("packages/core/src/index.ts", "// core index");
    await ws.writeFile("packages/core/README.md", "# Core package");

    const realPkgDir = path.join(testWorkspaceDir, "packages/core");
    expect(fs.existsSync(realPkgDir)).toBe(true);
    expect(fs.statSync(realPkgDir).isDirectory()).toBe(true);

    const dirListing = await ws.readFile("packages/core");
    expect(dirListing.isDir).toBe(true);
    expect(dirListing.entries).toContain("README.md");
    expect(dirListing.entries).toContain("src");
  });

  it("moves and copies real files on disk", async () => {
    await ws.writeFile("docs/spec.txt", "Architecture specification");

    await ws.copy("docs/spec.txt", "docs/spec_backup.txt");
    expect(fs.existsSync(path.join(testWorkspaceDir, "docs/spec_backup.txt"))).toBe(true);

    await ws.move("docs/spec_backup.txt", "docs/spec_archive.txt");
    expect(fs.existsSync(path.join(testWorkspaceDir, "docs/spec_backup.txt"))).toBe(false);
    expect(fs.existsSync(path.join(testWorkspaceDir, "docs/spec_archive.txt"))).toBe(true);

    await ws.delete("docs/spec_archive.txt");
    expect(fs.existsSync(path.join(testWorkspaceDir, "docs/spec_archive.txt"))).toBe(false);
  });

  it("greps real on-disk files using regex", async () => {
    await ws.writeFile("service/auth.ts", "export function verifyToken(token: string) {\n  return token.length > 0;\n}\n");
    await ws.writeFile("service/user.ts", "export function getUser() {\n  return null;\n}\n");

    const matches = await ws.grep("verifyToken", "service");
    expect(matches.length).toBe(1);
    expect(matches[0].path).toBe("service/auth.ts");
    expect(matches[0].line).toBe(1);
    expect(matches[0].text).toContain("verifyToken(token: string)");
  });

  it("globs real on-disk files", async () => {
    const tsFiles = await ws.glob("**/*.ts");
    expect(tsFiles.length).toBeGreaterThan(0);
    expect(tsFiles.every((f) => f.endsWith(".ts"))).toBe(true);
  });

  it("Gate 2 Verification: creates a multi-file project and confirms real on-disk existence", async () => {
    const projectFiles = {
      "my_app/package.json": '{\n  "name": "demo-app",\n  "version": "1.0.0"\n}\n',
      "my_app/src/main.ts": 'export function main() {\n  console.log("App Started");\n}\n',
      "my_app/src/utils.ts": 'export function add(a: number, b: number): number {\n  return a + b;\n}\n',
      "my_app/README.md": '# Demo App\nCreated by real on-disk native bridge.\n',
    };

    for (const [relPath, content] of Object.entries(projectFiles)) {
      await ws.writeFile(relPath, content);
    }

    // Verify every single file exists physically on disk via native node:fs
    for (const [relPath, expectedContent] of Object.entries(projectFiles)) {
      const diskPath = path.join(testWorkspaceDir, relPath);
      expect(fs.existsSync(diskPath)).toBe(true);
      const actualContent = fs.readFileSync(diskPath, "utf-8");
      expect(actualContent).toBe(expectedContent);
    }
  });
});
