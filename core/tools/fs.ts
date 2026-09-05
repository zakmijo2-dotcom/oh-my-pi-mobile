/**
 * oh-my-pi Mobile: Real On-Disk Workspace Filesystem Tools
 *
 * Direct bridge to Android filesystem via OmpCoreBridge.
 * NO in-memory Map simulation — all operations touch real storage.
 */

import { computeLineTag } from "../hashline";

export interface ReadResult {
  content: string;
  path: string;
  totalLines?: number;
  isDir?: boolean;
  entries?: string[];
}

export interface GrepMatch {
  path: string;
  line: number;
  text: string;
}

export interface FileStat {
  path: string;
  exists: boolean;
  isDirectory: boolean;
  isFile: boolean;
  size: number;
  mtime: number;
}

export interface INativeBridgeFS {
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, content: string): Promise<boolean>;
  listDir(path: string): Promise<Array<{ name: string; isDirectory: boolean; size: number }>>;
  mkdir(path: string): Promise<boolean>;
  delete(path: string): Promise<boolean>;
  move(src: string, dst: string): Promise<boolean>;
  copy(src: string, dst: string): Promise<boolean>;
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<FileStat | null>;
  getWorkspacePath(): string;
}

interface WindowWithBridge {
  OmpNativeBridge?: {
    readFile(p: string): string | null;
    writeFile(p: string, c: string): boolean;
    listDir(p: string): string;
    mkdir(p: string): boolean;
    delete(p: string): boolean;
    move(s: string, d: string): boolean;
    copy(s: string, d: string): boolean;
    exists(p: string): boolean;
    stat(p: string): string | null;
    getWorkspacePath(): string;
  };
}

/** Android WebView native bridge adapter */
export class AndroidWebViewBridgeFS implements INativeBridgeFS {
  private get bridge(): WindowWithBridge["OmpNativeBridge"] | null {
    if (typeof window !== "undefined") {
      const win = window as unknown as WindowWithBridge;
      return win.OmpNativeBridge ?? null;
    }
    return null;
  }

  getWorkspacePath(): string {
    return this.bridge?.getWorkspacePath() ?? "/data/data/com.oh_my_pi.mobile/files/workspace";
  }

  async exists(path: string): Promise<boolean> {
    return Boolean(this.bridge?.exists(path));
  }

  async readFile(path: string): Promise<string | null> {
    const res = this.bridge?.readFile(path);
    return res !== undefined ? res : null;
  }

  async writeFile(path: string, content: string): Promise<boolean> {
    return Boolean(this.bridge?.writeFile(path, content));
  }

  async mkdir(path: string): Promise<boolean> {
    return Boolean(this.bridge?.mkdir(path));
  }

  async delete(path: string): Promise<boolean> {
    return Boolean(this.bridge?.delete(path));
  }

  async move(src: string, dst: string): Promise<boolean> {
    return Boolean(this.bridge?.move(src, dst));
  }

  async copy(src: string, dst: string): Promise<boolean> {
    return Boolean(this.bridge?.copy(src, dst));
  }

  async listDir(path: string): Promise<Array<{ name: string; isDirectory: boolean; size: number }>> {
    const raw = this.bridge?.listDir(path);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  async stat(path: string): Promise<FileStat | null> {
    const raw = this.bridge?.stat(path);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
}

/** Node/Bun on-disk bridge adapter for local testing and CLI runs */
export class NodeOnDiskBridgeFS implements INativeBridgeFS {
  private rootDir: string;
  private fs: typeof import("node:fs");
  private path: typeof import("node:path");

  constructor(rootDir?: string) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    this.fs = require("node:fs");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    this.path = require("node:path");

    const tmp = process.env.TMPDIR ?? "/tmp";
    this.rootDir = rootDir ?? this.path.join(tmp, `omp_ws_${process.pid}`);
    if (!this.fs.existsSync(this.rootDir)) {
      this.fs.mkdirSync(this.rootDir, { recursive: true });
    }
  }

  getWorkspacePath(): string {
    return this.rootDir;
  }

  private resolve(p: string): string {
    const clean = p.replace(/^[./]+/, "").replace(/\\/g, "/");
    const target = this.path.resolve(this.rootDir, clean);
    return target;
  }

  async exists(p: string): Promise<boolean> {
    return this.fs.existsSync(this.resolve(p));
  }

  async readFile(p: string): Promise<string | null> {
    const target = this.resolve(p);
    if (!this.fs.existsSync(target) || this.fs.statSync(target).isDirectory()) {
      return null;
    }
    return this.fs.readFileSync(target, "utf-8");
  }

  async writeFile(p: string, content: string): Promise<boolean> {
    const target = this.resolve(p);
    const parent = this.path.dirname(target);
    if (!this.fs.existsSync(parent)) {
      this.fs.mkdirSync(parent, { recursive: true });
    }
    this.fs.writeFileSync(target, content, "utf-8");
    return true;
  }

  async mkdir(p: string): Promise<boolean> {
    const target = this.resolve(p);
    this.fs.mkdirSync(target, { recursive: true });
    return true;
  }

  async delete(p: string): Promise<boolean> {
    const target = this.resolve(p);
    if (!this.fs.existsSync(target)) return false;
    this.fs.rmSync(target, { recursive: true, force: true });
    return true;
  }

  async move(src: string, dst: string): Promise<boolean> {
    const s = this.resolve(src);
    const d = this.resolve(dst);
    if (!this.fs.existsSync(s)) return false;
    const parent = this.path.dirname(d);
    if (!this.fs.existsSync(parent)) {
      this.fs.mkdirSync(parent, { recursive: true });
    }
    this.fs.renameSync(s, d);
    return true;
  }

  async copy(src: string, dst: string): Promise<boolean> {
    const s = this.resolve(src);
    const d = this.resolve(dst);
    if (!this.fs.existsSync(s)) return false;
    const parent = this.path.dirname(d);
    if (!this.fs.existsSync(parent)) {
      this.fs.mkdirSync(parent, { recursive: true });
    }
    this.fs.copyFileSync(s, d);
    return true;
  }

  async listDir(p: string): Promise<Array<{ name: string; isDirectory: boolean; size: number }>> {
    const target = this.resolve(p);
    if (!this.fs.existsSync(target) || !this.fs.statSync(target).isDirectory()) {
      return [];
    }
    const entries = this.fs.readdirSync(target, { withFileTypes: true });
    return entries.map((e) => {
      const full = this.path.join(target, e.name);
      const isDir = e.isDirectory();
      const size = isDir ? 0 : this.fs.statSync(full).size;
      return { name: e.name, isDirectory: isDir, size };
    });
  }

  async stat(p: string): Promise<FileStat | null> {
    const target = this.resolve(p);
    if (!this.fs.existsSync(target)) return null;
    const s = this.fs.statSync(target);
    return {
      path: p,
      exists: true,
      isDirectory: s.isDirectory(),
      isFile: s.isFile(),
      size: s.size,
      mtime: s.mtimeMs,
    };
  }
}

export class RealWorkspace {
  private bridge: INativeBridgeFS;

  constructor(bridgeOrOptions?: INativeBridgeFS | { initialFiles?: Record<string, string> }) {
    if (bridgeOrOptions && "readFile" in bridgeOrOptions) {
      this.bridge = bridgeOrOptions as INativeBridgeFS;
    } else if (typeof window !== "undefined" && (window as unknown as WindowWithBridge).OmpNativeBridge) {
      this.bridge = new AndroidWebViewBridgeFS();
    } else {
      this.bridge = new NodeOnDiskBridgeFS();
    }

    if (bridgeOrOptions && "initialFiles" in bridgeOrOptions && bridgeOrOptions.initialFiles) {
      for (const [p, c] of Object.entries(bridgeOrOptions.initialFiles)) {
        this.bridge.writeFile(p, c);
      }
    }
  }

  getWorkspacePath(): string {
    return this.bridge.getWorkspacePath();
  }

  async writeFile(path: string, content: string): Promise<string> {
    const ok = await this.bridge.writeFile(path, content);
    if (!ok) {
      throw new Error(`Failed to write file on disk: ${path}`);
    }
    return `Successfully wrote ${content.length} bytes to ${path}`;
  }

  async readFile(path: string, selector?: string): Promise<ReadResult> {
    const stat = await this.bridge.stat(path);

    if (stat && stat.isDirectory) {
      const entries = await this.bridge.listDir(path);
      const names = entries.map((e) => e.name);
      return {
        path,
        isDir: true,
        entries: names,
        content: names.join("\n"),
      };
    }

    const content = await this.bridge.readFile(path);
    if (content === null) {
      throw new Error(`File not found on disk: ${path}`);
    }

    const lines = content.split("\n");
    const totalLines = lines.length;

    if (selector) {
      const match = selector.match(/^:?(\d+)(?:-(\d+))?$/);
      if (match) {
        const start = parseInt(match[1], 10);
        const end = match[2] ? parseInt(match[2], 10) : lines.length;
        const sliced = lines.slice(Math.max(0, start - 1), end);
        const formatted = sliced.map((l, idx) => {
          const lineNum = start + idx;
          const tag = computeLineTag(l);
          return `${lineNum}:${l}`;
        });
        return {
          path,
          totalLines,
          content: `[${path}#${computeLineTag(content).slice(0, 4)}]\n` + formatted.join("\n"),
        };
      }
    }

    return {
      path,
      totalLines,
      content,
    };
  }

  async mkdir(path: string): Promise<boolean> {
    return this.bridge.mkdir(path);
  }

  async delete(path: string): Promise<boolean> {
    return this.bridge.delete(path);
  }

  async move(src: string, dst: string): Promise<boolean> {
    return this.bridge.move(src, dst);
  }

  async copy(src: string, dst: string): Promise<boolean> {
    return this.bridge.copy(src, dst);
  }

  async exists(path: string): Promise<boolean> {
    return this.bridge.exists(path);
  }

  async grep(pattern: string, searchRoot = ""): Promise<GrepMatch[]> {
    const regex = new RegExp(pattern, "i");
    const matches: GrepMatch[] = [];

    const walk = async (dir: string) => {
      const entries = await this.bridge.listDir(dir);
      for (const e of entries) {
        const fullRel = dir ? `${dir}/${e.name}` : e.name;
        if (e.isDirectory) {
          if (!e.name.startsWith(".") && e.name !== "node_modules") {
            await walk(fullRel);
          }
        } else {
          const content = await this.bridge.readFile(fullRel);
          if (content) {
            const lines = content.split("\n");
            for (let i = 0; i < lines.length; i++) {
              if (regex.test(lines[i])) {
                matches.push({
                  path: fullRel,
                  line: i + 1,
                  text: lines[i],
                });
              }
            }
          }
        }
      }
    };

    await walk(searchRoot);
    return matches;
  }

  async glob(pattern: string): Promise<string[]> {
    const regexStr = pattern
      .replace(/\./g, "\\.")
      .replace(/\*\*/g, ".*")
      .replace(/\*/g, "[^/]*");
    const regex = new RegExp(`^${regexStr}$`);

    const allFiles: string[] = [];

    const walk = async (dir: string) => {
      const entries = await this.bridge.listDir(dir);
      for (const e of entries) {
        const fullRel = dir ? `${dir}/${e.name}` : e.name;
        if (e.isDirectory) {
          if (!e.name.startsWith(".") && e.name !== "node_modules") {
            await walk(fullRel);
          }
        } else {
          allFiles.push(fullRel);
        }
      }
    };

    await walk("");
    return allFiles.filter((p) => regex.test(p)).sort();
  }
}

export { RealWorkspace as MobileWorkspace };
