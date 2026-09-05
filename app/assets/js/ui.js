/**
 * oh-my-pi Mobile: Mobile-Native UI Controller
 *
 * Connects the touch-first DOM interface to the ported OhMyPiCoreEngine.
 * Handles:
 * - Real-time streaming rendering
 * - Evidence grading visual badges ([CONFIRMED], [INFERRED], [UNCLEAR])
 * - Collapsible tool execution cards
 * - Ask dialog bottom-sheet
 * - Raw JSON output inspector drawer
 */

(function () {
  let engine;
  let activeAssistantCard = null;
  let activeAssistantText = "";
  let activeAssistantThinking = "";
  let currentRawPayload = null;

  document.addEventListener("DOMContentLoaded", async () => {
    initElements();
    await initEngine();
  });

  async function initEngine() {
    // Create and initialize CoreEngine
    if (window.OmpCore && window.OmpCore.OhMyPiCoreEngine) {
      engine = new window.OmpCore.OhMyPiCoreEngine({ offlineOnly: true });
    } else {
      console.warn("OmpCore not yet bundled, using fallback mock engine");
      return;
    }

    engine.onEvent((event) => handleCoreEvent(event));
    await engine.init();

    // Populate initial workspace demo files
    const loop = engine.store;
    updateStatusPill("Ready (Local)");
  }

  function initElements() {
    const sendBtn = document.getElementById("send-btn");
    const inputArea = document.getElementById("user-input");
    const newSessionBtn = document.getElementById("new-session-btn");
    const inspectCloseBtn = document.getElementById("close-sheet-btn");
    const copyJsonBtn = document.getElementById("copy-json-btn");
    const sheetOverlay = document.getElementById("sheet-overlay");

    sendBtn.addEventListener("click", () => handleSend());
    inputArea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });

    // Auto-resize input textarea
    inputArea.addEventListener("input", () => {
      inputArea.style.height = "auto";
      inputArea.style.height = Math.min(inputArea.scrollHeight, 120) + "px";
    });

    newSessionBtn.addEventListener("click", async () => {
      if (engine) {
        await engine.dispatch({ type: "new_session" });
        clearThread();
      }
    });

    inspectCloseBtn.addEventListener("click", () => closeBottomSheet());
    sheetOverlay.addEventListener("click", (e) => {
      if (e.target === sheetOverlay) closeBottomSheet();
    });

    copyJsonBtn.addEventListener("click", () => {
      if (currentRawPayload) {
        navigator.clipboard.writeText(JSON.stringify(currentRawPayload, null, 2));
        showToast("Copied raw JSON to clipboard");
      }
    });

    // Quick action chips
    document.querySelectorAll(".quick-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        const action = chip.getAttribute("data-action");
        handleQuickChip(action);
      });
    });

    // Model chip tap
    const modelChip = document.getElementById("model-chip");
    if (modelChip) {
      modelChip.addEventListener("click", () => openModelSelector());
    }
  }

  async function handleSend() {
    const input = document.getElementById("user-input");
    const text = input.value.trim();
    if (!text || !engine) return;

    input.value = "";
    input.style.height = "auto";

    await engine.dispatch({ type: "prompt", message: text });
  }

  function handleCoreEvent(event) {
    currentRawPayload = event;

    switch (event.type) {
      case "ready": {
        updateStatusPill("Ready (Local)");
        break;
      }

      case "state_update": {
        renderState(event.state);
        break;
      }

      case "turn_start": {
        setComposerEnabled(false);
        break;
      }

      case "turn_end": {
        setComposerEnabled(true);
        activeAssistantCard = null;
        activeAssistantText = "";
        activeAssistantThinking = "";
        scrollToBottom();
        break;
      }

      case "message_start": {
        if (event.role === "assistant") {
          activeAssistantCard = createAssistantCard(event.messageId);
          activeAssistantText = "";
          activeAssistantThinking = "";
        }
        break;
      }

      case "message_delta": {
        if (activeAssistantCard) {
          if (event.deltaType === "thinking") {
            activeAssistantThinking += event.delta;
            updateAssistantThinking(activeAssistantCard, activeAssistantThinking);
          } else {
            activeAssistantText += event.delta;
            updateAssistantContent(activeAssistantCard, activeAssistantText);
          }
          scrollToBottom();
        }
        break;
      }

      case "message_end": {
        if (event.message.role === "user") {
          appendUserBubble(event.message.content);
        } else if (event.message.role === "assistant") {
          if (activeAssistantCard) {
            finalizeAssistantCard(activeAssistantCard, event.message);
          } else {
            renderCompleteAssistantMessage(event.message);
          }
        }
        scrollToBottom();
        break;
      }

      case "tool_start": {
        appendToolCard(event.toolCallId, event.name, event.args);
        scrollToBottom();
        break;
      }

      case "tool_end": {
        updateToolCardResult(event.toolCallId, event.result, event.isError);
        scrollToBottom();
        break;
      }

      case "ask_request": {
        openAskDialog(event.askId, event.question, event.options, event.multi);
        break;
      }

      case "error": {
        appendErrorCard(event.message);
        setComposerEnabled(true);
        break;
      }
    }
  }

  function appendUserBubble(text) {
    const thread = document.getElementById("thread");
    const row = document.createElement("div");
    row.className = "message-row user";

    const bubble = document.createElement("div");
    bubble.className = "user-bubble";
    bubble.textContent = text;

    row.appendChild(bubble);
    thread.appendChild(row);
  }

  function createAssistantCard(messageId) {
    const thread = document.getElementById("thread");
    const row = document.createElement("div");
    row.className = "message-row assistant";
    row.setAttribute("data-msg-id", messageId);

    const card = document.createElement("div");
    card.className = "assistant-card";

    const top = document.createElement("div");
    top.className = "card-top";

    const label = document.createElement("div");
    label.className = "agent-label";
    label.innerHTML = '<span class="dot"></span> oh-my-pi';

    const inspectBtn = document.createElement("button");
    inspectBtn.className = "inspect-trigger";
    inspectBtn.textContent = "{ } RAW";
    inspectBtn.addEventListener("click", () => {
      openRawInspector({ id: messageId, text: activeAssistantText, state: engine?.getState() });
    });

    top.appendChild(label);
    top.appendChild(inspectBtn);
    card.appendChild(top);

    const thinkingBox = document.createElement("div");
    thinkingBox.className = "thinking-box";
    thinkingBox.style.display = "none";
    card.appendChild(thinkingBox);

    const body = document.createElement("div");
    body.className = "card-text-body";
    card.appendChild(body);

    const evidenceBox = document.createElement("div");
    evidenceBox.className = "evidence-container";
    card.appendChild(evidenceBox);

    row.appendChild(card);
    thread.appendChild(row);
    return card;
  }

  function updateAssistantThinking(card, thinkingText) {
    const box = card.querySelector(".thinking-box");
    if (!box) return;
    box.style.display = "flex";
    box.innerHTML = `<span class="title">Thinking Process</span><div>${escapeHtml(thinkingText)}</div>`;
  }

  function updateAssistantContent(card, text) {
    const body = card.querySelector(".card-text-body");
    if (!body) return;

    // Render text with parsed evidence badges in real-time
    body.innerHTML = formatMessageTextWithBadges(text);
  }

  function finalizeAssistantCard(card, message) {
    updateAssistantContent(card, typeof message.content === "string" ? message.content : "");

    // Render explicit evidence badges if present
    const evidenceBox = card.querySelector(".evidence-container");
    if (evidenceBox && message.evidence && message.evidence.length > 0) {
      evidenceBox.innerHTML = "";
      for (const ev of message.evidence) {
        const badge = createEvidenceBadgeElement(ev.grade, ev.claim);
        evidenceBox.appendChild(badge);
      }
    }
  }

  function renderCompleteAssistantMessage(message) {
    const card = createAssistantCard(message.id);
    finalizeAssistantCard(card, message);
  }

  function formatMessageTextWithBadges(text) {
    const lines = text.split("\n");
    const output = [];

    for (const line of lines) {
      const match = line.match(/^\[(CONFIRMED|INFERRED|UNCLEAR)\]\s*(.*)$/i);
      if (match) {
        const grade = match[1].toLowerCase();
        const claim = escapeHtml(match[2]);
        const pillIcon = grade === "confirmed" ? "✓" : grade === "inferred" ? "~" : "?";
        output.push(
          `<div class="evidence-badge ${grade}">` +
            `<span class="pill">${pillIcon} ${grade.toUpperCase()}</span>` +
            `<span class="claim">${claim}</span>` +
          `</div>`
        );
      } else {
        output.push(escapeHtml(line));
      }
    }

    return output.join("<br>");
  }

  function createEvidenceBadgeElement(grade, claim) {
    const g = grade.toLowerCase();
    const el = document.createElement("div");
    el.className = `evidence-badge ${g}`;

    const pillIcon = g === "confirmed" ? "✓" : g === "inferred" ? "~" : "?";
    el.innerHTML =
      `<span class="pill">${pillIcon} ${grade}</span>` +
      `<span class="claim">${escapeHtml(claim)}</span>`;
    return el;
  }

  function appendToolCard(callId, name, args) {
    const thread = document.getElementById("thread");
    const row = document.createElement("div");
    row.className = "message-row tool-row";
    row.setAttribute("data-tool-id", callId);

    const card = document.createElement("div");
    card.className = "tool-card";

    const header = document.createElement("div");
    header.className = "tool-header";

    const title = document.createElement("div");
    title.className = "tool-title";
    title.innerHTML = `<span class="tool-badge">TOOL</span> <span>${escapeHtml(name)}</span>`;

    const status = document.createElement("span");
    status.className = "tool-status running";
    status.textContent = "Executing...";

    header.appendChild(title);
    header.appendChild(status);

    const body = document.createElement("div");
    body.className = "tool-body";
    body.style.display = "none";
    body.textContent = JSON.stringify(args, null, 2);

    header.addEventListener("click", () => {
      body.style.display = body.style.display === "none" ? "block" : "none";
    });

    card.appendChild(header);
    card.appendChild(body);
    row.appendChild(card);
    thread.appendChild(row);
  }

  function updateToolCardResult(callId, result, isError) {
    const row = document.querySelector(`[data-tool-id="${callId}"]`);
    if (!row) return;

    const status = row.querySelector(".tool-status");
    if (status) {
      if (isError) {
        status.textContent = "✗ Error";
        status.style.color = "#ef4444";
      } else {
        status.textContent = "✓ Succeeded";
        status.style.color = "var(--color-confirmed-text)";
      }
    }

    const body = row.querySelector(".tool-body");
    if (body) {
      body.textContent += "\n\nResult:\n" + (typeof result === "string" ? result : JSON.stringify(result, null, 2));
    }
  }

  function appendErrorCard(msg) {
    const thread = document.getElementById("thread");
    const row = document.createElement("div");
    row.className = "message-row";

    const card = document.createElement("div");
    card.className = "assistant-card";
    card.style.borderColor = "#ef4444";
    card.innerHTML = `<div style="color: #ef4444; font-weight: bold;">Error</div><div>${escapeHtml(msg)}</div>`;

    row.appendChild(card);
    thread.appendChild(row);
  }

  // --- Bottom Sheet Handlers ---

  function openRawInspector(payload) {
    const overlay = document.getElementById("sheet-overlay");
    const title = document.getElementById("sheet-title");
    const body = document.getElementById("sheet-body");

    title.textContent = "Raw Output Inspector";
    currentRawPayload = payload;

    body.innerHTML = `<pre class="raw-json-view">${escapeHtml(JSON.stringify(payload, null, 2))}</pre>`;
    overlay.classList.add("active");
  }

  function openAskDialog(askId, question, options, multi) {
    const overlay = document.getElementById("sheet-overlay");
    const title = document.getElementById("sheet-title");
    const body = document.getElementById("sheet-body");

    title.textContent = "Clarification Question";
    body.innerHTML = `
      <div style="font-weight: 600; font-size: 14px; margin-bottom: 6px;">${escapeHtml(question)}</div>
      <div id="ask-options-list" style="display: flex; flex-direction: column; gap: 8px;"></div>
      <button id="submit-ask-btn" class="send-btn" style="width: 100%; border-radius: 8px; margin-top: 10px; height: 38px; font-size: 13px;">
        Submit Answer
      </button>
    `;

    const optList = body.querySelector("#ask-options-list");
    const selected = new Set();

    options.forEach((opt, idx) => {
      const btn = document.createElement("button");
      btn.className = "ask-option-btn";
      btn.innerHTML = `<span class="label">${escapeHtml(opt.label)}</span>${opt.description ? `<span class="desc">${escapeHtml(opt.description)}</span>` : ""}`;

      btn.addEventListener("click", () => {
        if (multi) {
          if (selected.has(opt.label)) {
            selected.delete(opt.label);
            btn.classList.remove("selected");
          } else {
            selected.add(opt.label);
            btn.classList.add("selected");
          }
        } else {
          selected.clear();
          document.querySelectorAll(".ask-option-btn").forEach((b) => b.classList.remove("selected"));
          selected.add(opt.label);
          btn.classList.add("selected");
        }
      });

      optList.appendChild(btn);
    });

    body.querySelector("#submit-ask-btn").addEventListener("click", async () => {
      const answers = Array.from(selected);
      if (answers.length > 0 && engine) {
        await engine.dispatch({ type: "answer_ask", askId, selected: answers });
        closeBottomSheet();
        showToast("Answer submitted");
      }
    });

    overlay.classList.add("active");
  }

  function openModelSelector() {
    const overlay = document.getElementById("sheet-overlay");
    const title = document.getElementById("sheet-title");
    const body = document.getElementById("sheet-body");

    title.textContent = "Select Active Model";
    const models = [
      { id: "gemini-3.8-flash", provider: "google", label: "Gemini 3.8 Flash (Local Direct)" },
      { id: "claude-3-7-sonnet", provider: "anthropic", label: "Claude 3.7 Sonnet (Reasoning)" },
      { id: "gpt-4o-mini", provider: "openai", label: "GPT-4o Mini (Fast)" },
      { id: "local-llama", provider: "ollama", label: "Llama 3.3 (Local On-Device llama.cpp)" },
    ];

    body.innerHTML = `<div style="display: flex; flex-direction: column; gap: 8px;"></div>`;
    const list = body.firstElementChild;

    models.forEach((m) => {
      const btn = document.createElement("button");
      btn.className = "ask-option-btn";
      btn.innerHTML = `<span class="label">${escapeHtml(m.label)}</span><span class="desc">Provider: ${m.provider}</span>`;
      btn.addEventListener("click", async () => {
        if (engine) {
          await engine.dispatch({ type: "set_model", provider: m.provider, modelId: m.id });
          closeBottomSheet();
          showToast(`Switched model to ${m.label}`);
        }
      });
      list.appendChild(btn);
    });

    overlay.classList.add("active");
  }

  function closeBottomSheet() {
    const overlay = document.getElementById("sheet-overlay");
    overlay.classList.remove("active");
  }

  // --- Quick Chips Handler ---
  async function handleQuickChip(action) {
    if (!engine) return;

    switch (action) {
      case "todo": {
        await engine.dispatch({
          type: "execute_tool",
          name: "todo",
          args: {
            op: "init",
            list: [
              { phase: "Foundation", items: ["Setup SQLite storage", "Initialize RPC bridge"] },
              { phase: "Verification", items: ["Run parity tests", "Validate offline state"] },
            ],
          },
        });
        showToast("Initialized sample Todo list");
        break;
      }

      case "write": {
        await engine.dispatch({
          type: "execute_tool",
          name: "write",
          args: {
            path: "sample.ts",
            content: "export function greet(name: string): string {\n  return `Hello, ${name}!`;\n}\n",
          },
        });
        showToast("Created workspace file sample.ts");
        break;
      }

      case "hashline": {
        await engine.dispatch({
          type: "execute_tool",
          name: "edit",
          args: {
            path: "sample.ts",
            input: "PUT 2.=2:\n+  return `Welcome to oh-my-pi Mobile, ${name}!`;",
          },
        });
        showToast("Applied Hashline patch to sample.ts");
        break;
      }

      case "ask": {
        await engine.dispatch({
          type: "execute_tool",
          name: "ask",
          args: {
            questions: [
              {
                id: "storage_mode",
                question: "Choose local storage backend mode:",
                options: [
                  { label: "SQLite On-Device", description: "Default ACID-compliant storage" },
                  { label: "In-Memory Ephemeral", description: "Zero persistence session" },
                ],
              },
            ],
          },
        });
        break;
      }

      case "raw": {
        openRawInspector(engine.getState());
        break;
      }
    }
  }

  function renderState(state) {
    const modelChip = document.getElementById("model-chip");
    const sessionLabel = document.getElementById("session-name");

    if (modelChip && state.activeModel) {
      modelChip.textContent = state.activeModel.name.split("/").pop();
    }
    if (sessionLabel) {
      sessionLabel.textContent = state.sessionName || "Mobile Session";
    }
  }

  function updateStatusPill(text) {
    const pill = document.getElementById("engine-status");
    if (pill) pill.textContent = text;
  }

  function setComposerEnabled(enabled) {
    const sendBtn = document.getElementById("send-btn");
    const input = document.getElementById("user-input");
    if (sendBtn) sendBtn.disabled = !enabled;
    if (input) input.disabled = !enabled;
  }

  function clearThread() {
    const thread = document.getElementById("thread");
    if (thread) thread.innerHTML = "";
  }

  function scrollToBottom() {
    const thread = document.getElementById("thread");
    if (thread) {
      thread.scrollTop = thread.scrollHeight;
    }
  }

  function showToast(msg) {
    if (window.OmpNativeBridge && typeof window.OmpNativeBridge.showToast === "function") {
      window.OmpNativeBridge.showToast(msg);
    } else {
      console.log("[Toast]", msg);
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
})();
