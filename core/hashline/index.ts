/**
 * oh-my-pi Mobile: Hashline Patch Engine
 *
 * Direct port of oh-my-pi's line-anchored patch language and applier.
 * Computes 4-hex line tags and applies line-anchored mutations:
 * - PUT N.=M: (replace lines N through M)
 * - PUT <N:    (insert before line N)
 * - PUT >N:    (insert after line N)
 * - CUT N.=M   (delete lines N through M)
 */

export interface HashlineChunk {
  op: "PUT_RANGE" | "PUT_BEFORE" | "PUT_AFTER" | "CUT";
  startLine: number;
  endLine?: number;
  lines: string[];
}

export interface HashlineApplyResult {
  content: string;
  linesModified: number;
  success: boolean;
  error?: string;
}

/** Computes a stable 4-hex tag for a line of text (Hashline parity) */
export function computeLineTag(line: string): string {
  let hash = 0x811c9dc5;
  const normalized = line.replace(/\r$/, "");
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const unsigned = hash >>> 0;
  return (unsigned & 0xffff).toString(16).toUpperCase().padStart(4, "0");
}

/** Formats text content into Hashline numbered view with tags: [LINE:TAG:CONTENT] */
export function formatHashlines(content: string, startLine = 1): string[] {
  const rawLines = content.split("\n");
  return rawLines.map((line, idx) => {
    const lineNum = startLine + idx;
    const tag = computeLineTag(line);
    return `${lineNum}:${tag}:${line}`;
  });
}

/** Parses a hashline patch text block into structured operations */
export function parseHashlinePatch(patchText: string): HashlineChunk[] {
  const lines = patchText.split("\n");
  const chunks: HashlineChunk[] = [];
  let currentChunk: HashlineChunk | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Header matching: PUT N.=M: or PUT N.=N:
    const putRangeMatch = line.match(/^PUT\s+(\d+)\.=(\d+):/);
    if (putRangeMatch) {
      if (currentChunk) chunks.push(currentChunk);
      currentChunk = {
        op: "PUT_RANGE",
        startLine: parseInt(putRangeMatch[1], 10),
        endLine: parseInt(putRangeMatch[2], 10),
        lines: [],
      };
      continue;
    }

    // Header matching: PUT <N: (insert before)
    const putBeforeMatch = line.match(/^PUT\s+<(\d+):/);
    if (putBeforeMatch) {
      if (currentChunk) chunks.push(currentChunk);
      currentChunk = {
        op: "PUT_BEFORE",
        startLine: parseInt(putBeforeMatch[1], 10),
        lines: [],
      };
      continue;
    }

    // Header matching: PUT >N: (insert after)
    const putAfterMatch = line.match(/^PUT\s+>(\d+):/);
    if (putAfterMatch) {
      if (currentChunk) chunks.push(currentChunk);
      currentChunk = {
        op: "PUT_AFTER",
        startLine: parseInt(putAfterMatch[1], 10),
        lines: [],
      };
      continue;
    }

    // Header matching: CUT N.=M
    const cutMatch = line.match(/^CUT\s+(\d+)\.=(\d+)/);
    if (cutMatch) {
      if (currentChunk) chunks.push(currentChunk);
      chunks.push({
        op: "CUT",
        startLine: parseInt(cutMatch[1], 10),
        endLine: parseInt(cutMatch[2], 10),
        lines: [],
      });
      currentChunk = null;
      continue;
    }

    // Body rows start with '+'
    if (currentChunk && line.startsWith("+")) {
      currentChunk.lines.push(line.slice(1));
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}

/** Applies hashline chunks to the original file content */
export function applyHashlinePatch(original: string, patchText: string): HashlineApplyResult {
  const chunks = parseHashlinePatch(patchText);
  if (chunks.length === 0) {
    return { content: original, linesModified: 0, success: true };
  }

  const docLines = original.split("\n");
  let totalModified = 0;

  // Sort chunks descending by startLine so line index shifts don't disrupt earlier lines
  const sortedChunks = [...chunks].sort((a, b) => b.startLine - a.startLine);

  for (const chunk of sortedChunks) {
    const { op, startLine, endLine, lines: newLines } = chunk;

    if (startLine < 1 || startLine > docLines.length + 1) {
      return {
        content: original,
        linesModified: 0,
        success: false,
        error: `Invalid start line ${startLine} in document of ${docLines.length} lines`,
      };
    }

    const zeroIndex = startLine - 1;

    switch (op) {
      case "PUT_RANGE": {
        const end = endLine ?? startLine;
        const deleteCount = end - startLine + 1;
        if (deleteCount < 0 || zeroIndex + deleteCount > docLines.length) {
          return {
            content: original,
            linesModified: 0,
            success: false,
            error: `Invalid range ${startLine}..${end}`,
          };
        }
        docLines.splice(zeroIndex, deleteCount, ...newLines);
        totalModified += Math.max(deleteCount, newLines.length);
        break;
      }
      case "PUT_BEFORE": {
        docLines.splice(zeroIndex, 0, ...newLines);
        totalModified += newLines.length;
        break;
      }
      case "PUT_AFTER": {
        docLines.splice(zeroIndex + 1, 0, ...newLines);
        totalModified += newLines.length;
        break;
      }
      case "CUT": {
        const end = endLine ?? startLine;
        const deleteCount = end - startLine + 1;
        docLines.splice(zeroIndex, deleteCount);
        totalModified += deleteCount;
        break;
      }
    }
  }

  return {
    content: docLines.join("\n"),
    linesModified: totalModified,
    success: true,
  };
}
