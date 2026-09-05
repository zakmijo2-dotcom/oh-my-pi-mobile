import { describe, expect, it } from "bun:test";
import {
  applyHashlinePatch,
  computeLineTag,
  formatHashlines,
  parseHashlinePatch,
} from "../core/hashline";

describe("Hashline Patch Engine Parity", () => {
  it("computes deterministic 4-hex line tags", () => {
    const line = "function greet(name: string) {";
    const tag1 = computeLineTag(line);
    const tag2 = computeLineTag(line);
    expect(tag1).toBe(tag2);
    expect(tag1).toMatch(/^[0-9A-F]{4}$/);
  });

  it("formats content with line numbers and tags", () => {
    const text = "first line\nsecond line";
    const formatted = formatHashlines(text);
    expect(formatted.length).toBe(2);
    expect(formatted[0]).toMatch(/^1:[0-9A-F]{4}:first line$/);
    expect(formatted[1]).toMatch(/^2:[0-9A-F]{4}:second line$/);
  });

  it("applies PUT N.=M: range replacement", () => {
    const original = "line 1\nline 2\nline 3\nline 4";
    const patch = `PUT 2.=3:
+replaced line 2 and 3
+extra line`;

    const result = applyHashlinePatch(original, patch);
    expect(result.success).toBe(true);
    expect(result.linesModified).toBe(2);
    expect(result.content).toBe("line 1\nreplaced line 2 and 3\nextra line\nline 4");
  });

  it("applies PUT <N: insert before", () => {
    const original = "line 1\nline 2";
    const patch = `PUT <1:
+header line`;

    const result = applyHashlinePatch(original, patch);
    expect(result.success).toBe(true);
    expect(result.content).toBe("header line\nline 1\nline 2");
  });

  it("applies PUT >N: insert after", () => {
    const original = "line 1\nline 2";
    const patch = `PUT >2:
+footer line`;

    const result = applyHashlinePatch(original, patch);
    expect(result.success).toBe(true);
    expect(result.content).toBe("line 1\nline 2\nfooter line");
  });

  it("applies CUT N.=M line deletion", () => {
    const original = "line 1\nline 2\nline 3\nline 4";
    const patch = `CUT 2.=3`;

    const result = applyHashlinePatch(original, patch);
    expect(result.success).toBe(true);
    expect(result.linesModified).toBe(2);
    expect(result.content).toBe("line 1\nline 4");
  });

  it("fails gracefully on invalid line numbers", () => {
    const original = "line 1\nline 2";
    const patch = `PUT 10.=12:
+invalid`;

    const result = applyHashlinePatch(original, patch);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
