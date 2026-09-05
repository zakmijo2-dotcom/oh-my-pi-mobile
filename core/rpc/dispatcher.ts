/**
 * oh-my-pi Mobile: Headless RPC Protocol Dispatcher
 *
 * Direct port of oh-my-pi's RPC protocol mode.
 * Translates between NDJSON command lines (in) and NDJSON event frames (out).
 * Provides a standard stdio/WebSocket/postMessage bridge for mobile shells.
 */

import { MobileAgentLoop } from "../agent/loop";
import { LocalSessionStore } from "../session/storage";
import type {
  CoreMessage,
  CoreRpcCommand,
  CoreRpcEvent,
  CoreSessionState,
  ModelDescriptor,
} from "../types";

export type RpcFrameOutput = (frameJson: string) => void;

export class RpcDispatcher {
  private agentLoop = new MobileAgentLoop();
  private store = new LocalSessionStore();
  private state: CoreSessionState;
  private messages: CoreMessage[] = [];
  private outputSink?: RpcFrameOutput;
  private abortController: AbortController | null = null;

  constructor(outputSink?: RpcFrameOutput) {
    this.outputSink = outputSink;

    const defaultModel: ModelDescriptor = {
      id: "gemini-3.8-flash",
      name: "Gemini 3.8 Flash (Local Direct)",
      provider: "google",
      contextWindow: 1048576,
      maxTokens: 65536,
      reasoning: true,
      inputModalities: ["text", "image"],
    };

    this.state = {
      sessionId: `session_${Date.now().toString(36)}`,
      sessionName: "Mobile Session",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      activeModel: defaultModel,
      thinkingLevel: "medium",
      isStreaming: false,
      messageCount: 0,
      todoPhases: [],
      offlineOnly: true,
    };
  }

  setOutputSink(sink: RpcFrameOutput): void {
    this.outputSink = sink;
  }

  getAgentLoop(): MobileAgentLoop {
    return this.agentLoop;
  }

  getState(): CoreSessionState {
    return { ...this.state };
  }

  getMessages(): CoreMessage[] {
    return [...this.messages];
  }

  async init(): Promise<void> {
    const activeId = await this.store.getActiveSessionId();
    if (activeId) {
      const stored = await this.store.loadSession(activeId);
      if (stored) {
        this.state = stored.state;
        this.messages = stored.messages;
      }
    }
    this.emit({ type: "ready", protocolVersion: 1 });
    this.emit({ type: "state_update", state: this.getState() });
  }

  emit(event: CoreRpcEvent): void {
    if (this.outputSink) {
      this.outputSink(JSON.stringify(event));
    }
  }

  async handleInputLine(line: string): Promise<void> {
    const trimmed = line.trim();
    if (!trimmed) return;

    let command: CoreRpcCommand;
    try {
      command = JSON.parse(trimmed) as CoreRpcCommand;
    } catch {
      this.emit({ type: "error", message: `Malformed RPC frame: ${trimmed}` });
      return;
    }

    await this.dispatch(command);
  }

  async dispatch(command: CoreRpcCommand): Promise<void> {
    switch (command.type) {
      case "get_state": {
        this.emit({ type: "state_update", state: this.getState() });
        break;
      }

      case "get_messages": {
        for (const m of this.messages) {
          this.emit({ type: "message_end", message: m });
        }
        break;
      }

      case "new_session": {
        this.state.sessionId = `session_${Date.now().toString(36)}`;
        this.state.sessionName = command.name ?? "Mobile Session";
        this.state.createdAt = Date.now();
        this.state.updatedAt = Date.now();
        this.state.messageCount = 0;
        this.state.todoPhases = [];
        this.messages = [];
        await this.store.saveSession(this.state, this.messages);
        this.emit({ type: "state_update", state: this.getState() });
        break;
      }

      case "set_model": {
        this.state.activeModel.provider = command.provider;
        this.state.activeModel.id = command.modelId;
        this.state.activeModel.name = `${command.provider}/${command.modelId}`;
        this.state.updatedAt = Date.now();
        await this.store.saveSession(this.state, this.messages);
        this.emit({ type: "state_update", state: this.getState() });
        break;
      }

      case "set_thinking_level": {
        this.state.thinkingLevel = command.level;
        this.state.updatedAt = Date.now();
        await this.store.saveSession(this.state, this.messages);
        this.emit({ type: "state_update", state: this.getState() });
        break;
      }

      case "set_todos": {
        this.state.todoPhases = command.phases;
        this.state.updatedAt = Date.now();
        await this.store.saveSession(this.state, this.messages);
        this.emit({ type: "state_update", state: this.getState() });
        break;
      }

      case "abort": {
        if (this.abortController) {
          this.abortController.abort();
          this.abortController = null;
        }
        this.state.isStreaming = false;
        this.emit({ type: "state_update", state: this.getState() });
        break;
      }

      case "prompt": {
        const userMsg: CoreMessage = {
          id: `msg_user_${Date.now()}`,
          role: "user",
          content: command.message,
          timestamp: Date.now(),
        };
        this.messages.push(userMsg);
        this.state.messageCount = this.messages.length;
        this.state.updatedAt = Date.now();
        this.emit({ type: "message_end", message: userMsg });

        this.state.isStreaming = true;
        this.emit({ type: "state_update", state: this.getState() });

        this.abortController = new AbortController();
        try {
          await this.agentLoop.runTurn(
            this.state,
            this.messages,
            (evt) => this.emit(evt),
            this.abortController.signal
          );
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          this.emit({ type: "error", message: msg });
        } finally {
          this.state.isStreaming = false;
          this.abortController = null;
          this.state.messageCount = this.messages.length;
          this.state.updatedAt = Date.now();
          await this.store.saveSession(this.state, this.messages);
          this.emit({ type: "state_update", state: this.getState() });
        }
        break;
      }

      case "execute_tool": {
        const outcome = await this.agentLoop.executeTool(
          command.name,
          command.args,
          (evt) => this.emit(evt)
        );
        this.emit({
          type: "tool_end",
          toolCallId: `call_direct_${Date.now()}`,
          name: command.name,
          result: outcome.result,
          isError: outcome.isError,
        });
        break;
      }

      case "answer_ask": {
        this.agentLoop.getAsk().submitAnswer(command.askId, command.selected);
        break;
      }

      case "configure_keys": {
        for (const [provider, key] of Object.entries(command.keys)) {
          await this.store.saveApiKey(provider, key);
        }
        break;
      }

      default:
        break;
    }
  }
}
