/**
 * oh-my-pi Mobile: Sandboxed Workspace Filesystem Tools
 *
 * Shimmed port of oh-my-pi's `read`, `write`, `grep`, and `glob` tools.
 * Scoped to an on-device mobile workspace sandbox without requiring glibc ripgrep.
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

export interface MobileWorkspaceOptions {
  initialFiles?: Record<string, string>;
}

export class MobileWorkspace {
  private files: Map<string, string> = new Map();

  constructor(options: MobileWorkspaceOptions = {}) {
    if (options.initialFiles) {
      for (const [p, c] of Object.entries(options.initialFiles)) {
        this.files.set(this.normalizePath(p), c);
      }
    }
  }

  normalizePath(p: string): string {
    return p.replace(/^[./]+/, "").replace(/\\/g, "/");
  }

  async writeFile(path: string, content: string): Promise<string> {
    const norm = this.normalizePath(path);
    this.files.set(norm, content);
    return `Successfully wrote ${content.length} bytes to ${norm}`;
  }

  async readFile(path: string, selector?: string): Promise<ReadResult> {
    const norm = this.normalizePath(path);

    // Check if it represents a directory listing
    const isDirectory = Array.from(this.files.keys()).some(
      (k) => k.startsWith(norm + "/") && k !== norm
    );

    if (isDirectory) {
      const prefix = norm ? norm + "/" : "";
      const dirents = new Set<string>();
      for (const key of this.files.keys()) {
        if (key.startsWith(prefix)) {
          const sub = key.slice(prefix.length).split("/")[0];
          dirents.add(sub);
        }
      }
      return {
        path: norm,
        isDir: true,
        entries: Array.from(dirents),
        content: Array.from(dirents).join("\n"),
      };
    }

    const content = this.files.get(norm);
    if (content === undefined) {
      throw new Error(`File not found: ${path}`);
    }

    const lines = content.split("\n");
    const totalLines = lines.length;

    // Selector slicing: e.g. ":5-10" or "5-10"
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
          path: norm,
          totalLines,
          content: `[${norm}#${computeLineTag(content).slice(0, 4)}]\n` + formatted.join("\n"),
        };
      }
    }

    return {
      path: norm,
      totalLines,
      content,
    };
  }

  async grep(pattern: string, searchRoot = ""): Promise<GrepMatch[]> {
    const normRoot = this.normalizePath(searchRoot);
    const regex = new RegExp(pattern, "i");
    const matches: GrepMatch[] = [];

    for (const [p, content] of this.files.entries()) {
      if (normRoot && !p.startsWith(normRoot)) continue;

      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const lineText = lines[i];
        if (regex.test(lineText)) {
          matches.push({
            path: p,
            line: i + 1,
            text: lineText,
          });
        }
      }
    }

    return matches;
  }

  async glob(pattern: string): Promise<string[]> {
    const regexStr = pattern
      .replace(/\./g, "\\.")
      .replace(/\*\*/g, ".*")
      .replace(/\*/g, "[^/]*");
    const regex = new RegExp(`^${regexStr}$`);

    const results: string[] = [];
    for (const p of this.files.keys()) {
      if (regex.test(p)) {
        results.push(p);
      }
    }
    return results.sort();
  }
}
