# Local AI Prompt

A VS Code extension that replicates the **GitHub prompt Chat** experience but runs fully **offline** using a local [Ollama](https://ollama.com) LLM — no cloud APIs, no data leaving your machine.

---

## Features

| Feature | How to use |
|---|---|
| Open Chat panel | `Cmd+Shift+L` (mac) / `Ctrl+Shift+L` (win/linux) |
| Chat with AI | Select **💬 Chat** → type in input box |
| Explain selected code | Select code → choose **🔍 Explain code** → click ▶ |
| Refactor selected code | Select code → choose **🔧 Refactor code** → click ▶ |
| Fix errors in selected code | Select code → choose **⚡ Fix errors** → click ▶ |
| Generate code | Choose **✨ Generate code** → describe what you want |
| Switch AI model | Click the model badge in the header → pick from dropdown |
| Clear conversation | Click **⌫ Clear** in the panel header |

- **Streaming responses** — tokens appear as the model generates them
- **Markdown rendering** — code blocks with Copy button
- **Model dropdown** — shows installed models (green dot) vs available (grey dot)
- **Connection indicator** — green dot = Ollama reachable, red = offline
- **Action selector** — one dropdown to switch between Chat / Explain / Refactor / Fix / Generate

---

## Prerequisites

### 1. Install Ollama (official installer — NOT Homebrew)

```bash
# macOS / Linux
curl -fsSL https://ollama.com/install.sh | sh

# Windows — download from https://ollama.com/download
# macOS app — download .dmg from https://ollama.com/download
```

> ⚠️ Do **not** use `brew install ollama` — the Homebrew package is missing the `llama-server` binary.

### 2. Pull a model

```bash
# Lightweight & fast (recommended)
ollama pull gemma:2b

# Other options
ollama pull gemma2:2b
ollama pull llama3.2:3b
ollama pull qwen2.5:3b
ollama pull codellama:7b
ollama pull deepseek-r1:7b
```

### 3. Make sure Ollama is running

```bash
# If not already running:
ollama serve

# Check it's up:
curl http://localhost:11434/api/tags
```

> If you see `address already in use` — Ollama is already running, that's fine.

---

## Run Locally (Development)

```bash
# 1. Open this folder in VS Code
cd local-ai-prompt
code .

# 2. Install dependencies & compile
npm install
npm run compile

# 3. Press F5 → opens "Extension Development Host" window
```

The chat panel appears in the **Activity Bar** (✨ sparkle icon on the left sidebar).

---

## Configuration

Open **Settings** (`Cmd+,`) and search for `localAIPrompt`:

| Setting | Default | Description |
|---|---|---|
| `localAIPrompt.ollamaUrl` | `http://localhost:11434` | Ollama API base URL |
| `localAIPrompt.model` | `gemma:2b` | Model to use |
| `localAIPrompt.systemPrompt` | *(coding assistant prompt)* | System prompt |

You can also switch models directly from the **model dropdown** in the chat panel header.

---

## Project Structure

```
local-ai-prompt/
├── src/
│   ├── extension.ts        # Activation, command registration
│   ├── ollamaClient.ts     # Streaming Ollama API client (NDJSON)
│   ├── chatController.ts   # Message history state
│   └── webviewProvider.ts  # Webview lifecycle + message routing
├── media/
│   ├── webview.html        # Full chat UI (HTML + CSS + JS)
│   └── icon.svg            # Activity Bar icon
├── .vscode/
│   ├── launch.json         # F5 debug config
│   └── tasks.json          # Auto-build task
├── package.json
├── tsconfig.json
└── README.md
```

---

## Architecture

```
VS Code Extension Host
┌─────────────────────────────────────┐
│  extension.ts                       │  ← registers localAI.chat command
│  chatController.ts                  │  ← message history
│  ollamaClient.ts  ──────────────────┼──► POST /api/chat (streaming NDJSON)
│  webviewProvider.ts                 │  ← webview lifecycle + action routing
│        │  postMessage / onMessage   │
│        ▼                            │
│  media/webview.html                 │  ← prompt-like chat UI
│    ├─ Model dropdown                │
│    ├─ Action select (Chat/Explain…) │
│    └─ Streaming markdown renderer   │
└─────────────────────────────────────┘
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

Install the `.vsix`:
**Extensions view** → `...` menu → **Install from VSIX…**

---

## Troubleshooting

| Error | Fix |
|---|---|
| `llama-server binary not found` | Reinstall Ollama via official installer (not Homebrew) |
| `address already in use` | Ollama already running — no action needed |
| `model 'xxx' not found` | Run `ollama pull <model-name>` first |
| Red connection dot | Run `ollama serve` |

---

## License

MIT

