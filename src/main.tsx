import { Plugin, WorkspaceLeaf } from 'obsidian';
import { ChatView, VIEW_TYPE_OCHAT } from './ChatView';
import { OChatSettingTab } from './SettingTab';
import { ChatStorage } from './ChatStorage';
import { OpenAIClient } from './OpenAIClient';
import { OChatSettings, DEFAULT_SETTINGS, DEFAULT_AGENT } from './types';

export default class ObsidianVCPPlugin extends Plugin {
    settings: OChatSettings;
    chatStorage: ChatStorage;
    apiClient: OpenAIClient;

    async onload() {
        console.log('Loading OChat plugin');

        // Load settings
        await this.loadSettings();

        // Initialize storage and API client
        this.chatStorage = new ChatStorage(this.app);
        this.apiClient = new OpenAIClient(this.settings);

        // Register view
        this.registerView(
            VIEW_TYPE_OCHAT,
            (leaf) => new ChatView(leaf, this)
        );

        // Add ribbon icon
        this.addRibbonIcon('message-circle', 'Open OChat', () => {
            this.activateView();
        });

        // Add commands
        this.addCommand({
            id: 'open-OChat-chat',
            name: 'Open OChat',
            callback: () => {
                this.activateView();
            }
        });

        this.addCommand({
            id: 'new-OChat-chat',
            name: 'New OChat',
            callback: async () => {
                const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_OCHAT);
                if (leaves.length > 0) {
                    const view = leaves[0].view;
                    if (view instanceof ChatView) {
                        await view.newChat();
                    }
                } else {
                    await this.activateView();
                }
            }
        });

        // Add settings tab
        this.addSettingTab(new OChatSettingTab(this.app, this));
    }

    async onunload() {
        console.log('Unloading OChat plugin');
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
        // Update API client with new settings
        if (this.apiClient) {
            this.apiClient.updateSettings(this.settings);
        }
    }

    async activateView() {
        const { workspace } = this.app;

        let leaf: WorkspaceLeaf | null = null;
        const leaves = workspace.getLeavesOfType(VIEW_TYPE_OCHAT);

        if (leaves.length > 0) {
            leaf = leaves[0];
        } else {
            leaf = workspace.getRightLeaf(false);
            if (leaf) {
                await leaf.setViewState({
                    type: VIEW_TYPE_OCHAT,
                    active: true,
                });
            }
        }

        if (leaf) {
            workspace.revealLeaf(leaf);
        }
    }

    async generateChatTitle(chat: import('./types').Chat, force: boolean = false): Promise<void> {
        if (!force && (!this.settings.autoTopicNaming || chat.manualTitle)) return;

        const messages = chat.messages;
        if (messages.length < 2) return;

        // Find 3rd assistant message index
        let assistantCount = 0;
        let thirdAssistantIndex = -1;
        for (let i = 0; i < messages.length; i++) {
            if (messages[i].role === 'assistant') {
                assistantCount++;
                if (assistantCount === 3) {
                    thirdAssistantIndex = i;
                    break;
                }
            }
        }

        // Find 3rd last user message index
        let userCount = 0;
        let thirdLastUserIndex = -1;
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'user') {
                userCount++;
                if (userCount === 3) {
                    thirdLastUserIndex = i;
                    break;
                }
            }
        }

        let contextMessages: import('./types').Message[] = [];

        if (thirdAssistantIndex !== -1) {
            contextMessages = contextMessages.concat(messages.slice(0, thirdAssistantIndex + 1));
        } else {
            contextMessages = contextMessages.concat(messages);
        }

        if (thirdLastUserIndex !== -1) {
            const startB = thirdLastUserIndex;
            const endA = thirdAssistantIndex !== -1 ? thirdAssistantIndex : messages.length - 1;

            if (startB > endA) {
                contextMessages = contextMessages.concat(messages.slice(startB));
            }
        }

        contextMessages = Array.from(new Set(contextMessages));

        const namingAgent: import('./types').Agent = {
            ...DEFAULT_AGENT,
            model: this.settings.topicModel || 'deepseek-ai/DeepSeek-V3.2-Exp',
            systemPrompt: '总结聊天话题，10字以内',
            maxTokens: 50
        };

        const namingMessages: import('./types').Message[] = [
            { role: 'system', content: 'Summarize the following conversation into a short, concise topic title (max 5-6 words). Do not use quotes. Output ONLY the title.' },
            ...contextMessages.map(m => ({ role: m.role, content: m.content }))
        ];

        try {
            let title = '';
            await this.apiClient.sendMessage(namingAgent, namingMessages, (chunk) => {
                title += chunk;
            });

            title = title.trim().replace(/^["']|["']$/g, '');
            if (title) {
                chat.title = title;
                await this.chatStorage.saveChat(chat);
            }
        } catch (error) {
            console.error('Failed to auto-name chat:', error);
        }
    }
}
