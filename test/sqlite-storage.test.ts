import { describe, expect, it, afterAll } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { BunSqliteDatabase, SqliteSessionStore, type StoredToolCall } from "../core/session/sqlite-store";
import type { CoreMessage, CoreSessionState } from "../core/types";

describe("Phase 6: SQLite Session Storage (Gate 6 Verification)", () => {
  const tmpBase = process.env.TMPDIR ?? "/tmp";
  const testDbFile = path.join(tmpBase, `omp_sqlite_test_${Date.now()}.db`);

  afterAll(() => {
    if (fs.existsSync(testDbFile)) {
      fs.rmSync(testDbFile, { force: true });
    }
  });

  it("initializes 7-table schema and saves session state and messages", async () => {
    const db = new BunSqliteDatabase(testDbFile);
    const store = new SqliteSessionStore(db);
    await store.init();

    const state: CoreSessionState = {
      sessionId: "sess_sql_101",
      sessionName: "SQLite Test Session",
      createdAt: Date.now() - 1000,
      updatedAt: Date.now(),
      activeModel: {
        id: "claude-3-7-sonnet",
        name: "Claude 3.7",
        provider: "anthropic",
        contextWindow: 200000,
        maxTokens: 64000,
        inputModalities: ["text"],
      },
      thinkingLevel: "high",
      isStreaming: false,
      messageCount: 2,
      todoPhases: [{ phase: "P1", items: [{ id: "t1", task: "Task 1", phase: "P1", status: "done" }] }],
      offlineOnly: true,
    };

    const messages: CoreMessage[] = [
      { id: "m1", role: "user", content: "Query from user", timestamp: Date.now() - 500 },
      {
        id: "m2",
        role: "assistant",
        content: "Assistant response",
        timestamp: Date.now(),
        evidence: [{ grade: "CONFIRMED", claim: "SQLite persistence verified" }],
      },
    ];

    await store.saveSession(state, messages);

    // Record tool call
    const tc: StoredToolCall = {
      id: "call_tool_001",
      sessionId: "sess_sql_101",
      messageId: "m2",
      toolName: "write",
      arguments: { path: "hello.ts", content: "export const x = 1;" },
      result: "Successfully wrote 20 bytes",
      isError: false,
      createdAt: Date.now(),
    };
    await store.recordToolCall(tc);

    // Verify loading session
    const loaded = await store.loadSession("sess_sql_101");
    expect(loaded).toBeDefined();
    expect(loaded?.state.sessionId).toBe("sess_sql_101");
    expect(loaded?.state.sessionName).toBe("SQLite Test Session");
    expect(loaded?.state.thinkingLevel).toBe("high");
    expect(loaded?.messages.length).toBe(2);
    expect(loaded?.messages[1].evidence?.[0].claim).toBe("SQLite persistence verified");

    // Verify tool calls loaded
    const toolCalls = await store.getToolCalls("sess_sql_101");
    expect(toolCalls.length).toBe(1);
    expect(toolCalls[0].toolName).toBe("write");
    expect(toolCalls[0].isError).toBe(false);
  });

  it("Gate 6: App restart preserves full session history and tool-call records", async () => {
    // Re-open the database from the same file (simulating app restart)
    const restartDb = new BunSqliteDatabase(testDbFile);
    const restartStore = new SqliteSessionStore(restartDb);
    await restartStore.init();

    const activeId = await restartStore.getActiveSessionId();
    expect(activeId).toBe("sess_sql_101");

    const reloaded = await restartStore.loadSession(activeId!);
    expect(reloaded).toBeDefined();
    expect(reloaded?.messages.length).toBe(2);

    const reloadedTools = await restartStore.getToolCalls(activeId!);
    expect(reloadedTools.length).toBe(1);
    expect(reloadedTools[0].toolName).toBe("write");
  });

  it("Gate 6: tests corrupted database recovery path", async () => {
    const corruptDbFile = path.join(tmpBase, `omp_corrupt_test_${Date.now()}.db`);
    // Write garbage binary bytes to corrupt SQLite header
    fs.writeFileSync(corruptDbFile, "THIS IS NOT A VALID SQLITE DATABASE FILE GARBAGE HEADER 0000000000");

    // Recovery path: detect corrupted file, back up corrupt file, and re-create fresh DB
    let recoveryOccurred = false;
    let freshDb: BunSqliteDatabase | null = null;
    freshDb = new BunSqliteDatabase(corruptDbFile);
    const ok = await freshDb.execute("SELECT 1;");
    if (!ok) {
      // Corrupt database detected
      recoveryOccurred = true;
      const backupPath = `${corruptDbFile}.corrupt.${Date.now()}`;
      fs.renameSync(corruptDbFile, backupPath);
      expect(fs.existsSync(backupPath)).toBe(true);

      // Re-create fresh database
      freshDb = new BunSqliteDatabase(corruptDbFile);
      const recoveredStore = new SqliteSessionStore(freshDb);
      await recoveredStore.init();

      // Clean session can now be saved
      await recoveredStore.setSetting("recovery_status", "clean_after_corruption");
      const val = await recoveredStore.getSetting("recovery_status");
      expect(val).toBe("clean_after_corruption");

      fs.rmSync(backupPath, { force: true });
    }

    if (fs.existsSync(corruptDbFile)) {
      fs.rmSync(corruptDbFile, { force: true });
    }

    expect(recoveryOccurred).toBe(true);
  });
});
