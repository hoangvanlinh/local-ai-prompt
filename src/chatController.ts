import * as vscode from 'vscode';
import { ChatMessage } from './ollamaClient';

const CONV_KEY   = 'localAI.conversations';
const ACTIVE_KEY = 'localAI.activeConversationId';
const MAX_MESSAGES_PER_CONV = 200;
const MAX_CONVERSATIONS = 50;

export interface Conversation {
    id: string;
    title: string;
    createdAt: number;
    messages: ChatMessage[];
}

export class ChatController {
    private conversations: Conversation[] = [];
    private activeId: string = '';
    private readonly storage: vscode.Memento;

    constructor(storage: vscode.Memento) {
        this.storage = storage;
        this.conversations = storage.get<Conversation[]>(CONV_KEY, []);
        this.activeId      = storage.get<string>(ACTIVE_KEY, '');

        // If no conversations exist yet, create first one
        if (this.conversations.length === 0) {
            this.createConversation();
        } else if (!this.conversations.find(c => c.id === this.activeId)) {
            this.activeId = this.conversations[this.conversations.length - 1].id;
        }
    }

    // ── Active conversation helpers ───────────────────────────────

    private get active(): Conversation {
        return this.conversations.find(c => c.id === this.activeId)!;
    }

    private save(): void {
        this.storage.update(CONV_KEY,   this.conversations);
        this.storage.update(ACTIVE_KEY, this.activeId);
    }

    // ── Public API ────────────────────────────────────────────────

    createConversation(): string {
        const id   = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const conv: Conversation = { id, title: 'New chat', createdAt: Date.now(), messages: [] };
        this.conversations.push(conv);
        // Keep only last MAX_CONVERSATIONS
        if (this.conversations.length > MAX_CONVERSATIONS) {
            this.conversations = this.conversations.slice(-MAX_CONVERSATIONS);
        }
        this.activeId = id;
        this.save();
        return id;
    }

    switchConversation(id: string): boolean {
        if (!this.conversations.find(c => c.id === id)) { return false; }
        this.activeId = id;
        this.save();
        return true;
    }

    deleteConversation(id: string): void {
        this.conversations = this.conversations.filter(c => c.id !== id);
        if (this.activeId === id) {
            if (this.conversations.length > 0) {
                this.activeId = this.conversations[this.conversations.length - 1].id;
            } else {
                this.createConversation();
                return;
            }
        }
        this.save();
    }

    getConversations(): Conversation[] {
        return [...this.conversations].reverse(); // newest first
    }

    getActiveId(): string { return this.activeId; }

    addMessage(role: 'user' | 'assistant', content: string): void {
        const conv = this.active;
        conv.messages.push({ role, content });

        // Auto-title from first user message
        if (conv.title === 'New chat' && role === 'user') {
            conv.title = content.slice(0, 60).replace(/\n/g, ' ');
        }

        if (conv.messages.length > MAX_MESSAGES_PER_CONV) {
            conv.messages = conv.messages.slice(-MAX_MESSAGES_PER_CONV);
        }
        this.save();
    }

    getHistory(): ChatMessage[] {
        return [...this.active.messages];
    }

    clearHistory(): void {
        this.active.messages = [];
        this.active.title    = 'New chat';
        this.save();
    }

    get messageCount(): number { return this.active.messages.length; }
}
