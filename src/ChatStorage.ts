import { App } from 'obsidian';
import { Chat, Message } from './types';

export class ChatStorage {
    private app: App;
    private chatsDir = '.OChat-chats';

    constructor(app: App) {
        this.app = app;
        this.ensureChatsDir();
        this.migrateOldChats();
    }

    private async ensureChatsDir() {
        const exists = await this.app.vault.adapter.exists(this.chatsDir);
        if (!exists) {
            await this.app.vault.adapter.mkdir(this.chatsDir);
        }
    }

    /**
     * Get the agent directory path for a given agent ID
     * Format: .OChat-chats/_Agent_{agentId}_{agentId}
     */
    private getAgentDir(agentId: string): string {
        return `${this.chatsDir}/_Agent_${agentId}_${agentId}`;
    }

    /**
     * Get the topics directory path for a given agent ID
     * Format: .OChat-chats/_Agent_{agentId}_{agentId}/topics
     */
    private getTopicsDir(agentId: string): string {
        return `${this.getAgentDir(agentId)}/topics`;
    }

    /**
     * Get the topic directory path for a given chat
     * Format: .OChat-chats/_Agent_{agentId}_{agentId}/topics/topic_{chatId}
     */
    private getTopicDir(chat: Chat): string {
        return `${this.getTopicsDir(chat.agentId)}/topic_${chat.id}`;
    }

    /**
     * Get the full file path for a chat's history.json
     * Format: .OChat-chats/_Agent_{agentId}_{agentId}/topics/topic_{chatId}/history.json
     */
    private getChatFilePath(chat: Chat): string {
        return `${this.getTopicDir(chat)}/history.json`;
    }

    /**
     * Ensure the agent and topics directories exist
     */
    private async ensureAgentDirs(agentId: string): Promise<void> {
        const agentDir = this.getAgentDir(agentId);
        const topicsDir = this.getTopicsDir(agentId);

        if (!(await this.app.vault.adapter.exists(agentDir))) {
            await this.app.vault.adapter.mkdir(agentDir);
        }
        if (!(await this.app.vault.adapter.exists(topicsDir))) {
            await this.app.vault.adapter.mkdir(topicsDir);
        }
    }

    /**
     * Migrate old flat-structure chats to new hierarchical structure
     */
    private async migrateOldChats(): Promise<void> {
        try {
            const files = await this.app.vault.adapter.list(this.chatsDir);

            for (const file of files.files) {
                // Only migrate .json files directly in .OChat-chats directory (old format)
                if (file.endsWith('.json') && file.split('/').length === 2) {
                    const chatId = file.replace(`${this.chatsDir}/`, '').replace('.json', '');

                    try {
                        const data = await this.app.vault.adapter.read(file);
                        const chat = JSON.parse(data) as Chat;

                        // Ensure agentId exists (migration)
                        if (!chat.agentId) {
                            chat.agentId = 'default';
                        }

                        // Save to new location
                        await this.saveChat(chat);

                        // Delete old file
                        await this.app.vault.adapter.remove(file);

                        console.log(`[OChat] Migrated chat ${chatId} to new structure`);
                    } catch (error) {
                        console.error(`[OChat] Failed to migrate chat ${chatId}:`, error);
                    }
                }
            }
        } catch (error) {
            console.error('[OChat] Failed to migrate old chats:', error);
        }
    }

    async saveChat(chat: Chat): Promise<void> {
        // Ensure agent directories exist
        await this.ensureAgentDirs(chat.agentId);

        // Ensure topic directory exists
        const topicDir = this.getTopicDir(chat);
        if (!(await this.app.vault.adapter.exists(topicDir))) {
            await this.app.vault.adapter.mkdir(topicDir);
        }

        // Save chat to history.json
        const filePath = this.getChatFilePath(chat);
        const data = JSON.stringify(chat, null, 2);
        await this.app.vault.adapter.write(filePath, data);
    }

    async loadChat(chatId: string, agentId?: string): Promise<Chat | null> {
        try {
            // If agentId is provided, try to load from the specific agent directory
            if (agentId) {
                const filePath = `${this.getTopicsDir(agentId)}/topic_${chatId}/history.json`;
                if (await this.app.vault.adapter.exists(filePath)) {
                    const data = await this.app.vault.adapter.read(filePath);
                    const chat = JSON.parse(data) as Chat;
                    return chat;
                }
            }

            // Otherwise, search through all agent directories
            const dirContents = await this.app.vault.adapter.list(this.chatsDir);

            for (const dir of dirContents.folders) {
                // Check if this is an agent directory
                if (dir.includes('_Agent_')) {
                    const agentDirPath = dir;
                    const topicsPath = `${agentDirPath}/topics`;

                    if (await this.app.vault.adapter.exists(topicsPath)) {
                        const topicsContents = await this.app.vault.adapter.list(topicsPath);

                        for (const topicDir of topicsContents.folders) {
                            if (topicDir.includes(`topic_${chatId}`)) {
                                const filePath = `${topicDir}/history.json`;
                                if (await this.app.vault.adapter.exists(filePath)) {
                                    const data = await this.app.vault.adapter.read(filePath);
                                    const chat = JSON.parse(data) as Chat;
                                    return chat;
                                }
                            }
                        }
                    }
                }
            }

            return null;
        } catch (error) {
            console.error('Failed to load chat:', error);
            return null;
        }
    }

    async loadAllChats(): Promise<Chat[]> {
        const chats: Chat[] = [];

        try {
            const dirContents = await this.app.vault.adapter.list(this.chatsDir);

            for (const dir of dirContents.folders) {
                // Check if this is an agent directory
                if (dir.includes('_Agent_')) {
                    const agentDirPath = dir;
                    const topicsPath = `${agentDirPath}/topics`;

                    if (await this.app.vault.adapter.exists(topicsPath)) {
                        const topicsContents = await this.app.vault.adapter.list(topicsPath);

                        for (const topicDir of topicsContents.folders) {
                            const filePath = `${topicDir}/history.json`;

                            if (await this.app.vault.adapter.exists(filePath)) {
                                try {
                                    const data = await this.app.vault.adapter.read(filePath);
                                    const chat = JSON.parse(data) as Chat;
                                    chats.push(chat);
                                } catch (error) {
                                    console.error(`Failed to load chat from ${filePath}:`, error);
                                }
                            }
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Failed to load all chats:', error);
        }

        return chats.sort((a, b) => b.updatedAt - a.updatedAt);
    }

    async getChatsByAgent(agentId: string): Promise<Chat[]> {
        const chats: Chat[] = [];

        try {
            const topicsDir = this.getTopicsDir(agentId);

            if (!(await this.app.vault.adapter.exists(topicsDir))) {
                return chats;
            }

            const topicsContents = await this.app.vault.adapter.list(topicsDir);

            for (const topicDir of topicsContents.folders) {
                const filePath = `${topicDir}/history.json`;

                if (await this.app.vault.adapter.exists(filePath)) {
                    try {
                        const data = await this.app.vault.adapter.read(filePath);
                        const chat = JSON.parse(data) as Chat;
                        chats.push(chat);
                    } catch (error) {
                        console.error(`Failed to load chat from ${filePath}:`, error);
                    }
                }
            }
        } catch (error) {
            console.error(`Failed to load chats for agent ${agentId}:`, error);
        }

        return chats.sort((a, b) => b.updatedAt - a.updatedAt);
    }

    async deleteChat(chatId: string, agentId?: string): Promise<void> {
        try {
            const chat = await this.loadChat(chatId, agentId);
            if (!chat) {
                console.warn(`Chat ${chatId} not found`);
                return;
            }

            const topicDir = this.getTopicDir(chat);

            if (await this.app.vault.adapter.exists(topicDir)) {
                // Remove the entire topic directory
                await this.app.vault.adapter.rmdir(topicDir, true);
            }
        } catch (error) {
            console.error(`Failed to delete chat ${chatId}:`, error);
        }
    }

    createNewChat(agentId: string): Chat {
        return {
            id: this.generateId(),
            agentId: agentId,
            title: 'New Chat',
            updatedAt: Date.now(),
            messages: [],
        };
    }

    private generateId(): string {
        // Use timestamp as ID directly for meaningful directory names
        return Date.now().toString();
    }
}
