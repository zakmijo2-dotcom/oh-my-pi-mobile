/**
 * oh-my-pi Mobile: Agent Loop & Turn Orchestrator
 *
 * Direct port of oh-my-pi's `packages/agent/src/agent-loop.ts`.
 * Manages conversation turns, multi-step tool execution loops,
 * evidence grading tag extraction, and lifecycle event emissions.
 */

import { MultiProviderStreamClient } from "../ai/stream";
import { applyHashlinePatch } from "../hashline";
import { AskQuestionManager, type AskQuestion } from "../tools/ask";
import { RealWorkspace } from "../tools/fs";
import { GitTool, type GitToolParams } from "../tools/git";
import { TerminalTool, type TerminalToolParams } from "../tools/terminal";
import { TodoStateMachine, type TodoToolParams } from "../tools/todo";
import type {
  CoreMessage,
  CoreRpcEvent,
  CoreSessionState,
  EvidenceGrade,
  EvidenceTag,
  ToolDefinition,
} from "../types";

export type EventSink = (event: CoreRpcEvent) => void;

export class MobileAgentLoop {
  private streamClient = new MultiProviderStreamClient();
  private workspace = new RealWorkspace();
  private todo = new TodoStateMachine();
  private ask = new AskQuestionManager();
  private git = new GitTool();
  private terminal = new TerminalTool();

  getWorkspace(): RealWorkspace {
    return this.workspace;
  }

  getTodo(): TodoStateMachine {
    return this.todo;
  }

  getAsk(): AskQuestionManager {
    return this.ask;
  }

  getRegisteredTools(): ToolDefinition[] {
    return [
      {
        name: "read",
        description: "Read file contents or slice lines with selector :N-M",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string" },
            selector: { type: "string" },
          },
          required: ["path"],
        },
        tier: "essential",
      },
      {
        name: "write",
        description: "Create or overwrite a file in the workspace",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string" },
            content: { type: "string" },
          },
          required: ["path", "content"],
        },
        tier: "essential",
      },
      {
        name: "edit",
        description: "Line-anchored Hashline patch language (PUT, CUT)",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string" },
            input: { type: "string" },
          },
          required: ["path", "input"],
        },
        tier: "essential",
      },
      {
        name: "todo",
        description: "Phased task tracking with auto-promotion",
        parameters: {
          type: "object",
          properties: {
            op: { type: "string" },
            task: { type: "string" },
            phase: { type: "string" },
          },
          required: ["op"],
        },
        tier: "essential",
      },
      {
        name: "ask",
        description: "Interactive clarification question picker",
        parameters: {
          type: "object",
          properties: {
            questions: { type: "array" },
          },
          required: ["questions"],
        },
        tier: "essential",
      },
      {
        name: "grep",
        description: "Search workspace file contents with regex pattern",
        parameters: {
          type: "object",
          properties: {
            pattern: { type: "string" },
            path: { type: "string" },
          },
          required: ["pattern"],
        },
        tier: "discoverable",
      },
      {
        name: "glob",
        description: "Find files in workspace matching a glob pattern",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string" },
          },
          required: ["path"],
        },
        tier: "discoverable",
      },
      {
        name: "git",
        description: "Execute Git operations (status, diff, log, add, commit, checkout, clone, push)",
        parameters: {
          type: "object",
          properties: {
            op: { type: "string" },
            message: { type: "string" },
            files: { type: "array" },
            branch: { type: "string" },
            url: { type: "string" },
          },
          required: ["op"],
        },
        tier: "essential",
      },
      {
        name: "bash",
        description: "Execute terminal shell commands within mobile workspace sandbox",
        parameters: {
          type: "object",
          properties: {
            command: { type: "string" },
            cwd: { type: "string" },
            timeout: { type: "number" },
          },
          required: ["command"],
        },
        tier: "essential",
      },
    ];
  }

  async runTurn(
    state: CoreSessionState,
    messages: CoreMessage[],
    emit: EventSink,
    signal?: AbortSignal
  ): Promise<void> {
    emit({ type: "turn_start", turnIndex: messages.length });

    const tools = this.getRegisteredTools();
    let keepLooping = true;
    let turnIterations = 0;
    const maxIterations = 5;

    while (keepLooping && turnIterations < maxIterations) {
      if (signal?.aborted) break;
      turnIterations++;

      const assistantId = `msg_asst_${Date.now()}_${turnIterations}`;
      emit({ type: "message_start", messageId: assistantId, role: "assistant" });

      const streamMessages = messages.map((m) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      }));

      const streamResult = await this.streamClient.stream({
        model: state.activeModel,
        messages: streamMessages,
        tools,
        signal,
        onDelta: (delta) => {
          if (delta.text) {
            emit({
              type: "message_delta",
              messageId: assistantId,
              delta: delta.text,
              deltaType: "text",
            });
          }
          if (delta.thinking) {
            emit({
              type: "message_delta",
              messageId: assistantId,
              delta: delta.thinking,
              deltaType: "thinking",
            });
          }
        },
      });

      const evidence = this.extractEvidence(streamResult.fullText);
      const assistantMsg: CoreMessage = {
        id: assistantId,
        role: "assistant",
        content: streamResult.fullText,
        timestamp: Date.now(),
        evidence: evidence.length > 0 ? evidence : undefined,
      };
      messages.push(assistantMsg);
      emit({ type: "message_end", message: assistantMsg });

      // If model made tool calls, execute them
      if (streamResult.toolCalls && streamResult.toolCalls.length > 0) {
        for (const tc of streamResult.toolCalls) {
          emit({
            type: "tool_start",
            toolCallId: tc.id,
            name: tc.name,
            args: tc.arguments,
          });

          const toolOutcome = await this.executeTool(tc.name, tc.arguments, emit);

          emit({
            type: "tool_end",
            toolCallId: tc.id,
            name: tc.name,
            result: toolOutcome.result,
            isError: toolOutcome.isError,
          });

          const toolMsg: CoreMessage = {
            id: `msg_tool_${Date.now()}`,
            role: "tool",
            content: JSON.stringify(toolOutcome.result),
            timestamp: Date.now(),
          };
          messages.push(toolMsg);
          emit({ type: "message_end", message: toolMsg });
        }
      } else {
        // No further tool calls: turn has concluded
        keepLooping = false;
      }
    }

    emit({ type: "turn_end", turnIndex: messages.length });
  }

  async executeTool(
    name: string,
    args: Record<string, unknown>,
    emit?: EventSink
  ): Promise<{ result: unknown; isError: boolean }> {
    try {
      switch (name) {
        case "read": {
          const filePath = String(args.path ?? "");
          const selector = args.selector ? String(args.selector) : undefined;
          const res = await this.workspace.readFile(filePath, selector);
          return { result: res, isError: false };
        }
        case "write": {
          const filePath = String(args.path ?? "");
          const content = String(args.content ?? "");
          const msg = await this.workspace.writeFile(filePath, content);
          return { result: msg, isError: false };
        }
        case "edit": {
          const filePath = String(args.path ?? "");
          const input = String(args.input ?? "");
          const existing = await this.workspace.readFile(filePath);
          const patchResult = applyHashlinePatch(existing.content, input);
          if (!patchResult.success) {
            return { result: patchResult.error ?? "Patch failed", isError: true };
          }
          await this.workspace.writeFile(filePath, patchResult.content);
          return {
            result: `Applied ${patchResult.linesModified} line modifications to ${filePath}`,
            isError: false,
          };
        }
        case "todo": {
          const todoParams = args as unknown as TodoToolParams;
          const res = this.todo.execute(todoParams);
          return { result: res, isError: false };
        }
        case "ask": {
          if (this.ask.validateParams(args)) {
            this.ask.setQuestions(args.questions as AskQuestion[]);
            if (emit && args.questions[0]) {
              const q0 = args.questions[0] as AskQuestion;
              emit({
                type: "ask_request",
                askId: q0.id,
                question: q0.question,
                options: q0.options,
                multi: q0.multi,
              });
            }
            return { result: "Questions presented to user", isError: false };
          }
          return { result: "Invalid ask parameters", isError: true };
        }
        case "git": {
          const res = await this.git.execute(args as unknown as GitToolParams);
          return { result: res, isError: res.isError };
        }
        case "bash":
        case "terminal": {
          const res = await this.terminal.execute(args as unknown as TerminalToolParams);
          return { result: res, isError: res.exitCode !== 0 };
        }
        case "grep": {
          const pattern = String(args.pattern ?? "");
          const searchPath = args.path ? String(args.path) : "";
          const matches = await this.workspace.grep(pattern, searchPath);
          return { result: matches, isError: false };
        }
        case "glob": {
          const pathPattern = String(args.path ?? "");
          const files = await this.workspace.glob(pathPattern);
          return { result: files, isError: false };
        }
        default:
          return { result: `Unknown tool: ${name}`, isError: true };
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return { result: errMsg, isError: true };
    }
  }

  extractEvidence(text: string): EvidenceTag[] {
    const tags: EvidenceTag[] = [];
    const lines = text.split("\n");

    for (const line of lines) {
      const match = line.match(/^\[(CONFIRMED|INFERRED|UNCLEAR)\]\s*(.*)$/i);
      if (match) {
        const grade = match[1].toUpperCase() as EvidenceGrade;
        const claim = match[2].trim();
        if (claim) {
          tags.push({ grade, claim });
        }
      }
    }

    return tags;
  }
}
