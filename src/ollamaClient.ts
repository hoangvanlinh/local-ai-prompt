import * as vscode from 'vscode';

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

interface OllamaStreamChunk {
    model: string;
    message?: {
        role: string;
        content: string;
    };
    done: boolean;
    error?: string;
}

export class OllamaClient {

    private getConfig(): { baseUrl: string; model: string; systemPrompt: string } {
        const cfg = vscode.workspace.getConfiguration('localAIPrompt');
        return {
            baseUrl: cfg.get<string>('ollamaUrl', 'http://localhost:11434'),
            model: cfg.get<string>('model', 'gemma3:2b'),
            systemPrompt: cfg.get<string>(
                'systemPrompt',
                'You are a helpful coding assistant. Provide clear, concise, and accurate responses. Format code with proper markdown code blocks with language labels.'
            ),
        };
    }

    async *streamChat(history: ChatMessage[]): AsyncGenerator<string, void, undefined> {
        const { baseUrl, model, systemPrompt } = this.getConfig();

        const messages: ChatMessage[] = [
            { role: 'system', content: systemPrompt },
            ...history,
        ];

        const response = await fetch(`${baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, messages, stream: true }),
        });

        if (!response.ok) {
            const body = await response.text().catch(() => '');
            throw new Error(`Ollama API error ${response.status}: ${body || response.statusText}`);
        }

        if (!response.body) {
            throw new Error('Ollama returned no response body.');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) { break; }

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) { continue; }
                    try {
                        const chunk = JSON.parse(trimmed) as OllamaStreamChunk;
                        if (chunk.error) {
                            throw new Error(`Ollama error: ${chunk.error}`);
                        }
                        if (chunk.message?.content) {
                            yield chunk.message.content;
                        }
                        if (chunk.done) { return; }
                    } catch (parseErr) {
                        // Skip malformed JSON lines (partial chunks)
                        if (parseErr instanceof Error && parseErr.message.startsWith('Ollama error')) {
                            throw parseErr;
                        }
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }
    }

    async checkConnection(): Promise<boolean> {
        const { baseUrl } = this.getConfig();
        try {
            const response = await fetch(`${baseUrl}/api/tags`, {
                signal: AbortSignal.timeout(3000),
            });
            return response.ok;
        } catch {
            return false;
        }
    }

    /** Collects all stream tokens and returns the full response string. */
    async fullChat(messages: ChatMessage[]): Promise<string> {
        let result = '';
        for await (const token of this.streamChat(messages)) {
            result += token;
        }
        return result;
    }

    async listModels(): Promise<string[]> {
        const { baseUrl } = this.getConfig();
        try {
            const response = await fetch(`${baseUrl}/api/tags`);
            if (!response.ok) { return []; }
            const data = (await response.json()) as { models?: Array<{ name: string }> };
            return (data.models ?? []).map(m => m.name);
        } catch {
            return [];
        }
    }

    async *pullModel(modelName: string): AsyncGenerator<{ status: string; completed?: number; total?: number }, void, undefined> {
        const { baseUrl } = this.getConfig();
        const response = await fetch(`${baseUrl}/api/pull`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: modelName, stream: true }),
        });

        if (!response.ok || !response.body) {
            throw new Error(`Ollama pull error ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) { break; }
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) { continue; }
                    try {
                        const chunk = JSON.parse(trimmed) as { status: string; completed?: number; total?: number };
                        yield chunk;
                        if (chunk.status === 'success') { return; }
                    } catch { /* skip malformed */ }
                }
            }
        } finally {
            reader.releaseLock();
        }
    }
}
