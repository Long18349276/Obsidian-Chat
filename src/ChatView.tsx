import { ItemView, WorkspaceLeaf, Notice, TFile } from 'obsidian';
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { ChatComponent } from './ChatComponent';
import { Chat, Message, Agent, DEFAULT_AGENT } from './types';
import ObsidianVCPPlugin from './main';
import { AgentConfigModal } from './AgentConfigModal';
import { ChatHistoryModal } from './ChatHistoryModal';
import { EditMessageModal } from './EditMessageModal';
import { TagModal } from './TagModal';

export const VIEW_TYPE_OCHAT = 'OChat-chat-view';

export class ChatView extends ItemView {
    private root: Root | null = null;
    private plugin: ObsidianVCPPlugin;
    private currentChat: Chat | null = null;
    private isLoading = false;
    private streamingMessage = '';
    private abortController: AbortController | null = null;
    private isAutoNaming = false;

    constructor(leaf: WorkspaceLeaf, plugin: ObsidianVCPPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return VIEW_TYPE_OCHAT;
    }

    getDisplayText(): string {
        return 'OChat';
    }

    getIcon(): string {
        return 'message-circle';
    }

    async onOpen(): Promise<void> {
        await this.loadOrCreateChat();
        this.render();
    }

    async onClose(): Promise<void> {
        this.root?.unmount();
    }

    private async loadOrCreateChat(): Promise<void> {
        const activeAgentId = this.plugin.settings.activeAgentId;
        // Try to load the most recent chat for this agent
        const chats = await this.plugin.chatStorage.getChatsByAgent(activeAgentId);

        if (chats.length > 0) {
            this.currentChat = chats[0];
        } else {
            this.currentChat = this.plugin.chatStorage.createNewChat(activeAgentId);
            await this.plugin.chatStorage.saveChat(this.currentChat);
        }
    }

    private async handleAgentChange(agentId: string): Promise<void> {
        if (agentId === 'new_agent_action') {
            // Create new agent
            const newAgent: Agent = {
                ...DEFAULT_AGENT,
                id: Date.now().toString(),
                name: 'New Agent',
            };
            new AgentConfigModal(this.app, newAgent, this.plugin.apiClient, async (savedAgent) => {
                this.plugin.settings.agents.push(savedAgent);
                this.plugin.settings.activeAgentId = savedAgent.id;
                await this.plugin.saveSettings();
                await this.loadOrCreateChat(); // Load chat for new agent
                this.render();
            }).open();
            return;
        }

        this.plugin.settings.activeAgentId = agentId;
        await this.plugin.saveSettings();
        await this.loadOrCreateChat();
        this.render();
    }

    private handleEditAgent(): void {
        const activeAgentId = this.plugin.settings.activeAgentId;
        const agent = this.plugin.settings.agents.find(a => a.id === activeAgentId);
        if (!agent) return;

        new AgentConfigModal(this.app, agent, this.plugin.apiClient, async (savedAgent) => {
            // Update agent in settings
            const index = this.plugin.settings.agents.findIndex(a => a.id === savedAgent.id);
            if (index !== -1) {
                this.plugin.settings.agents[index] = savedAgent;
                await this.plugin.saveSettings();
                this.render();
            }
        }).open();
    }

    private async handleShowHistory(isExportMode: boolean = false): Promise<void> {
        const activeAgentId = this.plugin.settings.activeAgentId;
        const chats = await this.plugin.chatStorage.getChatsByAgent(activeAgentId);

        new ChatHistoryModal(
            this.app,
            chats,
            async (selectedChat) => {
                this.currentChat = selectedChat;
                this.render();
            },
            async (chatToDelete) => {
                await this.plugin.chatStorage.deleteChat(chatToDelete.id, chatToDelete.agentId);
                // Refresh if current chat was deleted
                if (this.currentChat?.id === chatToDelete.id) {
                    await this.loadOrCreateChat();
                    this.render();
                }
            },
            async (chatToRename, newName) => {
                chatToRename.title = newName;
                chatToRename.manualTitle = true;
                await this.plugin.chatStorage.saveChat(chatToRename);
                if (this.currentChat?.id === chatToRename.id) {
                    this.currentChat = chatToRename;
                    this.render();
                }
            },
            async () => {
                const activeAgentId = this.plugin.settings.activeAgentId;
                const chats = await this.plugin.chatStorage.getChatsByAgent(activeAgentId);
                const chatsToDelete = chats.filter(c => c.title === 'New Chat');

                for (const chat of chatsToDelete) {
                    await this.plugin.chatStorage.deleteChat(chat.id, chat.agentId);
                }

                // If current chat was deleted, load a new one or create one
                if (this.currentChat && this.currentChat.title === 'New Chat') {
                    await this.loadOrCreateChat();
                }
                this.render();
                new Notice(`Deleted ${chatsToDelete.length} chats.`);
            },
            async (chatToUpdate, newTags) => {
                chatToUpdate.tags = newTags;
                await this.plugin.chatStorage.saveChat(chatToUpdate);
                if (this.currentChat?.id === chatToUpdate.id) {
                    this.currentChat = chatToUpdate;
                    this.render();
                }
            },
            isExportMode,
            async (chatsToExport) => {
                await this.exportChats(chatsToExport);
            }
        ).open();
    }

    private async exportChats(chats: Chat[]): Promise<void> {
        const exportPath = this.plugin.settings.exportPath || 'OChat_Exports';
        const adapter = this.app.vault.adapter;

        if (!(await adapter.exists(exportPath))) {
            await this.app.vault.createFolder(exportPath);
        }

        let successCount = 0;
        for (const chat of chats) {
            try {
                const safeTitle = (chat.title || 'Untitled Chat').replace(/[\\/:*?"<>|]/g, '_');
                let fileName = `${exportPath}/${safeTitle}.md`;

                // Handle duplicates
                let counter = 1;
                while (await adapter.exists(fileName)) {
                    fileName = `${exportPath}/${safeTitle} (${counter}).md`;
                    counter++;
                }

                const content = this.formatChatForExport(chat);
                await this.app.vault.create(fileName, content);
                successCount++;
            } catch (e) {
                console.error(`Failed to export chat ${chat.id}`, e);
            }
        }

        new Notice(`Exported ${successCount} chats to ${exportPath}`);
    }

    private formatChatForExport(chat: Chat): string {
        const date = new Date(chat.updatedAt).toLocaleString();
        const tags = chat.tags ? `\nTags: ${chat.tags.join(', ')}` : '';
        let content = `# ${chat.title || 'Untitled Chat'}\nDate: ${date}${tags}\n\n`;

        chat.messages.forEach(msg => {
            const role = msg.role === 'user' ? 'User' : 'Assistant';
            content += `### ${role}\n${msg.content}\n\n`;
        });

        return content;
    }

    private async handleEditMessage(index: number, currentContent: string): Promise<void> {
        new EditMessageModal(this.app, currentContent, async (newContent) => {
            if (!this.currentChat) return;
            this.currentChat.messages[index].content = newContent;
            this.currentChat.updatedAt = Date.now();
            await this.plugin.chatStorage.saveChat(this.currentChat);
            this.render();
        }).open();
    }

    private async autoNameChat(): Promise<void> {
        if (!this.currentChat) return;

        console.log('[OChat] autoNameChat called - autoTopicNaming:', this.plugin.settings.autoTopicNaming, 'manualTitle:', this.currentChat.manualTitle, 'isAutoNaming:', this.isAutoNaming);

        if (!this.plugin.settings.autoTopicNaming) {
            console.log('[OChat] Auto-naming is disabled in settings, skipping');
            return;
        }

        if (this.currentChat.manualTitle) {
            console.log('[OChat] Chat has manual title, skipping auto-naming');
            return;
        }

        if (this.isAutoNaming) {
            console.log('[OChat] Auto-naming already in progress, skipping');
            return;
        }

        const messages = this.currentChat.messages;
        let assistantCount = 0;
        for (const msg of messages) {
            if (msg.role === 'assistant') assistantCount++;
        }

        console.log('[OChat] Assistant message count:', assistantCount);

        if (assistantCount < 3) {
            console.log('[OChat] Not enough assistant messages for auto-naming (need 3, have', assistantCount, ')');
            return;
        }

        this.isAutoNaming = true;
        try {
            console.log('[OChat] Starting auto-naming process');
            await this.plugin.generateChatTitle(this.currentChat);
            console.log('[OChat] Auto-naming completed successfully');
        } catch (error) {
            console.error('[OChat] Auto-naming failed:', error);
        } finally {
            this.isAutoNaming = false;
        }
    }

    private async handleSendMessage(content: string): Promise<void> {
        if (!this.currentChat || this.isLoading) return;

        const activeAgent = this.plugin.settings.agents.find(a => a.id === this.plugin.settings.activeAgentId) || this.plugin.settings.agents[0];

        const userMessage: Message = { role: 'user', content };
        this.currentChat.messages.push(userMessage);
        this.currentChat.updatedAt = Date.now();
        await this.plugin.chatStorage.saveChat(this.currentChat);
        this.render();

        this.isLoading = true;
        this.streamingMessage = '';
        this.render();

        try {
            const applyRequestRules = (content: string): string => {
                let processedContent = content;
                this.plugin.settings.regexRules.forEach(rule => {
                    if (rule.scope === 'request' || rule.scope === 'both') {
                        try {
                            const regex = new RegExp(rule.pattern, rule.flags || 'g');
                            processedContent = processedContent.replace(regex, rule.replacement);
                        } catch (e) {
                            console.error('Invalid regex rule:', rule, e);
                        }
                    }
                });
                return processedContent;
            };

            const messagesToSend = this.currentChat.messages.map(m => ({
                role: m.role,
                content: applyRequestRules(m.content)
            }));

            // Add system prompt if configured
            let systemPromptContent = activeAgent.systemPrompt; // Fallback
            if (activeAgent.systemPrompts && activeAgent.activeSystemPromptId) {
                const activePrompt = activeAgent.systemPrompts.find(p => p.id === activeAgent.activeSystemPromptId);
                if (activePrompt) {
                    systemPromptContent = activePrompt.content;
                }
            }

            if (systemPromptContent) {
                messagesToSend.unshift({ role: 'system', content: systemPromptContent });
            }

            this.abortController = new AbortController();
            await this.plugin.apiClient.sendMessage(activeAgent, messagesToSend, (chunk) => {
                this.streamingMessage += chunk;
                this.render();
            }, this.abortController.signal);

            // After stream finishes, save the full message
            const assistantMessage: Message = { role: 'assistant', content: this.streamingMessage };
            this.currentChat.messages.push(assistantMessage);
            this.currentChat.updatedAt = Date.now();
            await this.plugin.chatStorage.saveChat(this.currentChat);

            // Trigger auto-naming (await to ensure proper sequencing)
            await this.autoNameChat();

        } catch (error) {
            new Notice('Failed to send message: ' + error.message);
            this.currentChat.messages.push({
                role: 'assistant',
                content: 'Error: ' + error.message
            });
        } finally {
            this.isLoading = false;
            this.streamingMessage = '';
            this.abortController = null;
            this.render();
        }
    }

    private handleStopGeneration(): void {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
            this.isLoading = false;

            // Save partial message if any
            if (this.streamingMessage && this.currentChat) {
                const assistantMessage: Message = { role: 'assistant', content: this.streamingMessage };
                this.currentChat.messages.push(assistantMessage);
                this.currentChat.updatedAt = Date.now();
                this.plugin.chatStorage.saveChat(this.currentChat);
            }

            this.streamingMessage = '';
            this.render();
            new Notice('Generation stopped.');
        }
    }

    private async handleDeleteMessage(index: number): Promise<void> {
        if (!this.currentChat) return;
        this.currentChat.messages.splice(index, 1);
        this.currentChat.updatedAt = Date.now();
        await this.plugin.chatStorage.saveChat(this.currentChat);
        this.render();
    }

    private async handleRegenerate(index: number): Promise<void> {
        if (!this.currentChat || this.isLoading) return;

        const message = this.currentChat.messages[index];

        // If regenerating a user message, remove everything after it and resend it
        if (message.role === 'user') {
            this.currentChat.messages = this.currentChat.messages.slice(0, index);
            await this.handleSendMessage(message.content);
        }
        // If regenerating an assistant message, remove it and the previous user message, then resend the user message
        else if (message.role === 'assistant') {
            // Find the previous user message
            const prevUserMsgIndex = index - 1;
            if (prevUserMsgIndex >= 0 && this.currentChat.messages[prevUserMsgIndex].role === 'user') {
                const content = this.currentChat.messages[prevUserMsgIndex].content;
                this.currentChat.messages = this.currentChat.messages.slice(0, prevUserMsgIndex);
                await this.handleSendMessage(content);
            } else {
                // Just remove the assistant message if no user message found (unlikely case)
                this.currentChat.messages.splice(index, 1);
                this.render();
            }
        }
    }

    public async newChat(): Promise<void> {
        const activeAgentId = this.plugin.settings.activeAgentId;
        this.currentChat = this.plugin.chatStorage.createNewChat(activeAgentId);
        await this.plugin.chatStorage.saveChat(this.currentChat);
        this.render();
        console.log('[OChat] New chat created');
    }

    private async getActiveNote(): Promise<{ name: string; content: string } | null> {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) return null;

        const content = await this.app.vault.read(activeFile);
        return {
            name: activeFile.basename,
            content: content
        };
    }

    private async handleBranch(messageIndex: number): Promise<void> {
        if (!this.currentChat) return;

        // Create new chat with messages up to messageIndex (inclusive)
        const activeAgentId = this.plugin.settings.activeAgentId;
        const newChat = this.plugin.chatStorage.createNewChat(activeAgentId);

        // Copy messages
        newChat.messages = this.currentChat.messages.slice(0, messageIndex + 1).map(m => ({ ...m }));
        newChat.title = `${this.currentChat.title || 'Chat'} (Branch)`;
        newChat.manualTitle = true;

        await this.plugin.chatStorage.saveChat(newChat);
        this.currentChat = newChat;
        this.render();
        new Notice('Conversation branched.');
    }

    private async handleAddTag(): Promise<void> {
        if (!this.currentChat) return;

        new TagModal(this.app, this.currentChat.tags, async (newTags) => {
            if (this.currentChat) {
                this.currentChat.tags = newTags;
                await this.plugin.chatStorage.saveChat(this.currentChat);
                this.render();
            }
        }).open();
    }

    private render(): void {
        const container = this.containerEl.children[1];
        if (!this.root) {
            this.root = createRoot(container);
        }

        const activeAgent = this.plugin.settings.agents.find(a => a.id === this.plugin.settings.activeAgentId) || this.plugin.settings.agents[0];

        // If streaming, we need to show the partial message
        const messagesToShow = this.currentChat ? [...this.currentChat.messages] : [];
        if (this.isLoading && this.streamingMessage) {
            messagesToShow.push({ role: 'assistant', content: this.streamingMessage });
        }

        // Create a temporary chat object for rendering with the streaming message
        const chatForRender = this.currentChat ? {
            ...this.currentChat,
            messages: messagesToShow
        } : null;

        this.root.render(
            <React.StrictMode>
                <ChatComponent
                    app={this.app}
                    chat={chatForRender}
                    activeAgent={activeAgent}
                    agents={this.plugin.settings.agents}
                    onSendMessage={this.handleSendMessage.bind(this)}
                    onNewChat={this.newChat.bind(this)}
                    onAgentChange={this.handleAgentChange.bind(this)}
                    onEditAgent={this.handleEditAgent.bind(this)}
                    onShowHistory={() => this.handleShowHistory(false)}
                    onDeleteMessage={this.handleDeleteMessage.bind(this)}
                    onRegenerate={this.handleRegenerate.bind(this)}
                    onEditMessage={this.handleEditMessage.bind(this)}
                    isLoading={this.isLoading}
                    onGetActiveNote={this.getActiveNote.bind(this)}
                    onBranch={this.handleBranch.bind(this)}
                    onExport={() => this.handleShowHistory(true)}
                    onAddTag={this.handleAddTag.bind(this)}
                    regexRules={this.plugin.settings.regexRules}
                    onStop={this.handleStopGeneration.bind(this)}
                />
            </React.StrictMode>
        );
    }
}
