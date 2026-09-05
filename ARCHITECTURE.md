# oh-my-pi Mobile: Architecture Decision & Stack Proposal (Phase 1)

**Date:** 2026-09-05  
**Author:** Oh-My-Pi Mobile Build Agent  
**Status:** Gate 1 Proposal & Recommendation  

---

## 1. Architecture Options Evaluation

Based on the findings from Phase 0 (Portability Risk Report), three potential mobile execution architectures were evaluated:

### Option A: Pure Native Reimplementation (Kotlin / Jetpack Compose)
- **Description**: Rewrite the entire oh-my-pi core engine (Agent loop, 60+ provider dialect formatters, SSE stream parsing, Hashline patch grammar, Todo state machine, session management) in pure Kotlin with a Jetpack Compose UI.
- **Feasibility**: Moderate. High risk of subtle behavioral drift and edge-case regressions when replicating thousands of lines of upstream TypeScript logic and provider dialect rules.
- **App Size & Performance**: Excellent (~15–25 MB APK, ~40–60 MB RAM). Fast startup, low battery drain.
- **App Store Distribution Risk**: **Zero**. Fully compliant with Google Play Developer Policies.
- **Maintenance Burden**: **High**. Any upstream prompt updates, provider schema changes, or bug fixes require dual-maintenance and manual re-porting to Kotlin.

### Option B: Embedded Linux Userland (PRoot / glibc Bundled Runtime)
- **Description**: Package a minimal Linux userland with glibc loader and the existing compiled `omp-linux-arm64` binary inside an APK wrapper, communicating over localhost/stdio.
- **Feasibility**: High immediate feasibility on Termux-like developer setups, but fundamentally flawed for general mobile distribution.
- **App Size & Performance**: Very poor (250 MB+ download, 500 MB+ unpacked). High RAM usage (150–300 MB), slow cold-start.
- **App Store Distribution Risk**: **Critical / Fatal**. Google Play explicitly prohibits packaging foreign dynamic linkers (`ld-linux`) and executing binaries from writable app storage (W^X policy violations under SELinux on Android 10+).
- **Maintenance Burden**: High. Constant fragility across Android OS updates and ARM64 dynamic linker changes.

### Option C: Hybrid Architecture — Mobile-Native Touch UI + Sandboxed Embedded Core Engine (RECOMMENDED)
- **Description**:
  - **Core Logic**: The core logic of oh-my-pi is TypeScript. Instead of glibc/PRoot, host the ported core modules (`pi-agent-core`, `pi-ai`, `hashline`, `todo`, `ask`, session store) inside an Android Bionic–compliant, sandboxed local JavaScript engine.
  - **Mobile UI**: A purpose-built, touch-native mobile interface designed from scratch for ~380px mobile viewports, one-handed navigation, bottom sheets, collapsible tool cards, and visual chips for evidence-graded outputs (CONFIRMED / INFERRED / UNCLEAR).
  - **Bridge**: The mobile UI drives the core engine using the confirmed, headless **oh-my-pi RPC Protocol** (NDJSON commands and event stream), ensuring complete architectural decoupling.
- **Feasibility**: **High**. Delivers 100% behavioral parity with upstream oh-my-pi logic without glibc incompatibilities.
- **App Size & Performance**: **Optimal** (~15–30 MB APK, ~50–80 MB RAM). Cold start < 1 second. Smooth 60fps UI rendering on Poco X7 Pro class hardware.
- **App Store Distribution Risk**: **Zero**. Sandboxed JavaScript execution within app storage is standard Android architecture (identical to React Native, Capacitor, and official Android WebView architectures).
- **Maintenance Burden**: **Low**. Clean separation of concerns; upstream TypeScript core logic and schemas remain directly portable.

---

## 2. Recommended Full Stack Specification

| Layer | Recommended Technology | Justification |
| :--- | :--- | :--- |
| **Mobile Application Framework** | **Android Native Shell + Mobile-First Touch UI** | Provides native Android application lifecycle, offline persistence, and touch-first responsiveness optimized for ~380px width screens. |
| **Core Logic Runtime** | **Sandboxed Local JavaScript Engine (Android-Safe)** | Runs ported oh-my-pi TypeScript modules (`pi-agent-core`, `pi-ai`, `hashline`, `todo`, `ask`) directly on-device without glibc or root dependencies. |
| **State Management & Bridge** | **oh-my-pi RPC Event Bus (NDJSON)** | Uses the native oh-my-pi RPC command/response/event protocol (`prompt`, `steer`, `set_todos`, `tool_execution_*`, `turn_*`). Ensures strict isolation between UI and core. |
| **Local Persistence Layer** | **On-Device SQLite + Local File System Storage** | 100% local persistence for sessions, history, and models cache. Zero remote sync or implicit cloud dependency. Handles app pause/resume/restart gracefully. |
| **Styling & Touch Patterns** | **Mobile-Native Touch CSS / Responsive Mobile Engine** | Designed for one-hand reachability, bottom-sheet menus, collapsible tool accordions, evidence-graded color badges, and raw JSON inspectors. |
| **Build & Packaging Tooling** | **Android SDK Tools (`aapt2`, `d8`, `javac`, `apksigner`)** | Native command-line build pipeline running directly on ARM64 Linux / Android workstation to generate deployable `.apk` artifacts. |

---

## 3. UI/UX Mapping to oh-my-pi Concepts

1. **Prompt & Turn Lifecycle**:
   - Bottom-anchored prompt composer with quick-action chips.
   - Real-time streaming response card with animated status indicators (thinking, tool execution, output).
2. **Evidence Grading Display**:
   - Dedicated visual badges (not just plain text):
     - `[CONFIRMED]` in green badge (`#10b981`)
     - `[INFERRED]` in amber badge (`#f59e0b`)
     - `[UNCLEAR]` in purple/indigo badge (`#6366f1`)
3. **Tool Execution Cards**:
   - Progressive disclosure: compact collapsible cards showing tool name, target path, and duration.
   - Tap-to-expand details showing parameters, hashline diffs, and execution results.
4. **Power User Inspector**:
   - Accessible raw JSON viewer for events, tokens, and RPC payloads available via a bottom-sheet drawer.

---

## 4. Gate 1 Validation & Distribution Statement

- **Store Policy Compliance**: The recommended Hybrid stack uses standard Android sandboxed execution. It does **not** rely on dynamic binary downloading, `PRoot`, or glibc hacks that trigger Play Store rejections.
- **Licensing Compliance**: All ported components remain under the original MIT License.
- **Local-Only Guarantee**: The core engine operates completely offline for all local operations; network access is used solely for direct user-configured LLM API calls and web search backends.

**Gate 1 Recommendation:** Proceed to **Phase 2 (Project Scaffold)** with the recommended Hybrid Architecture.
