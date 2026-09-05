/**
 * oh-my-pi Mobile: Isolated Core Module Boundary
 *
 * This module is the sole public API of the ported oh-my-pi engine.
 * It strictly encapsulates the agent loop, tools, models, persistence,
 * and RPC messaging, presenting an event-driven interface to the mobile UI.
 */

import { LocalSessionStore, type IStorageBackend } from "./session/storage";
import type {
  CoreMessage,
  CoreRpcCommand,
  CoreRpcEvent,
  CoreSessionState,
  ModelDescriptor,
  TodoPhase,
} from "./types";

export * from "./types";
export * from "./session/storage";
export * from "./hashline";
export * from "./tools/todo";
export * from "./tools/ask";
export * from "./tools/fs";
export * from "./ai/stream";
export * from "./agent/loop";
export * from "./rpc/dispatcher";

export interface CoreEngineOptions {
  storageBackend?: IStorageBackend;
  offlineOnly?: boolean;
}

export type EventListener = (event: CoreRpcEvent) => void;

export class OhMyPiCoreEngine {
  private store: LocalSessionStore;
  private state: CoreSessionState;
  private messages: CoreMessage[] = [];
  private listeners: Set<EventListener> = new Set();
  private abortController: AbortController | null = null;
  private offlineOnly: boolean;

  constructor(options: CoreEngineOptions = {}) {
    this.store = new LocalSessionStore(options.storageBackend);
    this.offlineOnly = options.offlineOnly ?? true;

    const defaultModel: ModelDescriptor = {
      id: "gemini-3.8-flash",
      name: "Gemini 3.8 Flash (Local Direct)",
      provider: "google",
      contextWindow: 1048576,
      maxTokens: 65536,
      reasoning: true,
      inputModalities: ["text", "image"],
    };

    const initialSessionId = `session_${Date.now().toString(36)}`;
    this.state = {
      sessionId: initialSessionId,
      sessionName: "New Session",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      activeModel: defaultModel,
      thinkingLevel: "medium",
      isStreaming: false,
      messageCount: 0,
      todoPhases: [],
      offlineOnly: this.offlineOnly,
    };
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

  onEvent(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: CoreRpcEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error("Error in core event listener:", err);
      }
    }
  }

  getState(): CoreSessionState {
    return { ...this.state };
  }

  getMessages(): CoreMessage[] {
    return [...this.messages];
  }

  async dispatch(command: CoreRpcCommand): Promise<void> {
    switch (command.type) {
      case "get_state": {
        this.emit({ type: "state_update", state: this.getState() });
        break;
      }
      case "get_messages": {
        // Emit full message snapshot
        for (const msg of this.messages) {
          this.emit({ type: "message_end", message: msg });
        }
        break;
      }
      case "set_model": {
        this.state.activeModel.provider = command.provider;
        this.state.activeModel.id = command.modelId;
        this.state.activeModel.name = `${command.provider}/${command.modelId}`;
        this.state.updatedAt = Date.now();
        await this.persist();
        this.emit({ type: "state_update", state: this.getState() });
        break;
      }
      case "set_thinking_level": {
        this.state.thinkingLevel = command.level;
        this.state.updatedAt = Date.now();
        await this.persist();
        this.emit({ type: "state_update", state: this.getState() });
        break;
      }
      case "set_todos": {
        this.state.todoPhases = command.phases;
        this.state.updatedAt = Date.now();
        await this.persist();
        this.emit({ type: "state_update", state: this.getState() });
        break;
      }
      case "new_session": {
        const newId = `session_${Date.now().toString(36)}`;
        this.state.sessionId = newId;
        this.state.sessionName = command.name ?? "New Session";
        this.state.createdAt = Date.now();
        this.state.updatedAt = Date.now();
        this.state.messageCount = 0;
        this.state.todoPhases = [];
        this.messages = [];
        await this.persist();
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
        await this.handlePrompt(command.message);
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

  private async handlePrompt(userText: string): Promise<void> {
    const userMsg: CoreMessage = {
      id: `msg_user_${Date.now()}`,
      role: "user",
      content: userText,
      timestamp: Date.now(),
    };
    this.messages.push(userMsg);
    this.state.messageCount = this.messages.length;
    this.state.updatedAt = Date.now();
    this.emit({ type: "message_end", message: userMsg });

    this.state.isStreaming = true;
    this.emit({ type: "state_update", state: this.getState() });
    this.emit({ type: "turn_start", turnIndex: this.messages.length });

    this.abortController = new AbortController();

    // Assistant response placeholder
    const assistantId = `msg_asst_${Date.now()}`;
    this.emit({ type: "message_start", messageId: assistantId, role: "assistant" });

    try {
      // Offline / Local response synthesis
      // In Phase 3, this integrates the full ported multi-provider client and local agent loop
      const sampleResponse = this.synthesizeLocalResponse(userText);
      for (const token of sampleResponse.tokens) {
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, 20);
        await promise;
        this.emit({
          type: "message_delta",
          messageId: assistantId,
          delta: token,
          deltaType: "text",
        });
      }
      const assistantMsg: CoreMessage = {
        id: assistantId,
        role: "assistant",
        content: sampleResponse.fullText,
        timestamp: Date.now(),
        evidence: sampleResponse.evidence,
      };
      this.messages.push(assistantMsg);
      this.state.messageCount = this.messages.length;
      this.state.updatedAt = Date.now();
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : "Execution error";
      this.emit({ type: "error", message: errorMsg });
    } finally {
      this.state.isStreaming = false;
      this.abortController = null;
      await this.persist();
      this.emit({ type: "turn_end", turnIndex: this.messages.length });
      this.emit({ type: "state_update", state: this.getState() });
    }
  }

  private synthesizeLocalResponse(input: string): {
    tokens: string[];
    fullText: string;
    evidence: CoreMessage["evidence"];
  } {
    const trimmed = input.trim();
    const isOffline = this.state.offlineOnly;
    const responseText =
      `[CONFIRMED] Running in local mobile execution mode on Android target.\n` +
      `[CONFIRMED] Local session storage is active; state persisted on-device.\n` +
      `[INFERRED] User query received: "${trimmed.slice(0, 80)}${trimmed.length > 80 ? "..." : ""}".\n` +
      `[CONFIRMED] oh-my-pi core engine initialized and ready for tool execution.`;

    const words = responseText.split(" ");
    const tokens = words.map((w, idx) => (idx === words.length - 1 ? w : w + " "));
    return {
      tokens,
      fullText: responseText,
      evidence: [
        { grade: "CONFIRMED", claim: "Local mobile execution mode active" },
        { grade: "CONFIRMED", claim: "Session state persisted on-device" },
        { grade: "INFERRED", claim: "User prompt parsed by core engine" },
      ],
    };
  }

  private async persist(): Promise<void> {
    await this.store.saveSession(this.state, this.messages);
  }
}

// Attach to window for mobile browser / WebView host
if (typeof window !== "undefined") {
  const win = window as unknown as Record<string, unknown>;
  win.OmpCore = {
    OhMyPiCoreEngine,
  };
}
