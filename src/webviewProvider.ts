import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { OllamaClient } from './ollamaClient';
import { ChatController } from './chatController';

type WebviewMessage =
    | { type: 'sendMessage'; text: string; context?: string }
    | { type: 'executeAction'; action: string; extra?: string }
    | { type: 'updateModel'; model: string }
    | { type: 'pullModel'; model: string }
    | { type: 'attachFile' }
    | { type: 'clearChat' }
    | { type: 'newConversation' }
    | { type: 'switchConversation'; id: string }
    | { type: 'deleteConversation'; id: string }
    | { type: 'checkConnection' }
    | { type: 'applyToFile'; code: string; action: string }
    | { type: 'createFile'; code: string; lang?: string; filename?: string }    | { type: 'agentStart'; task: string; dryRun?: boolean; context?: string }
    | { type: 'agentRun'; tasks: Array<{ type: string; filename: string; description: string }> }
    | { type: 'attachUris'; uris: string[] }
    | { type: 'ready' };

export class ChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'localAIPrompt.chatView';

    private _view?: vscode.WebviewView;
    private readonly ollamaClient: OllamaClient;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly chatController: ChatController
    ) {
        this.ollamaClient = new OllamaClient();
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri],
        };

        webviewView.webview.html = this.buildHtml(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (data: WebviewMessage) => {
            switch (data.type) {
                case 'sendMessage':
                    await this.handleUserMessage(data.text, data.context);
                    break;
                case 'clearChat':
                    this.chatController.clearHistory();
                    this.postConversations();
                    this.postCurrentSelection();
                    break;
                case 'newConversation':
                    this.chatController.createConversation();
                    this.postConversations();
                    this.postCurrentSelection();
                    break;
                case 'switchConversation':
                    this.chatController.switchConversation(data.id);
                    this.postConversations();
                    this._view?.webview.postMessage({
                        type: 'restoreHistory',
                        messages: this.chatController.getHistory(),
                    });
                    this.postCurrentSelection();
                    break;
                case 'deleteConversation':
                    this.chatController.deleteConversation(data.id);
                    this.postConversations();
                    this._view?.webview.postMessage({
                        type: 'restoreHistory',
                        messages: this.chatController.getHistory(),
                    });
                    this.postCurrentSelection();
                    break;
                case 'attachFile':
                    await this.handleAttachFile();
                    break;
                case 'updateModel':
                    await vscode.workspace.getConfiguration('localAIPrompt').update('model', data.model, vscode.ConfigurationTarget.Global);
                    break;
                case 'executeAction':
                    await this.handleAction(data.action, data.extra);
                    break;
                case 'pullModel':
                    this.handlePullModel(data.model);
                    break; // async — intentionally not awaited here
                case 'applyToFile':
                    await this.handleApplyToFile(data.code, data.action);
                    break;
                case 'createFile':
                    await this.handleCreateFile(data.code, data.lang, data.filename);
                    break;
                case 'agentStart':
                    this.handleAgentStart(data.task, data.dryRun ?? false, data.context ?? '');
                    break; // async — intentionally not awaited
                case 'agentRun':
                    this.handleAgentExecute(data.tasks);
                    break; // async — intentionally not awaited
                case 'attachUris':
                    this.handleAttachUris(data.uris);
                    break; // async — intentionally not awaited
                case 'checkConnection':
                    await this.postConnectionStatus();
                    break;
                case 'ready':
                    await this.postConnectionStatus();
                    this.postCurrentModel();
                    this.postChatHistory();
                    this.postCurrentSelection();
                    break;
            }
        });
        // Auto-update context when the active editor changes
        const editorWatcher = vscode.window.onDidChangeActiveTextEditor(() => {
            this.postCurrentSelection();
        });
        const selectionWatcher = vscode.window.onDidChangeTextEditorSelection(() => {
            this.postCurrentSelection();
        });
        webviewView.onDidDispose(() => {
            editorWatcher.dispose();
            selectionWatcher.dispose();
        });
    }

    /** Push the currently open file as auto-context to the webview. */
    private postCurrentFileContext(): void {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.isUntitled || !this._view) { return; }
        const content = editor.document.getText();
        const name    = path.basename(editor.document.fileName);
        const lang    = editor.document.languageId;
        this._view.webview.postMessage({ type: 'autoContext', name, lang, content });
    }

    /**
     * Push selected text from the active editor to the webview.
     * If nothing is selected, clears the auto-selection context.
     */
    private postCurrentSelection(): void {
        if (!this._view) { return; }
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.isUntitled) {
            this._view.webview.postMessage({ type: 'autoContext', clear: true });
            return;
        }
        const selection = editor.selection;
        const selected  = editor.document.getText(selection).trim();
        const fileName  = path.basename(editor.document.fileName);
        const lang      = editor.document.languageId;
        if (selected) {
            // Has selection → use selection as context
            this._view.webview.postMessage({
                type: 'selectionContext',
                name: `selection (${fileName})`,
                lang,
                content: selected,
            });
            // Also clear the file auto-context (selection takes priority)
            this._view.webview.postMessage({ type: 'autoContext', clear: true });
        } else {
            // No selection → use the whole file as auto context
            this._view.webview.postMessage({ type: 'selectionContext', clear: true });
            const content = editor.document.getText();
            this._view.webview.postMessage({ type: 'autoContext', name: fileName, lang, content });
        }
    }

    /** Restore saved chat history into the webview after reload. */
    private postChatHistory(): void {
        if (!this._view) { return; }
        const history = this.chatController.getHistory();
        if (history.length > 0) {
            this._view.webview.postMessage({ type: 'restoreHistory', messages: history });
        }
        this.postConversations();
    }

    /** Send conversation list + active ID to webview. */
    private postConversations(): void {
        if (!this._view) { return; }
        this._view.webview.postMessage({
            type: 'conversationList',
            conversations: this.chatController.getConversations(),
            activeId: this.chatController.getActiveId(),
        });
    }

    /** Pulls a model via the Ollama API, streams progress to the webview, then refreshes the model list. */
    private async handlePullModel(model: string): Promise<void> {
        if (!this._view) { return; }
        const view = this._view;
        view.webview.postMessage({ type: 'pullStart', model });
        try {
            for await (const progress of this.ollamaClient.pullModel(model)) {
                view.webview.postMessage({ type: 'pullProgress', model, status: progress.status, completed: progress.completed, total: progress.total });
            }
            view.webview.postMessage({ type: 'pullDone', model });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            view.webview.postMessage({ type: 'pullError', model, message: msg });
            return;
        }
        // Refresh model list so the newly installed model appears
        await this.postConnectionStatus();
    }

    /** Called from extension.ts for right-click commands that auto-send. */
    public sendMessage(text: string): void {
        this._view?.webview.postMessage({ type: 'autoSend', text });
    }

    /** Called from extension.ts for the "Generate" command that fills the input. */
    public setInput(text: string): void {
        this._view?.webview.postMessage({ type: 'setInput', text });
    }

    /** Called from FileDropProvider when files/folders are dragged from VS Code Explorer. */
    public attachDroppedUris(uris: vscode.Uri[]): void {
        this.handleAttachUris(uris.map(u => u.toString()));
    }

    private ollamaServeTerminal?: vscode.Terminal;

    private async postConnectionStatus(): Promise<void> {
        let connected = await this.ollamaClient.checkConnection();

        if (!connected) {
            await this.autoStartOllama();
            // Wait up to 8 seconds for ollama serve to be ready
            for (let i = 0; i < 8; i++) {
                await new Promise(r => setTimeout(r, 1000));
                connected = await this.ollamaClient.checkConnection();
                if (connected) { break; }
            }
        }

        const models = connected ? await this.ollamaClient.listModels() : [];
        const activeModel = vscode.workspace.getConfiguration('localAIPrompt').get<string>('model', 'gemma:2b');
        this._view?.webview.postMessage({ type: 'connectionStatus', connected, models, activeModel });
    }

    private async autoStartOllama(): Promise<void> {
        // Reuse existing terminal if still alive
        if (this.ollamaServeTerminal) {
            const terminals = vscode.window.terminals;
            if (terminals.includes(this.ollamaServeTerminal)) {
                return; // already started
            }
        }
        this.ollamaServeTerminal = vscode.window.createTerminal({ name: 'Ollama' });
        this.ollamaServeTerminal.sendText('ollama serve');
        // Keep terminal visible so the user can see logs, but don't steal focus
        this.ollamaServeTerminal.show(true);
    }

    private postCurrentModel(): void {
        const model = vscode.workspace.getConfiguration('localAIPrompt').get<string>('model', 'gemma3:2b');
        this._view?.webview.postMessage({ type: 'modelUpdate', model });
    }

    private async handleUserMessage(text: string, context?: string): Promise<void> {
        if (!this._view) { return; }
        const view = this._view;

        // Store clean text in history (no file context injected)
        this.chatController.addMessage('user', text);
        view.webview.postMessage({ type: 'startAssistantMessage' });

        // Build the actual prompt sent to AI: inject file/selection context only for this turn
        const history = this.chatController.getHistory();
        const messages = context?.trim()
            ? [
                ...history.slice(0, -1), // all but last (the one we just added)
                { role: 'user' as const, content: `${text}\n\n${context.trim()}` },
              ]
            : history;

        try {
            let fullResponse = '';
            for await (const token of this.ollamaClient.streamChat(messages)) {
                fullResponse += token;
                view.webview.postMessage({ type: 'streamToken', token });
            }
            this.chatController.addMessage('assistant', fullResponse);
            view.webview.postMessage({ type: 'endAssistantMessage' });
            this.postConversations(); // update title in sidebar after first message
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            view.webview.postMessage({ type: 'error', message: msg });
        }
    }

    private async handleAttachFile(): Promise<void> {
        if (!this._view) { return; }

        const items = [
            { label: '$(file-code)  Current file', description: 'Attach the full content of the active editor file', value: 'current-file' },
            { label: '$(selection)  Current selection', description: 'Attach only the selected text', value: 'selection' },
            { label: '$(file-directory)  Choose folder…', description: 'Attach all code files in a folder (recursive)', value: 'folder' },
            { label: '$(folder-opened)  Choose file(s)…', description: 'Browse and pick individual files', value: 'browse' },
        ];

        const picked = await vscode.window.showQuickPick(items, {
            placeHolder: 'Choose what to attach as context',
        });
        if (!picked) { return; }

        const editor = vscode.window.activeTextEditor;

        if (picked.value === 'current-file') {
            if (!editor) {
                vscode.window.showWarningMessage('No file is currently open.');
                return;
            }
            const content = editor.document.getText();
            const name = path.basename(editor.document.fileName);
            const lang = editor.document.languageId;
            this._view.webview.postMessage({ type: 'fileContext', name, lang, content });

        } else if (picked.value === 'selection') {
            if (!editor) { return; }
            const content = editor.document.getText(editor.selection).trim();
            if (!content) {
                vscode.window.showWarningMessage('No text selected.');
                return;
            }
            const name = `selection (${path.basename(editor.document.fileName)})`;
            const lang = editor.document.languageId;
            this._view.webview.postMessage({ type: 'fileContext', name, lang, content });

        } else if (picked.value === 'folder') {
            const uris = await vscode.window.showOpenDialog({
                canSelectMany: false,
                canSelectFiles: false,
                canSelectFolders: true,
                openLabel: 'Attach folder',
            });
            if (!uris || uris.length === 0) { return; }
            const folderUri = uris[0];
            const folderName = path.basename(folderUri.fsPath);
            let count = 0;
            await readFolderRecursive(folderUri, folderName, (name, lang, content) => {
                this._view!.webview.postMessage({ type: 'fileContext', name, lang, content });
                count++;
            });
            if (count === 0) {
                vscode.window.showWarningMessage(`No readable code files found in ${folderName}.`);
            } else {
                vscode.window.showInformationMessage(`Attached ${count} file(s) from ${folderName}.`);
            }

        } else if (picked.value === 'browse') {
            const uris = await vscode.window.showOpenDialog({
                canSelectMany: true,
                canSelectFiles: true,
                canSelectFolders: false,
                openLabel: 'Attach',
                filters: {
                    'Code & Text': ['ts', 'js', 'py', 'dart', 'go', 'rs', 'java', 'swift', 'kt', 'c', 'cpp', 'h', 'cs', 'html', 'css', 'json', 'yaml', 'yml', 'md', 'txt', 'sh'],
                    'All files': ['*'],
                },
            });
            if (!uris || uris.length === 0) { return; }
            for (const uri of uris) {
                try {
                    const bytes = await vscode.workspace.fs.readFile(uri);
                    const content = Buffer.from(bytes).toString('utf-8');
                    const name = path.basename(uri.fsPath);
                    const lang = name.includes('.') ? name.split('.').pop()! : 'text';
                    this._view.webview.postMessage({ type: 'fileContext', name, lang, content });
                } catch {
                    vscode.window.showWarningMessage(`Could not read: ${uri.fsPath}`);
                }
            }
        }
    }

    private async handleAction(action: string, extra?: string): Promise<void> {
        if (!this._view) { return; }

        const editor = vscode.window.activeTextEditor;
        const selectedText = editor?.document.getText(editor.selection)?.trim();
        const lang = editor?.document.languageId ?? 'code';

        if (!selectedText && action !== 'generate') {
            this._view.webview.postMessage({
                type: 'error',
                message: `No code selected. Select code in the editor first, then click "${action}".`,
            });
            return;
        }

        const extraNote = extra ? `\n\nAdditional instructions: ${extra}` : '';
        const prompts: Record<string, string> = {
            explain:  `Explain the following ${lang} code in detail:\n\`\`\`${lang}\n${selectedText}\n\`\`\`${extraNote}`,
            refactor: `Refactor the following ${lang} code to be cleaner, more efficient, and follow best practices:\n\`\`\`${lang}\n${selectedText}\n\`\`\`${extraNote}`,
            fix:      `Fix any bugs or errors in the following ${lang} code and explain what was wrong:\n\`\`\`${lang}\n${selectedText}\n\`\`\`${extraNote}`,
            generate: extra
                ? `Generate complete, working ${lang} code for the following task. Output ONLY a single fenced code block with the correct language tag. No explanations, no steps.\n\nTask: ${extra}\n\nReference:\n\`\`\`${lang}\n${selectedText}\n\`\`\``
                : `Generate complete, working ${lang} code based on the reference. Output ONLY a single fenced code block with the correct language tag. No explanations, no steps.\n\nReference:\n\`\`\`${lang}\n${selectedText}\n\`\`\``,
        };

        const prompt = prompts[action];
        if (prompt) {
            this._view.webview.postMessage({ type: 'autoSend', text: prompt });
        }
    }

    private async handleAgentStart(task: string, dryRun = false, context = ''): Promise<void> {
        if (!this._view) { return; }
        const view = this._view;

        view.webview.postMessage({ type: 'agentPlanning' });

        const chatHistory = this.chatController.getHistory();
        const contextSection = context.trim()
            ? `\n\nAttached context:\n${context}`
            : '';

        // ── Step 1: Classify — does this request need files? ───────────
        // Use a simple yes/no question that even small models can answer reliably.
        const classifyPrompt = [
            'Answer with ONLY "YES" or "NO". No other text.',
            '',
            `Does this request require creating or modifying files on disk?`,
            `Request: "${task}"`,
            '',
            'Answer YES only if the user explicitly wants to build/create/generate/write/scaffold files.',
            'Answer NO for questions, explanations, analysis, reviews, debugging help, or anything that can be answered with text.',
        ].join('\n');

        let classifyRaw = '';
        try {
            classifyRaw = await this.ollamaClient.fullChat([
                ...chatHistory,
                { role: 'user', content: classifyPrompt },
            ]);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            view.webview.postMessage({ type: 'agentError', message: msg });
            return;
        }

        const needsFiles = /\byes\b/i.test(classifyRaw.trim().slice(0, 20));

        if (!needsFiles) {
            // No files needed — answer as regular chat
            view.webview.postMessage({ type: 'agentFallbackToChat', text: '' });
            const chatPrompt = context.trim() ? `${task}\n\nContext:\n${context}` : task;
            view.webview.postMessage({ type: 'startAssistantMessage' });
            try {
                let fullResponse = '';
                for await (const token of this.ollamaClient.streamChat([
                    ...chatHistory,
                    { role: 'user', content: chatPrompt },
                ])) {
                    fullResponse += token;
                    view.webview.postMessage({ type: 'streamToken', token });
                }
                this.chatController.addMessage('user', chatPrompt);
                this.chatController.addMessage('assistant', fullResponse);
                view.webview.postMessage({ type: 'endAssistantMessage' });
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                view.webview.postMessage({ type: 'error', message: msg });
            }
            return;
        }

        // ── Step 2: Plan — what files to create ────────────────────────
        const planPrompt = [
            `List the files needed for this request. Output ONLY a JSON array.`,
            '',
            `Request: ${task}${contextSection}`,
            '',
            '- Each item: {"type":"create","filename":"relative/path.ext","description":"what this file does","reason":"why it is needed"}',
            '- 2 to 6 files. Relative paths only.',
            '- Output ONLY the JSON array, no other text.',
        ].join('\n');

        let planRaw = '';
        try {
            planRaw = await this.ollamaClient.fullChat([
                ...chatHistory,
                { role: 'user', content: planPrompt },
            ]);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            view.webview.postMessage({ type: 'agentError', message: msg });
            return;
        }

        const tasks = extractJsonArray(planRaw);
        if (!tasks || tasks.length === 0) {
            view.webview.postMessage({ type: 'agentError', message: `Could not parse file plan. Raw response:\n${planRaw}` });
            return;
        }

        view.webview.postMessage({ type: 'agentPlan', tasks, dryRun });

        // Always wait for user confirmation — never auto-create files
        view.webview.postMessage({ type: 'agentDryRunReady', count: tasks.length, isAgent: !dryRun });
    }

    /** Called when user clicks "▶ Run" after reviewing a Plan. */
    private async handleAgentExecute(tasks: Array<{ type: string; filename: string; description: string }>): Promise<void> {
        if (!this._view) { return; }
        const view = this._view;
        const folders = vscode.workspace.workspaceFolders;
        const chatHistory = this.chatController.getHistory();

        for (let i = 0; i < tasks.length; i++) {
            const t = tasks[i];
            view.webview.postMessage({ type: 'agentTaskStart', index: i });

            const codePrompt = `Implement the following task for file \`${t.filename}\`:\n${t.description}\n\nOutput ONLY the complete file content in a single fenced code block (with correct language tag). No explanations, no steps, nothing else.`;

            let codeRaw = '';
            try {
                codeRaw = await this.ollamaClient.fullChat([
                    ...chatHistory,
                    { role: 'user', content: codePrompt },
                ]);
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                view.webview.postMessage({ type: 'agentTaskError', index: i, message: msg });
                continue;
            }

            const fenceMatch = codeRaw.match(/```[\w+-]*\r?\n([\s\S]*?)\r?\n```/) ||
                               codeRaw.match(/```[\w+-]*\r?\n([\s\S]*?)```/);
            const code = fenceMatch ? fenceMatch[1] : codeRaw.trim();

            try {
                let fileUri: vscode.Uri;
                if (folders && folders.length > 0) {
                    fileUri = vscode.Uri.joinPath(folders[0].uri, t.filename);
                } else {
                    const picked = await vscode.window.showSaveDialog({
                        defaultUri: vscode.Uri.file(path.join(os.homedir(), t.filename)),
                        saveLabel: `Create ${t.filename}`,
                    });
                    if (!picked) {
                        view.webview.postMessage({ type: 'agentTaskError', index: i, message: 'Skipped' });
                        continue;
                    }
                    fileUri = picked;
                }
                await vscode.workspace.fs.writeFile(fileUri, Buffer.from(code, 'utf8'));
                view.webview.postMessage({ type: 'agentTaskDone', index: i, filename: t.filename });
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                view.webview.postMessage({ type: 'agentTaskError', index: i, message: msg });
            }
        }

        view.webview.postMessage({ type: 'agentDone', count: tasks.length });
    }

    private async handleAttachUris(uris: string[]): Promise<void> {
        if (!this._view) { return; }
        const files: Array<{ name: string; lang: string; content: string }> = [];

        for (const raw of uris) {
            let uri: vscode.Uri;
            try { uri = vscode.Uri.parse(raw, true); } catch { continue; }

            // Normalise vscode-resource:// → file://
            if (uri.scheme === 'vscode-resource') {
                uri = uri.with({ scheme: 'file' });
            }

            let stat: vscode.FileStat;
            try { stat = await vscode.workspace.fs.stat(uri); } catch { continue; }

            if (stat.type === vscode.FileType.Directory) {
                await readFolderRecursive(uri, path.basename(uri.fsPath), (name, lang, content) => {
                    files.push({ name, lang, content });
                });
            } else if (stat.type === vscode.FileType.File) {
                try {
                    const bytes = await vscode.workspace.fs.readFile(uri);
                    const content = Buffer.from(bytes).toString('utf-8');
                    const name = path.basename(uri.fsPath);
                    const lang = name.includes('.') ? name.split('.').pop()! : 'text';
                    files.push({ name, lang, content });
                } catch { /* skip unreadable files */ }
            }
        }

        if (files.length === 0) {
            this._view.webview.postMessage({ type: 'attachError', message: 'Could not read the dropped item(s). Try using the 📎 attach button instead.' });
            return;
        }
        this._view.webview.postMessage({ type: 'attachedFiles', files });
    }

    private async handleApplyToFile(code: string, action: string): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor — open the file you want to apply the fix to.');
            return;
        }
        const edit = new vscode.WorkspaceEdit();
        const selection = editor.selection;
        const range = selection.isEmpty
            ? new vscode.Range(
                editor.document.positionAt(0),
                editor.document.positionAt(editor.document.getText().length)
              )
            : selection;
        edit.replace(editor.document.uri, range, code);
        await vscode.workspace.applyEdit(edit);
        const label = action === 'fix' ? 'Fix' : 'Refactor';
        vscode.window.showInformationMessage(`${label} applied to ${path.basename(editor.document.fileName)}.`);
    }

    private async handleCreateFile(code: string, lang?: string, filename?: string | null): Promise<void> {
        try {
            const folders = vscode.workspace.workspaceFolders;
            const ext = langToExt(lang ?? '');
            const fileName = filename ?? inferFileName(code, ext);

            let fileUri: vscode.Uri;
            if (folders && folders.length > 0) {
                fileUri = vscode.Uri.joinPath(folders[0].uri, fileName);
            } else {
                // No workspace open — show Save dialog
                const picked = await vscode.window.showSaveDialog({
                    defaultUri: vscode.Uri.file(path.join(os.homedir(), fileName)),
                    saveLabel: 'Create file',
                    filters: { 'All files': ['*'] },
                });
                if (!picked) { return; }
                fileUri = picked;
            }

            await vscode.workspace.fs.writeFile(fileUri, Buffer.from(code, 'utf8'));
            await vscode.window.showTextDocument(fileUri);
            vscode.window.showInformationMessage(`Created ${path.basename(fileUri.fsPath)}`);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this._view?.webview.postMessage({ type: 'createFileError', message: msg });
        }
    }

    private buildHtml(webview: vscode.Webview): string {
        const nonce = getNonce();
        const htmlPath = path.join(this.extensionUri.fsPath, 'media', 'webview.html');
        let html = fs.readFileSync(htmlPath, 'utf8');
        html = html
            .replace(/{{NONCE}}/g, nonce)
            .replace(/{{CSP_SOURCE}}/g, webview.cspSource);
        return html;
    }
}

function getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';
    for (let i = 0; i < 32; i++) {
        nonce += chars[Math.floor(Math.random() * chars.length)];
    }
    return nonce;
}

function langToExt(lang: string): string {
    const map: Record<string, string> = {
        typescript: 'ts', ts: 'ts',
        javascript: 'js', js: 'js',
        python: 'py', py: 'py',
        rust: 'rs', go: 'go',
        java: 'java', kotlin: 'kt',
        swift: 'swift', dart: 'dart',
        cpp: 'cpp', c: 'c', cs: 'cs',
        html: 'html', css: 'css',
        json: 'json', yaml: 'yaml', yml: 'yml',
        sh: 'sh', bash: 'sh',
        ruby: 'rb', php: 'php',
    };
    return map[lang.toLowerCase().trim()] ?? 'txt';
}

function inferFileName(code: string, ext: string): string {
    const patterns = [
        /^export\s+(?:default\s+)?(?:class|function\*?|const|let)\s+([A-Za-z_]\w*)/m,
        /^class\s+([A-Za-z_]\w*)/m,
        /^(?:async\s+)?function\*?\s+([A-Za-z_]\w*)/m,
        /^def\s+([a-z_]\w*)/m,
        /^func\s+([A-Za-z_]\w*)/m,
        /^pub\s+(?:async\s+)?fn\s+([a-z_]\w*)/m,
    ];
    for (const re of patterns) {
        const m = code.match(re);
        if (m) {
            // Convert CamelCase to kebab-case for the filename
            const kebab = m[1]
                .replace(/([A-Z])/g, (c, i) => (i > 0 ? '-' : '') + c.toLowerCase())
                .replace(/^-/, '');
            return `${kebab}.${ext}`;
        }
    }
    const now = new Date();
    const stamp = `${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}${now.getSeconds().toString().padStart(2, '0')}`;
    return `generated-${stamp}.${ext}`;
}

const CODE_EXTENSIONS = new Set([
    'ts','tsx','js','jsx','mjs','cjs','py','go','rs','java','kt','swift','dart',
    'c','cpp','h','hpp','cs','rb','php','html','css','scss','less','json','yaml',
    'yml','toml','md','txt','sh','bash','zsh','sql','graphql','proto','env',
]);
const SKIP_DIRS = new Set(['node_modules','.git','dist','out','build','__pycache__','.next','.nuxt','coverage']);

async function readFolderRecursive(
    folderUri: vscode.Uri,
    prefix: string,
    emit: (name: string, lang: string, content: string) => void
): Promise<void> {
    let entries: [string, vscode.FileType][];
    try {
        entries = await vscode.workspace.fs.readDirectory(folderUri);
    } catch { return; }

    for (const [name, type] of entries) {
        if (type === vscode.FileType.Directory) {
            if (SKIP_DIRS.has(name)) { continue; }
            await readFolderRecursive(vscode.Uri.joinPath(folderUri, name), `${prefix}/${name}`, emit);
        } else if (type === vscode.FileType.File) {
            const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
            if (!CODE_EXTENSIONS.has(ext)) { continue; }
            try {
                const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folderUri, name));
                const content = Buffer.from(bytes).toString('utf-8');
                emit(`${prefix}/${name}`, ext, content);
            } catch { /* skip unreadable files */ }
        }
    }
}

/** Extract the first valid JSON array from anywhere in a string (handles prose around it). */
function extractJsonArray(raw: string): Array<{ type: string; filename: string; description: string }> | null {
    // 1. Try parsing the whole trimmed string
    const trimmed = raw.trim();
    try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) { return parsed; }
    } catch { /* fall through */ }

    // 2. Find the first '[' and last ']' and try that slice
    const start = raw.indexOf('[');
    const end   = raw.lastIndexOf(']');
    if (start !== -1 && end > start) {
        try {
            const parsed = JSON.parse(raw.slice(start, end + 1));
            if (Array.isArray(parsed)) { return parsed; }
        } catch { /* fall through */ }
    }

    // 3. Strip markdown code fences then retry
    const stripped = raw.replace(/^```[\w]*\n?/gm, '').replace(/```\s*$/gm, '').trim();
    try {
        const parsed = JSON.parse(stripped);
        if (Array.isArray(parsed)) { return parsed; }
    } catch { /* fall through */ }

    return null;
}
