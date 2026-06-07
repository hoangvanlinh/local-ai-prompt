# Local AI Prompt

A VS Code extension that replicates the **GitHub Copilot Chat** experience but runs fully **offline** using a local [Ollama](https://ollama.com) LLM — no cloud APIs, no data leaving your machine.

---

## Features

### 💬 Chat
- **Ask mode** — chat with AI about your code; automatically uses the active file as context (or selected text if highlighted)
- **Streaming responses** — tokens appear as the model generates them
- **Markdown rendering** — formatted output with code blocks and Copy button
- **Chat history** — conversations are saved per workspace; use the 🕐 button to browse, switch, or delete past chats
- **New Chat** — start a fresh conversation without losing history

### 📎 Context Attach
- **Auto-context** — active file is automatically attached when no text is selected
- **Selection context** — highlight code in the editor → it auto-appears as context chip
- **📎 button** — attach current file, current selection, a folder (recursive), or browse individual files
- **Drag & drop** — drag files from **macOS Finder** directly onto the chat input
- **Drop zone** — drag files/folders from **VS Code Explorer** onto the "Drop Files Here" panel
- **Right-click** — right-click any file/folder in Explorer → **Add to AI Chat Context**

### 📝 Plan mode
- Describe what you want to build → AI **analyzes whether files are needed first** (YES/NO classification)
- If files are needed: shows a plan with file names, descriptions, and **reasons why each file is needed**
- You review and confirm before anything is created
- If no files needed: AI answers as a normal chat message

### 🤖 Agent mode
- Same smart 2-step flow as Plan, but designed for building features
- Shows plan with reasons → **▶ Create all files** or **✕ Cancel**
- Files are only created after your explicit confirmation

### 🔧 Model management
- Model dropdown in header — shows installed models (green dot) vs popular available models
- One-click **ollama pull** for any model directly from the dropdown with live progress bar
- Connection indicator — green = Ollama reachable, red = offline

---

## Keyboard Shortcuts

| Action | macOS | Windows/Linux |
|---|---|---|
| Open Chat panel | `Cmd+Shift+L` | `Ctrl+Shift+L` |
| Send message | `Enter` | `Enter` |
| New line in input | `Shift+Enter` | `Shift+Enter` |

---

## Prerequisites

### 1. Install Ollama (official installer — NOT Homebrew)

```bash
# macOS / Linux
curl -fsSL https://ollama.com/install.sh | sh

# Windows / macOS app — download from https://ollama.com/download
```

> ⚠️ Do **not** use `brew install ollama` — the Homebrew package is missing the `llama-server` binary.

### 2. Pull a model

```bash
# Lightweight & fast (recommended for low-resource machines)
ollama pull gemma:2b
ollama pull gemma2:2b
ollama pull llama3.2:3b

# Coding-focused
ollama pull codellama:7b
ollama pull qwen2.5-coder:7b
ollama pull deepseek-coder:6.7b

# Balanced quality/speed
ollama pull mistral:7b
ollama pull llama3.1:8b
ollama pull qwen2.5:7b
```

### 3. Make sure Ollama is running

```bash
ollama serve
# If you see "address already in use" — Ollama is already running, that's fine.
```

---

## Run Locally (Development)

```bash
cd local-ai-prompt
npm install
npm run compile
# Press F5 in VS Code → opens Extension Development Host
```

The chat panel appears in the **Activity Bar** on the left sidebar.

---

## Configuration

Open **Settings** (`Cmd+,`) and search for `localAIPrompt`:

| Setting | Default | Description |
|---|---|---|
| `localAIPrompt.ollamaUrl` | `http://localhost:11434` | Ollama API base URL |
| `localAIPrompt.model` | `gemma:2b` | Default model |
| `localAIPrompt.systemPrompt` | *(coding assistant)* | System prompt sent to the model |

---

## Project Structure

```
local-ai-prompt/
├── src/
│   ├── extension.ts        # Activation, command registration
│   ├── ollamaClient.ts     # Streaming Ollama API client (NDJSON)
│   ├── chatController.ts   # Multi-conversation history (persisted per workspace)
│   ├── webviewProvider.ts  # Webview lifecycle, message routing, context handling
│   └── fileDropProvider.ts # TreeView drop target for VS Code Explorer drag
├── media/
│   ├── webview.html        # Full chat UI (HTML + CSS + vanilla JS)
│   └── icon.svg            # Activity Bar icon
├── package.json
├── tsconfig.json
└── README.md
```

---

## Architecture

```
VS Code Extension Host
┌──────────────────────────────────────────┐
│  extension.ts                            │  ← commands, Explorer right-click
│  chatController.ts                       │  ← multi-conversation history (workspaceState)
│  ollamaClient.ts  ───────────────────────┼──► POST /api/chat (streaming NDJSON)
│  webviewProvider.ts                      │  ← context detection, file attach, agent logic
│  fileDropProvider.ts                     │  ← TreeView DnD from Explorer
│        │  postMessage / onMessage        │
│        ▼                                 │
│  media/webview.html                      │  ← Copilot-like chat UI
│    ├─ History sidebar                    │
│    ├─ Context chips (file/selection)     │
│    ├─ Model dropdown + pull progress     │
│    ├─ Ask / Plan / Agent modes           │
│    └─ Streaming markdown renderer        │
└──────────────────────────────────────────┘
                  │
      http://localhost:11434
                  │
           Ollama (local LLM)
```

---

## Package as VSIX

```bash
npm install -g @vscode/vsce
vsce package
# Produces: local-ai-prompt-0.1.0.vsix
```

Install: **Extensions view** → `...` → **Install from VSIX…**

---

## Troubleshooting

| Error | Fix |
|---|---|
| `llama-server binary not found` | Reinstall Ollama via official installer (not Homebrew) |
| `address already in use` | Ollama already running — no action needed |
| `model 'xxx' not found` | Run `ollama pull <model-name>` first |
| Red connection dot | Run `ollama serve` |
| Agent always creates files | Use a larger model (7B+); small models may not classify intent accurately |

---

## License

MIT


