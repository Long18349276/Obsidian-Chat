import { App, Modal, Setting, ButtonComponent, TextComponent } from 'obsidian';
import { Chat } from './types';
import { TagModal } from './TagModal';

export class ChatHistoryModal extends Modal {
    private chats: Chat[];
    private filteredChats: Chat[];
    private onSelectChat: (chat: Chat) => void;
    private onDeleteChat: (chat: Chat) => void;
    private onRenameChat: (chat: Chat, newName: string) => void;
    private onDeleteAllNewChats: () => void;
    private onUpdateTags: (chat: Chat, tags: string[]) => void;
    private onExportChats?: (chats: Chat[]) => void; // Optional for export mode

    private searchQuery: string = '';
    private isExportMode: boolean = false;
    private selectedChatsForExport: Set<string> = new Set();

    constructor(
        app: App,
        chats: Chat[],
        onSelectChat: (chat: Chat) => void,
        onDeleteChat: (chat: Chat) => void,
        onRenameChat: (chat: Chat, newName: string) => void,
        onDeleteAllNewChats: () => void,
        onUpdateTags: (chat: Chat, tags: string[]) => void,
        isExportMode: boolean = false,
        onExportChats?: (chats: Chat[]) => void
    ) {
        super(app);
        this.chats = chats;
        this.filteredChats = chats;
        this.onSelectChat = onSelectChat;
        this.onDeleteChat = onDeleteChat;
        this.onRenameChat = onRenameChat;
        this.onDeleteAllNewChats = onDeleteAllNewChats;
        this.onUpdateTags = onUpdateTags;
        this.isExportMode = isExportMode;
        this.onExportChats = onExportChats;
    }

    onOpen() {
        this.render();
    }

    private render() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h2', { text: this.isExportMode ? 'Select Chats to Export' : 'Chat History' });

        // Search Bar
        const searchContainer = contentEl.createDiv({ cls: 'OChat-history-search' });
        searchContainer.style.marginBottom = '15px';
        searchContainer.style.display = 'flex';
        searchContainer.style.gap = '10px';

        const searchInput = new TextComponent(searchContainer)
            .setPlaceholder('Search by title, content, or tags...')
            .setValue(this.searchQuery)
            .onChange((value) => {
                this.searchQuery = value;
                this.filterChats();
                this.renderList(listContainer);
            });
        searchInput.inputEl.style.flexGrow = '1';

        // Bulk Actions
        const newChatsCount = this.chats.filter(c => c.title === 'New Chat').length;
        if (newChatsCount > 0 && !this.isExportMode) {
            const deleteContainer = contentEl.createDiv({ cls: 'OChat-history-bulk-actions' });
            deleteContainer.style.marginBottom = '10px';
            deleteContainer.style.display = 'flex';
            deleteContainer.style.justifyContent = 'flex-end';

            new ButtonComponent(deleteContainer)
                .setButtonText(`Delete all "New Chat" (${newChatsCount})`)
                .setWarning()
                .onClick(() => {
                    if (confirm(`Are you sure you want to delete all ${newChatsCount} chats named "New Chat"?`)) {
                        this.onDeleteAllNewChats();
                        this.close();
                    }
                });
        }

        if (this.isExportMode) {
            const exportActions = contentEl.createDiv({ cls: 'OChat-export-actions' });
            exportActions.style.marginBottom = '10px';
            exportActions.style.display = 'flex';
            exportActions.style.justifyContent = 'flex-end';
            exportActions.style.gap = '10px';

            new ButtonComponent(exportActions)
                .setButtonText('Select All')
                .onClick(() => {
                    this.filteredChats.forEach(c => this.selectedChatsForExport.add(c.id));
                    this.render();
                });

            new ButtonComponent(exportActions)
                .setButtonText('Deselect All')
                .onClick(() => {
                    this.selectedChatsForExport.clear();
                    this.render();
                });

            new ButtonComponent(exportActions)
                .setButtonText(`Export Selected (${this.selectedChatsForExport.size})`)
                .setCta()
                .onClick(() => {
                    const selected = this.chats.filter(c => this.selectedChatsForExport.has(c.id));
                    if (this.onExportChats) {
                        this.onExportChats(selected);
                        this.close();
                    }
                });
        }

        const listContainer = contentEl.createDiv({ cls: 'OChat-history-list' });
        this.filterChats();
        this.renderList(listContainer);
    }

    private filterChats() {
        const query = this.searchQuery.toLowerCase();
        if (!query) {
            this.filteredChats = this.chats;
            return;
        }

        this.filteredChats = this.chats.filter(chat => {
            const titleMatch = (chat.title || '').toLowerCase().includes(query);
            const contentMatch = chat.messages.some(m => m.content.toLowerCase().includes(query));
            const tagMatch = (chat.tags || []).some(t => t.toLowerCase().includes(query));
            return titleMatch || contentMatch || tagMatch;
        });
    }

    private renderList(container: HTMLElement) {
        container.empty();

        if (this.filteredChats.length === 0) {
            container.createEl('p', { text: 'No chats found.' });
            return;
        }

        this.filteredChats.forEach(chat => {
            const item = container.createDiv({ cls: 'OChat-history-item' });
            item.style.display = 'flex';
            item.style.justifyContent = 'space-between';
            item.style.alignItems = 'center';
            item.style.padding = '10px';
            item.style.borderBottom = '1px solid var(--background-modifier-border)';
            item.style.cursor = 'pointer';

            if (this.isExportMode) {
                const checkbox = item.createEl('input', { type: 'checkbox' });
                checkbox.checked = this.selectedChatsForExport.has(chat.id);
                checkbox.style.marginRight = '10px';
                checkbox.onclick = (e) => {
                    e.stopPropagation();
                    if (checkbox.checked) {
                        this.selectedChatsForExport.add(chat.id);
                    } else {
                        this.selectedChatsForExport.delete(chat.id);
                    }
                    // Re-render header to update count? Or just update button text if we stored ref.
                    // Simpler to just re-render the whole view or just the button.
                    // Let's re-render whole view for simplicity to update button count.
                    this.render();
                };
            }

            const infoDiv = item.createDiv();
            infoDiv.style.flexGrow = '1';

            const titleRow = infoDiv.createDiv({ cls: 'OChat-history-title-row' });
            titleRow.style.display = 'flex';
            titleRow.style.alignItems = 'center';
            titleRow.style.gap = '10px';

            titleRow.createDiv({ cls: 'OChat-history-title', text: chat.title || 'Untitled Chat' });

            if (chat.tags && chat.tags.length > 0) {
                const tagsDiv = titleRow.createDiv({ cls: 'OChat-history-tags' });
                tagsDiv.style.display = 'flex';
                tagsDiv.style.gap = '4px';
                chat.tags.forEach(tag => {
                    const tagSpan = tagsDiv.createSpan({ text: tag });
                    tagSpan.style.fontSize = '0.7em';
                    tagSpan.style.backgroundColor = 'var(--background-secondary)';
                    tagSpan.style.padding = '1px 4px';
                    tagSpan.style.borderRadius = '4px';
                    tagSpan.style.color = 'var(--text-muted)';
                });
            }

            infoDiv.createDiv({
                cls: 'OChat-history-date',
                text: new Date(chat.updatedAt).toLocaleString(),
                attr: { style: 'font-size: 0.8em; color: var(--text-muted);' }
            });

            infoDiv.onclick = () => {
                if (this.isExportMode) {
                    // Toggle selection
                    if (this.selectedChatsForExport.has(chat.id)) {
                        this.selectedChatsForExport.delete(chat.id);
                    } else {
                        this.selectedChatsForExport.add(chat.id);
                    }
                    this.render();
                } else {
                    this.onSelectChat(chat);
                    this.close();
                }
            };

            const actionsDiv = item.createDiv({ cls: 'OChat-history-actions' });
            actionsDiv.style.display = 'flex';
            actionsDiv.style.gap = '5px';

            // Tag Button
            const tagBtn = actionsDiv.createEl('button', { text: '🏷️' });
            tagBtn.title = "Manage Tags";
            tagBtn.onclick = (e) => {
                e.stopPropagation();
                new TagModal(this.app, chat.tags, (newTags) => {
                    this.onUpdateTags(chat, newTags);
                    this.render(); // Refresh to show new tags
                }).open();
            };

            if (!this.isExportMode) {
                // Rename Button
                const renameBtn = actionsDiv.createEl('button', { text: '✎' });
                renameBtn.title = "Rename Chat";
                renameBtn.onclick = (e) => {
                    e.stopPropagation();
                    new RenameModal(this.app, chat.title, (newName) => {
                        this.onRenameChat(chat, newName);
                        this.render();
                    }).open();
                };

                // Delete Button
                const deleteBtn = actionsDiv.createEl('button', { text: '🗑️' });
                deleteBtn.title = "Delete Chat";
                deleteBtn.onclick = async (e) => {
                    e.stopPropagation();
                    if (confirm('Are you sure you want to delete this chat?')) {
                        await this.onDeleteChat(chat);
                        this.chats = this.chats.filter(c => c.id !== chat.id);
                        this.render(); // Re-render entire modal to update counts
                    }
                };
            }
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

class RenameModal extends Modal {
    private currentName: string;
    private onRename: (newName: string) => void;

    constructor(app: App, currentName: string, onRename: (newName: string) => void) {
        super(app);
        this.currentName = currentName;
        this.onRename = onRename;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: 'Rename Chat' });

        let name = this.currentName;

        new Setting(contentEl)
            .setName('Name')
            .addText(text => text
                .setValue(name)
                .onChange(value => name = value));

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('Save')
                .setCta()
                .onClick(() => {
                    this.onRename(name);
                    this.close();
                }))
            .addButton(btn => btn
                .setButtonText('Cancel')
                .onClick(() => this.close()));
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
