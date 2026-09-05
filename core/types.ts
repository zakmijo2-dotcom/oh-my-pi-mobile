/**
 * oh-my-pi Mobile: Core Module Boundary Types
 *
 * Strict separation of concerns:
 * These types define the contract between the ported oh-my-pi core engine
 * and any consumer (such as the mobile UI or headless test harness).
 * The core module has zero dependencies on UI, DOM, or terminal rendering.
 */

export type Role = "user" | "assistant" | "system" | "tool";

export type EvidenceGrade = "CONFIRMED" | "INFERRED" | "UNCLEAR";

export interface EvidenceTag {
  grade: EvidenceGrade;
  claim: string;
  source?: string;
}

export interface ContentBlockText {
  type: "text";
  text: string;
}

export interface ContentBlockToolCall {
  type: "tool_call";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ContentBlockToolResult {
  type: "tool_result";
  toolCallId: string;
  name: string;
  result: unknown;
  isError?: boolean;
}

export interface ContentBlockThinking {
  type: "thinking";
  thinking: string;
}

export type MessageContentBlock =
  | ContentBlockText
  | ContentBlockToolCall
  | ContentBlockToolResult
  | ContentBlockThinking;

export interface CoreMessage {
  id: string;
  role: Role;
  content: string | MessageContentBlock[];
  timestamp: number;
  evidence?: EvidenceTag[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  tier?: "essential" | "discoverable";
}

export interface ToolExecutionResult {
  toolCallId: string;
  name: string;
  result: unknown;
  isError: boolean;
  metadata?: Record<string, unknown>;
}

export interface TodoItem {
  id: string;
  task: string;
  phase: string;
  status: "pending" | "in_progress" | "done" | "blocked" | "dropped";
  reason?: string;
}

export interface TodoPhase {
  phase: string;
  items: TodoItem[];
}

export interface ModelDescriptor {
  id: string;
  name: string;
  provider: string;
  contextWindow: number;
  maxTokens: number;
  reasoning?: boolean;
  inputModalities: ("text" | "image")[];
}

export interface CoreSessionState {
  sessionId: string;
  sessionName: string;
  createdAt: number;
  updatedAt: number;
  activeModel: ModelDescriptor;
  thinkingLevel: "off" | "low" | "medium" | "high";
  isStreaming: boolean;
  messageCount: number;
  todoPhases: TodoPhase[];
  offlineOnly: boolean;
}

// ============================================================================
// RPC Protocol Frame Definitions (Parity with packages/coding-agent/src/modes/rpc/rpc-types.ts)
// ============================================================================

export type CoreRpcCommand =
  | { id?: string; type: "prompt"; message: string }
  | { id?: string; type: "steer"; message: string }
  | { id?: string; type: "abort" }
  | { id?: string; type: "new_session"; name?: string }
  | { id?: string; type: "get_state" }
  | { id?: string; type: "get_messages" }
  | { id?: string; type: "set_model"; provider: string; modelId: string }
  | { id?: string; type: "set_thinking_level"; level: "off" | "low" | "medium" | "high" }
  | { id?: string; type: "set_todos"; phases: TodoPhase[] }
  | { id?: string; type: "execute_tool"; name: string; args: Record<string, unknown> }
  | { id?: string; type: "answer_ask"; askId: string; selected: string[] | string }
  | { id?: string; type: "configure_keys"; keys: Record<string, string> };

export type CoreRpcEvent =
  | { type: "ready"; protocolVersion: 1 }
  | { type: "turn_start"; turnIndex: number }
  | { type: "turn_end"; turnIndex: number }
  | { type: "message_start"; messageId: string; role: Role }
  | { type: "message_delta"; messageId: string; delta: string; deltaType: "text" | "thinking" }
  | { type: "message_end"; message: CoreMessage }
  | { type: "tool_start"; toolCallId: string; name: string; args: Record<string, unknown> }
  | { type: "tool_end"; toolCallId: string; name: string; result: unknown; isError: boolean }
  | { type: "state_update"; state: CoreSessionState }
  | { type: "ask_request"; askId: string; question: string; options: { label: string; description?: string }[]; multi?: boolean }
  | { type: "error"; message: string; code?: string };
