# oh-my-pi Mobile: Ground Truth & Portability Risk Report (Phase 0)

**Date:** 2026-09-05  
**Target Device Profile:** Poco X7 Pro class (ARM64 Android, mid-range hardware, touchscreen baseline ~380px width)  
**Status:** Gate 0 Complete — All Capabilities Classified & UNCLEAR Items Resolved

---

## 1. Executive Summary

This report establishes the ground-truth reverse-engineering baseline of **oh-my-pi** (OMP) from the primary repository (`can1357/oh-my-pi`, commit/version `v18.1.8`–`v18.1.10`) and its runtime artifacts.

oh-my-pi is an enhanced, batteries-included AI coding agent built as a monorepo in TypeScript and Rust, bundled with Bun (`bun build --compile`). It features a multi-provider LLM client, an append-only agent loop, local SQLite session management, a suite of 31 built-in tools (including hashline editing, AST parsing, and in-process bash), subagent orchestration (`task` / `hub`), and multiple entry points (Terminal TUI, One-Shot CLI, SDK, and Headless JSON RPC).

The purpose of this report is to delineate what ports directly, what requires mobile compatibility shims, what requires full reimplementation, and to explicitly resolve all environmental assumptions prior to Phase 1 architecture decisions.

---

## 2. oh-my-pi Source Inventory

### 2.1 Entry Points
- **CLI / Interactive Terminal TUI (`packages/coding-agent/src/main.ts`, `cli.ts`)**:
  - Main binary entry point parsing flags (`--model`, `--smol`, `--slow`, `--plan`, `--resume`, `--mode`).
  - Terminal interactive loop driven by `@oh-my-pi/pi-tui` (raw TTY, ANSI escape codes, SGR styling, differential cell rendering, Kitty/xterm protocol).
- **Headless RPC Mode (`packages/coding-agent/src/modes/rpc/rpc-mode.ts`)**:
  - Bi-directional NDJSON over stdio with protocol negotiation, chunking, and command/event schemas.
  - Supports commands: `prompt`, `steer`, `follow_up`, `abort`, `new_session`, `get_state`, `set_fast_mode`, `set_todos`, `set_model`, `cycle_model`, `compact`, `bash`, `get_messages`, `export_html`, `login`.
  - Emits events: `turn_start`, `turn_end`, `message_start`, `message_update`, `message_end`, `tool_execution_*`, `subagent_*`, and `extension_ui_request` (structured interactive dialogs for `select`, `confirm`, `input`, `editor`, `setStatus`, `setWidget`).
- **ACP Server (`packages/coding-agent/src/modes/acp/`)**:
  - Agent Client Protocol over JSON-RPC stdio for integration into IDEs (Zed, etc.).
- **Embeddable SDK (`packages/coding-agent/src/sdk.ts`)**:
  - Exposes `createAgentSession`, `ModelRegistry`, `SessionManager`, `discoverAuthStorage`.

### 2.2 Core Modules & Packages
1. **`@oh-my-pi/pi-agent-core` (`packages/agent`)**:
   - `Agent` & `agent-loop.ts`: Main multi-turn conversation loop, tool execution lifecycle, turn control, error handling.
   - `append-only-context.ts`: Append-only immutable message history with branch support.
   - `compaction/`: Context window management, message pruning, and summary compaction.
   - `telemetry.ts`: Token consumption metrics, timing, cost calculations.
2. **`@oh-my-pi/pi-ai` (`packages/ai`)**:
   - Multi-provider LLM client with unified streaming (`stream.ts`), SSE parsers, and tool-calling interfaces.
   - Supports 60+ providers: frontier APIs (Anthropic Claude, OpenAI GPT, Google Gemini, xAI Grok, Cerebras, Groq, Mistral), coding plans, and local OpenAI-compatible endpoints (Ollama, LM Studio, llama.cpp).
   - `auth-storage.ts` & `sqlite-credential-store.ts`: Local persistent credential storage.
3. **`@oh-my-pi/pi-catalog` (`packages/catalog`)**:
   - Database of model capabilities, context window sizes, maximum token limits, pricing tables, and input modalities (text/vision).
4. **`@oh-my-pi/pi-coding-agent` (`packages/coding-agent`)**:
   - Session manager (`SessionManager`), branching, serialization to JSONL and SQLite.
   - Tool implementations: `read`, `write`, `edit` (hashline), `todo`, `ask`, `grep`, `glob`, `web_search`, `task`, `hub`, `eval`, `lsp`, `debug`, `computer`, `browser`.
   - Subagents & Task Hub: Orchestrates concurrent workers with schema-validated outputs and peer-to-peer IRC messaging.
5. **`@oh-my-pi/hashline` & `crates/pi-edit`**:
   - Content-hash line-anchored patch language. Guarantees drift-free code editing without retyping full files.
6. **`@oh-my-pi/pi-natives` (`crates/pi-natives`, `pi-shell`, `pi-ast`, `pi-walker`)**:
   - Rust native addons compiled as N-API (`pi_natives.linux-arm64.node`).
   - Includes ripgrep regex engine, tree-sitter AST queries, brush bash shell execution with 58 built-in utilities, and PTY allocation.
7. **`@oh-my-pi/pi-tui` (`packages/tui`)**:
   - Terminal-specific UI renderer.

### 2.3 Runtime Dependencies & Environment
- **Runtime**: Bun (>= 1.3.14) or Node.js runtime.
- **Native Linkage**: Glibc-compiled `.node` binary on Linux. (Android requires Bionic libc or loader shim).
- **Persistence**: Local SQLite databases (`agent.db`, `history.db`, `models.db`) and JSONL session files.
- **Network**: Outbound HTTPS to LLM API endpoints and web search backends; WebSockets for collab relays.
- **Environment Variables**: Provider keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, etc.), `OMP_PROFILE`, `PI_CODING_AGENT_DIR`, standard POSIX path variables.

---

## 3. Evidence-Graded Capability Inventory

| Capability | Category | Evidence Grade | Source Verification / Ground Truth |
| :--- | :--- | :--- | :--- |
| Multi-turn Agent Loop | Core Reasoning | **CONFIRMED** | `packages/agent/src/agent-loop.ts`: Turn-based loop handling user prompt, assistant response, and tool invocation cycles. |
| Streaming Multi-Provider LLM Client | Networking / AI | **CONFIRMED** | `packages/ai/src/stream.ts`, `packages/ai/src/providers/`: Direct SSE HTTP streaming to frontier and local OpenAI-compatible endpoints. |
| Local SQLite Session Store | Persistence | **CONFIRMED** | `packages/coding-agent/src/session/sql-session-storage.ts`, verified SQLite files on disk (`~/.omp/agent/agent.db`, `history.db`). |
| JSON-Lines RPC Protocol | Headless API | **CONFIRMED** | `packages/coding-agent/src/modes/rpc/rpc-mode.ts`: Full command/event NDJSON interface. Verified via live execution of `omp --mode rpc`. |
| Hashline Anchored Code Editing | Tooling | **CONFIRMED** | `crates/pi-edit/` and `packages/coding-agent/src/edit/`: Content-hash line anchoring. |
| Phased Todo Task Tracking | Tooling | **CONFIRMED** | `packages/coding-agent/src/tools/todo.ts`: State machine with phases, auto-promotion, and completion tracking. |
| Interactive `ask` Questionnaire | Tooling / UX | **CONFIRMED** | `packages/coding-agent/src/tools/ask.ts`: Structured multi-select / single-select clarification questions. |
| Web Search Aggregation | Tooling | **CONFIRMED** | `packages/coding-agent/src/tools/web_search.ts`, `packages/coding-agent/src/web/`: Aggregator over 23 search backends. |
| Subagent Hub (`task` & `hub`) | Orchestration | **CONFIRMED** | `packages/coding-agent/src/task/`, `tools/hub/`: Fan-out, peer messaging, and typed schema validation. |
| Evidence-Graded Output Style | Output / UX | **CONFIRMED** | Verified in agent prompt directives and system prompt (`system-prompt.ts`): Output requires explicit CONFIRMED / INFERRED / UNCLEAR categorization for claims. |
| Fully Offline Core Engine | Runtime | **INFERRED** | Agent loop, tools, session store, hashline edits, and state machines require zero network access. With local inference (llama.cpp/Ollama) or session inspection, operation is 100% offline. Remote frontier models require HTTPS connectivity. |
| Terminal TUI Unusable on Touch Mobile | UX | **INFERRED** | `@oh-my-pi/pi-tui` relies on raw keyboard escape codes, stdout ANSI grids, and 80x24 desktop geometry. A mobile touch surface (~380px width) cannot be served by a terminal wrapper. |
| Rust Native Addon Bionic Incompatibility | Runtime | **INFERRED** | `pi_natives.linux-arm64.node` is linked against glibc. Android apps run on Bionic libc. Direct `dlopen()` fails without Bionic compilation or a loader shim. |
| Mobile Subprocess Execution Restrictions | OS / Sandbox | **UNCLEAR** | Android SELinux policy restricts spawning arbitrary `/bin/bash` processes in standard APK sandboxes. (See Resolution below). |
| Scope of "Complete Functionality Fully Locally" | Architecture | **UNCLEAR** | Distinction between local engine with direct-to-provider API calls vs requiring local weights inference. (See Resolution below). |
| Desktop Automation Tool Suitability | Tooling | **UNCLEAR** | `computer` (native OS desktop AX capture) and `browser` (Puppeteer desktop Chrome) on mobile. (See Resolution below). |

---

## 4. Resolution of UNCLEAR Items

### UNCLEAR Item 1: Scope of "Complete Functionality Fully Locally"
- **Issue**: The prompt mandates: *"runs its complete functionality fully locally on-device (no remote server dependency for core operation)"*. Does this require on-device LLM weights execution, or does it mean the agent application, state, tools, session store, and prompt orchestration run 100% on-device with direct outbound API calls or local inference endpoints?
- **Stated Resolution**:
  1. The entire **agent harness, session database, conversation history, tool execution engine, patcher, and UI must execute 100% locally on-device**. No cloud backend or middleman server is permitted.
  2. For model inference: The app must support **both** (a) direct on-device API keys for frontier providers (OpenAI, Gemini, Anthropic, OpenRouter) and (b) local-on-device inference endpoints (e.g. `http://localhost:8080/v1` for local `llama.cpp` or local Ollama servers).
  3. All non-inference features (session browsing, search history, file management, tool evaluations, prompt generation, offline replays, parity tests) must function 100% offline in airplane mode.

### UNCLEAR Item 2: Subprocess Spawning & Shell Access on Android
- **Issue**: In desktop Linux, `omp` spawns `/bin/bash` or uses `brush-core` linked via glibc. In an Android application sandbox, standard `/bin/bash` does not exist, and SELinux restricts spawning external binaries.
- **Stated Resolution**:
  - On mobile, the tool execution layer must provide an **in-process safe execution sandbox** (built-in JavaScript/TypeScript evaluator, virtual file system environment, and structured tool executors) for core tasks.
  - The architecture must decouple tool execution from assuming a desktop `/bin/bash` path.

### UNCLEAR Item 3: Desktop-Only Capabilities (`computer`, `browser`, `debug`)
- **Issue**: Tools like `computer` (capturing OS desktop windows with `xcap`/`enigo`), `browser` (launching desktop Chromium with Puppeteer), and `debug` (attaching `lldb-dap`/`dlv`) are inherently desktop-specific.
- **Stated Resolution**:
  - These tools are explicitly flagged as **Desktop-Only**.
  - In the mobile port, they are cleanly disabled or provided with mobile-appropriate alternatives (e.g., local web fetch/reader for browser; in-process eval for debug), preserving tool-call schemas without crashing the engine.

---

## 5. POSIX & Desktop Environmental Assumptions (High-Risk Items)

1. **POSIX Filesystem Paths (`~/.omp`, `/tmp`)**:
   - *Risk*: High. Android app storage is sandboxed under `/data/data/<package>/files` or app-specific external storage.
   - *Mitigation*: Storage root must be configurable via runtime environment abstraction (`StorageProvider`).
2. **Glibc vs. Android Bionic Libc**:
   - *Risk*: High. The precompiled `omp` binary and `pi_natives` require glibc.
   - *Mitigation*: Core logic in the mobile application must run on a runtime compatible with Android (Bionic-native Node/Bun, Android WebView JS engine, or Dart/Kotlin native runtime).
3. **Raw Terminal TUI Dependencies (`@oh-my-pi/pi-tui`)**:
   - *Risk*: High. Terminal UI components cannot handle touch gestures, variable mobile viewports, or soft keyboards.
   - *Mitigation*: Complete replacement with a touch-native mobile interface designed for small screens (~380px baseline).

---

## 6. Portability Risk Report: Component Classification

### 6.1 Directly Portable (Zero or Minimal Changes)
- **Agent Core State Machine & Loop** (`@oh-my-pi/pi-agent-core`): Pure TypeScript logic; compiles directly to any modern JS runtime.
- **LLM Streaming & Provider Protocols** (`@oh-my-pi/pi-ai`): Standard Fetch and SSE parsing; 100% portable.
- **Model Catalog** (`@oh-my-pi/pi-catalog`): Static JSON/YAML metadata definitions.
- **Hashline Patch Algorithm** (`@oh-my-pi/hashline`): Content-hash diffing and line insertion/deletion algorithms port cleanly.
- **Todo State Machine** (`packages/coding-agent/src/tools/todo.ts`): Phase transitions, auto-promotion, and task state management.
- **Ask Questionnaire Generator** (`packages/coding-agent/src/tools/ask.ts`): Question schemas and validation.
- **Headless RPC Protocol Framing** (`packages/coding-agent/src/modes/rpc/`): Command dispatch and event streaming interfaces.

### 6.2 Compatibility Shim Needed
- **File System Operations (`read`, `write`, `glob`)**: Shim with mobile app-sandboxed storage or workspace directories.
- **Grep & Regex Search**: Shim using pure-JS regex or mobile-compiled native library instead of glibc ripgrep addon.
- **SQLite Database Persistence**: Shim using mobile SQLite bindings (e.g., `sqlite3`, `better-sqlite3`, or Wasm SQLite).
- **Subagent Concurrency (`task`, `hub`)**: Shim to run within process worker threads or async task queues rather than spawned OS processes.

### 6.3 Full Reimplementation Needed
- **User Interface**: Complete mobile-native UI implementation from scratch. Must support:
  - Touch-first responsive layout (~380px width baseline).
  - Collapsible cards, bottom sheets, single-hand thumb navigation.
  - Distinct visual badges for evidence grading (**CONFIRMED**, **INFERRED**, **UNCLEAR**).
  - Raw JSON/output inspector for technical users.
- **Shell Tool Execution**: In-process command interpreter / evaluation sandbox replacing desktop `/bin/bash`.
- **Desktop Hardware APIs**: Desktop AX (`computer`) and native PTY allocation are disabled or shimmed with clean stubs.

---

## 7. Gate 0 Validation Sign-off

- [x] **Source Inventory Completed**: Entry points, core modules, runtime dependencies, and environment variables identified.
- [x] **Capabilities Classified**: Every capability graded as CONFIRMED, INFERRED, or UNCLEAR.
- [x] **Environmental Assumptions Flagged**: POSIX paths, Bionic libc, subprocess spawning, and desktop-only APIs surfaced.
- [x] **All UNCLEAR Items Resolved**: Stated resolutions defined without architecture blockers.
- [x] **Portability Risk Report Generated**: Explicit classification into Directly Portable, Shimmed, and Reimplemented.

**Gate 0 Status:** **PASS** — Ready to proceed to Phase 1 (Architecture Decision).
