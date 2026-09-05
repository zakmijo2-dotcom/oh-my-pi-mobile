import { describe, expect, it } from "bun:test";
import { MobileWorkspace } from "../core/tools/fs";

describe("Mobile Workspace Filesystem Parity", () => {
  it("writes and reads files correctly", async () => {
    const ws = new MobileWorkspace();
    await ws.writeFile("src/main.ts", "console.log('hello world');\nconst x = 42;");

    const read = await ws.readFile("src/main.ts");
    expect(read.totalLines).toBe(2);
    expect(read.content).toContain("console.log('hello world');");
  });

  it("slices lines using selector :N-M", async () => {
    const ws = new MobileWorkspace();
    const content = "line 1\nline 2\nline 3\nline 4\nline 5";
    await ws.writeFile("file.txt", content);

    const read = await ws.readFile("file.txt", ":2-4");
    expect(read.content).toContain("2:line 2");
    expect(read.content).toContain("3:line 3");
    expect(read.content).toContain("4:line 4");
    expect(read.content).not.toContain("1:line 1");
    expect(read.content).not.toContain("5:line 5");
  });

  it("lists directory entries when reading a directory path", async () => {
    const ws = new MobileWorkspace({
      initialFiles: {
        "src/a.ts": "export const a = 1;",
        "src/b.ts": "export const b = 2;",
        "src/utils/c.ts": "export const c = 3;",
      },
    });

    const read = await ws.readFile("src");
    expect(read.isDir).toBe(true);
    expect(read.entries).toContain("a.ts");
    expect(read.entries).toContain("b.ts");
    expect(read.entries).toContain("utils");
  });

  it("performs grep search across workspace files", async () => {
    const ws = new MobileWorkspace({
      initialFiles: {
        "src/auth.ts": "function login() {\n  return token;\n}",
        "src/db.ts": "function connect() {\n  return db;\n}",
      },
    });

    const matches = await ws.grep("token");
    expect(matches.length).toBe(1);
    expect(matches[0].path).toBe("src/auth.ts");
    expect(matches[0].line).toBe(2);
    expect(matches[0].text).toContain("return token;");
  });

  it("performs glob matching across workspace files", async () => {
    const ws = new MobileWorkspace({
      initialFiles: {
        "src/index.ts": "",
        "src/app.ts": "",
        "docs/readme.md": "",
        "test/app.test.ts": "",
      },
    });

    const tsFiles = await ws.glob("src/*.ts");
    expect(tsFiles).toEqual(["src/app.ts", "src/index.ts"]);

    const allTs = await ws.glob("**/*.ts");
    expect(allTs).toEqual(["src/app.ts", "src/index.ts", "test/app.test.ts"]);
  });
});
