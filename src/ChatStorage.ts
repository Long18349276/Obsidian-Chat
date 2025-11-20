import { App } from 'obsidian';
import { Chat, Message } from './types';

export class ChatStorage {
    private app: App;
    private chatsDir = '.OChat-chats';

    constructor(app: App) {
        this.app = app;
        this.ensureChatsDir();
    }

    private async ensureChatsDir() {
        const exists = await this.app.vault.adapter.exists(this.chatsDir);
        if (!exists) {
            await this.app.vault.adapter.mkdir(this.chatsDir);
        }
    }

    async saveChat(chat: Chat): Promise<void> {
        const filePath = `${this.chatsDir}/${chat.id}.json`;
        const data = JSON.stringify(chat, null, 2);
        await this.app.vault.adapter.write(filePath, data);
    }

    async loadChat(chatId: string): Promise<Chat | null> {
        const filePath = `${this.chatsDir}/${chatId}.json`;
        try {
            const data = await this.app.vault.adapter.read(filePath);
            const chat = JSON.parse(data) as Chat;
            // Migration: ensure agentId exists
            if (!chat.agentId) {
                chat.agentId = 'default';
            }
            return chat;
        } catch (error) {
            console.error('Failed to load chat:', error);
            return null;
        }
    }

    async loadAllChats(): Promise<Chat[]> {
        const files = await this.app.vault.adapter.list(this.chatsDir);
        const chats: Chat[] = [];

        for (const file of files.files) {
            if (file.endsWith('.json')) {
                const chatId = file.replace(`${this.chatsDir}/`, '').replace('.json', '');
                const chat = await this.loadChat(chatId);
                if (chat) {
                    chats.push(chat);
                }
            }
        }

        return chats.sort((a, b) => b.updatedAt - a.updatedAt);
    }

    async getChatsByAgent(agentId: string): Promise<Chat[]> {
        const allChats = await this.loadAllChats();
        return allChats.filter(chat => chat.agentId === agentId);
    }

    async deleteChat(chatId: string): Promise<void> {
        const filePath = `${this.chatsDir}/${chatId}.json`;
        await this.app.vault.adapter.remove(filePath);
    }

    createNewChat(agentId: string): Chat {
        return {
            id: this.generateId(),
            agentId: agentId,
            title: 'New Chat',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messages: [],
        };
    }

    private generateId(): string {
        return Date.now().toString(36) + Math.random().toString(36).substring(2);
    }
}
