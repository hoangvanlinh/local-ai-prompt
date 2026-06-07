import * as vscode from 'vscode';
import { ChatViewProvider } from './webviewProvider';
import { ChatController } from './chatController';
import { FileDropProvider } from './fileDropProvider';

export function activate(context: vscode.ExtensionContext): void {
    const chatController = new ChatController(context.workspaceState);
    const provider = new ChatViewProvider(context.extensionUri, chatController);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            ChatViewProvider.viewType,
            provider,
            { webviewOptions: { retainContextWhenHidden: true } }
        )
    );

    // Compact drop-zone TreeView: accepts drag from VS Code Explorer
    const dropProvider = new FileDropProvider((uris) => provider.attachDroppedUris(uris));
    context.subscriptions.push(
        vscode.window.createTreeView('localAIPrompt.dropZone', {
            treeDataProvider: dropProvider,
            dragAndDropController: dropProvider,
        })
    );

    // Open chat panel
    context.subscriptions.push(
        vscode.commands.registerCommand('localAI.chat', () => {
            vscode.commands.executeCommand('workbench.view.extension.localAIPrompt');
        })
    );

    // Right-click in Explorer → Add to AI Chat Context
    context.subscriptions.push(
        vscode.commands.registerCommand('localAI.addToContext', async (...args: unknown[]) => {
            const selectedUris: vscode.Uri[] = [];
            const multi = args[1];
            if (Array.isArray(multi) && multi.length > 0) {
                for (const item of multi) {
                    if (item instanceof vscode.Uri) { selectedUris.push(item); }
                }
            }
            if (selectedUris.length === 0 && args[0] instanceof vscode.Uri) {
                selectedUris.push(args[0] as vscode.Uri);
            }
            if (selectedUris.length === 0) { return; }
            await vscode.commands.executeCommand('workbench.view.extension.localAIPrompt');
            provider.attachDroppedUris(selectedUris);
        })
    );
}

export function deactivate(): void {}
