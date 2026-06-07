import * as vscode from 'vscode';

/**
 * A minimal TreeView that acts as a drop target for VS Code Explorer files/folders.
 * Shows a single placeholder item. Drag files/folders from Explorer onto it
 * to add them as context in the chat webview.
 */
export class FileDropProvider
    implements vscode.TreeDataProvider<string>, vscode.TreeDragAndDropController<string>
{
    readonly dropMimeTypes = ['text/uri-list', 'application/vnd.code.tree.workbench.explorer.fileView'];
    readonly dragMimeTypes: string[] = [];

    private readonly _onDrop: (uris: vscode.Uri[]) => void;

    constructor(onDrop: (uris: vscode.Uri[]) => void) {
        this._onDrop = onDrop;
    }

    // ── TreeDataProvider ──────────────────────────────────────────────

    getTreeItem(_element: string): vscode.TreeItem {
        const item = new vscode.TreeItem('Drag Explorer files / folders here');
        item.iconPath = new vscode.ThemeIcon('arrow-down');
        item.tooltip = new vscode.MarkdownString(
            '**Drag & Drop from Explorer**\n\nDrag files or folders from the VS Code Explorer onto this item to add them as context in the AI chat.'
        );
        item.contextValue = 'dropTarget';
        return item;
    }

    getChildren(): string[] {
        return ['dropzone'];
    }

    // ── TreeDragAndDropController ─────────────────────────────────────

    async handleDrop(
        _target: string | undefined,
        sources: vscode.DataTransfer,
        _token: vscode.CancellationToken
    ): Promise<void> {
        const item = sources.get('text/uri-list');
        if (!item) { return; }

        const raw: string = typeof item.value === 'string' ? item.value : await item.asString();
        const uris = raw
            .trim()
            .split(/\r?\n/)
            .filter(l => l && !l.startsWith('#'))
            .flatMap(l => {
                try { return [vscode.Uri.parse(l, true)]; } catch { return []; }
            });

        if (uris.length > 0) {
            this._onDrop(uris);
            vscode.window.showInformationMessage(`Added ${uris.length} item(s) to AI chat context.`);
        }
    }

    handleDrag(): void { /* drag-out not supported */ }
}
