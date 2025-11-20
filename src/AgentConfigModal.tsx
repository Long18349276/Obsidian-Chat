import { App, Modal, Setting, Notice, ButtonComponent } from 'obsidian';
import { Agent, DEFAULT_AGENT } from './types';
import { OpenAIClient } from './OpenAIClient';

export class AgentConfigModal extends Modal {
    private agent: Agent;
    private onSave: (agent: Agent) => void;
    private apiClient: OpenAIClient;

    constructor(app: App, agent: Agent | null, apiClient: OpenAIClient, onSave: (agent: Agent) => void) {
        super(app);
        this.agent = agent ? { ...agent } : { ...DEFAULT_AGENT, id: Date.now().toString(), name: 'New Agent' };

        // Migration/Initialization for systemPrompts
        if (!this.agent.systemPrompts || this.agent.systemPrompts.length === 0) {
            this.agent.systemPrompts = [{
                id: 'default',
                name: 'Default',
                content: this.agent.systemPrompt || DEFAULT_AGENT.systemPrompt
            }];
            this.agent.activeSystemPromptId = 'default';
        }

        // Ensure activeSystemPromptId is valid
        if (!this.agent.activeSystemPromptId || !this.agent.systemPrompts.find(p => p.id === this.agent.activeSystemPromptId)) {
            this.agent.activeSystemPromptId = this.agent.systemPrompts[0].id;
        }

        this.apiClient = apiClient;
        this.onSave = onSave;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h2', { text: this.agent.id === 'default' ? 'Edit Default Agent' : (this.agent.name || 'New Agent') });

        new Setting(contentEl)
            .setName('Name')
            .setDesc('The name of this agent')
            .addText(text => text
                .setValue(this.agent.name)
                .onChange(async (value) => {
                    this.agent.name = value;
                }));

        const modelSetting = new Setting(contentEl)
            .setName('Model')
            .setDesc('The model ID to use')
            .addText(text => text
                .setValue(this.agent.model)
                .onChange(async (value) => {
                    this.agent.model = value;
                }));

        modelSetting.addButton(btn => btn
            .setButtonText('Fetch Models')
            .onClick(async () => {
                btn.setButtonText('Fetching...');
                btn.setDisabled(true);
                try {
                    const models = await this.apiClient.fetchModels();
                    modelSetting.controlEl.empty();
                    modelSetting.addDropdown(dropdown => {
                        models.forEach(m => dropdown.addOption(m, m));
                        dropdown.setValue(this.agent.model);
                        dropdown.onChange(async (value) => {
                            this.agent.model = value;
                        });
                    });
                    new Notice(`Fetched ${models.length} models`);
                } catch (error) {
                    new Notice('Failed to fetch models: ' + error);
                    btn.setButtonText('Fetch Models');
                    btn.setDisabled(false);
                }
            }));

        // System Prompts Section
        contentEl.createEl('h3', { text: 'System Prompts' });

        const promptContainer = contentEl.createDiv('OChat-system-prompts');

        // Prompt Selector & Actions
        const promptControlDiv = promptContainer.createDiv('OChat-prompt-controls');
        promptControlDiv.style.display = 'flex';
        promptControlDiv.style.gap = '10px';
        promptControlDiv.style.marginBottom = '10px';
        promptControlDiv.style.alignItems = 'center';

        const promptSelect = promptControlDiv.createEl('select');
        promptSelect.className = 'dropdown';
        promptSelect.style.flexGrow = '1';

        const refreshPromptSelect = () => {
            promptSelect.empty();
            this.agent.systemPrompts.forEach(p => {
                const option = promptSelect.createEl('option');
                option.value = p.id;
                option.text = p.name;
                if (p.id === this.agent.activeSystemPromptId) option.selected = true;
            });
        };
        refreshPromptSelect();

        promptSelect.onchange = () => {
            this.agent.activeSystemPromptId = promptSelect.value;
            // Update textarea
            const activePrompt = this.agent.systemPrompts.find(p => p.id === this.agent.activeSystemPromptId);
            if (activePrompt && textAreaComponent) {
                textAreaComponent.setValue(activePrompt.content);
            }
        };

        // Add New Prompt Button
        const addBtn = new ButtonComponent(promptControlDiv)
            .setButtonText('+')
            .setTooltip('Add new system prompt')
            .onClick(() => {
                const newId = Date.now().toString();
                this.agent.systemPrompts.push({
                    id: newId,
                    name: 'New Prompt',
                    content: ''
                });
                this.agent.activeSystemPromptId = newId;
                refreshPromptSelect();
                // Trigger change to update textarea
                promptSelect.dispatchEvent(new Event('change'));
            });

        // Rename Prompt Button
        const renameBtn = new ButtonComponent(promptControlDiv)
            .setButtonText('✎')
            .setTooltip('Rename current prompt')
            .onClick(() => {
                const activePrompt = this.agent.systemPrompts.find(p => p.id === this.agent.activeSystemPromptId);
                if (activePrompt) {
                    new RenameModal(this.app, activePrompt.name, (newName) => {
                        activePrompt.name = newName;
                        refreshPromptSelect();
                    }).open();
                }
            });

        // Delete Prompt Button
        const deleteBtn = new ButtonComponent(promptControlDiv)
            .setButtonText('🗑')
            .setTooltip('Delete current prompt')
            .onClick(() => {
                if (this.agent.systemPrompts.length <= 1) {
                    new Notice('Cannot delete the last system prompt.');
                    return;
                }
                if (confirm('Delete this system prompt?')) {
                    const index = this.agent.systemPrompts.findIndex(p => p.id === this.agent.activeSystemPromptId);
                    this.agent.systemPrompts.splice(index, 1);
                    this.agent.activeSystemPromptId = this.agent.systemPrompts[0].id;
                    refreshPromptSelect();
                    promptSelect.dispatchEvent(new Event('change'));
                }
            });

        // Text Area for Content
        let textAreaComponent: any;
        new Setting(promptContainer)
            .setClass('OChat-full-width-textarea')
            .addTextArea(text => {
                textAreaComponent = text;
                const activePrompt = this.agent.systemPrompts.find(p => p.id === this.agent.activeSystemPromptId);
                text
                    .setValue(activePrompt ? activePrompt.content : '')
                    .setPlaceholder('You are a helpful assistant...')
                    .onChange(async (value) => {
                        const current = this.agent.systemPrompts.find(p => p.id === this.agent.activeSystemPromptId);
                        if (current) {
                            current.content = value;
                            // Sync legacy field for compatibility
                            this.agent.systemPrompt = value;
                        }
                    });
                text.inputEl.rows = 6;
                text.inputEl.style.width = '100%';
            });


        new Setting(contentEl)
            .setName('Temperature')
            .setDesc('Randomness (0-2)')
            .addSlider(slider => slider
                .setLimits(0, 2, 0.1)
                .setValue(this.agent.temperature)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.agent.temperature = value;
                }));

        new Setting(contentEl)
            .setName('Max Tokens')
            .setDesc('Maximum tokens to generate')
            .addText(text => text
                .setValue(String(this.agent.maxTokens))
                .onChange(async (value) => {
                    const num = parseInt(value);
                    if (!isNaN(num)) {
                        this.agent.maxTokens = num;
                    }
                }));

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('Save')
                .setCta()
                .onClick(() => {
                    // Final sync before save
                    const activePrompt = this.agent.systemPrompts.find(p => p.id === this.agent.activeSystemPromptId);
                    if (activePrompt) {
                        this.agent.systemPrompt = activePrompt.content;
                    }
                    this.onSave(this.agent);
                    this.close();
                }));
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
        contentEl.createEl('h2', { text: 'Rename' });

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
