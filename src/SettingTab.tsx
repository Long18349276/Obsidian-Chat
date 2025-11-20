import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import ObsidianVCPPlugin from './main';
import { AgentConfigModal } from './AgentConfigModal';
import { DEFAULT_AGENT, Agent } from './types';

export class OChatSettingTab extends PluginSettingTab {
    plugin: ObsidianVCPPlugin;

    constructor(app: App, plugin: ObsidianVCPPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'OChat Settings' });

        new Setting(containerEl)
            .setName('API Endpoint')
            .setDesc('OpenAI-compatible API endpoint URL')
            .addText(text => text
                .setPlaceholder('https://api.openai.com/v1/chat/completions')
                .setValue(this.plugin.settings.apiEndpoint)
                .onChange(async (value) => {
                    this.plugin.settings.apiEndpoint = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('API Key')
            .setDesc('Your API key')
            .addText(text => {
                text
                    .setPlaceholder('Enter your API key')
                    .setValue(this.plugin.settings.apiKey)
                    .onChange(async (value) => {
                        this.plugin.settings.apiKey = value;
                        await this.plugin.saveSettings();
                    });
                text.inputEl.type = 'password';
            });

        new Setting(containerEl)
            .setName('Topic Model')
            .setDesc('Model used for auto-naming topics')
            .addDropdown(async (dropdown) => {
                // Initial population with current value
                if (this.plugin.settings.topicModel) {
                    dropdown.addOption(this.plugin.settings.topicModel, this.plugin.settings.topicModel);
                    dropdown.setValue(this.plugin.settings.topicModel);
                }

                // Fetch models
                try {
                    const models = await this.plugin.apiClient.fetchModels();
                    // Clear only if we have new models, but keep current selection if possible
                    // Actually, dropdown.selectEl.empty() clears everything.
                    // Let's rebuild options.
                    dropdown.selectEl.empty();

                    models.forEach(m => dropdown.addOption(m, m));

                    // Ensure current setting is selected if it exists in fetched models, or keep it if not (custom)
                    if (models.includes(this.plugin.settings.topicModel)) {
                        dropdown.setValue(this.plugin.settings.topicModel);
                    } else if (this.plugin.settings.topicModel) {
                        // If current model is not in the list (maybe offline or custom), add it back
                        dropdown.addOption(this.plugin.settings.topicModel, this.plugin.settings.topicModel);
                        dropdown.setValue(this.plugin.settings.topicModel);
                    } else if (models.length > 0) {
                        // Default to first available if nothing selected
                        dropdown.setValue(models[0]);
                        this.plugin.settings.topicModel = models[0];
                        await this.plugin.saveSettings();
                    }
                } catch (e) {
                    console.error('Failed to fetch models for settings', e);
                }

                dropdown.onChange(async (value) => {
                    this.plugin.settings.topicModel = value;
                    await this.plugin.saveSettings();
                });
            });

        new Setting(containerEl)
            .setName('Auto Topic Naming')
            .setDesc('Automatically name topics based on conversation context')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoTopicNaming)
                .onChange(async (value) => {
                    this.plugin.settings.autoTopicNaming = value;
                    await this.plugin.saveSettings();
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Rename Recent 3 Chats')
            .setDesc('Manually trigger auto-naming for the 3 most recent conversations.')
            .addButton(btn => btn
                .setButtonText('Rename Recent')
                .onClick(async () => {
                    btn.setDisabled(true);
                    btn.setButtonText('Renaming...');
                    try {
                        const activeAgentId = this.plugin.settings.activeAgentId;
                        const chats = await this.plugin.chatStorage.getChatsByAgent(activeAgentId);
                        // Sort by updatedAt desc just in case, though getChatsByAgent usually returns sorted
                        chats.sort((a, b) => b.updatedAt - a.updatedAt);

                        const recentChats = chats.slice(0, 3);
                        for (const chat of recentChats) {
                            // We force rename even if manualTitle is set? User said "manually trigger", usually implies override or force.
                            // But let's respect manualTitle to be safe, unless user explicitly wants to overwrite.
                            // The user said "re-rename", implying they want to update them.
                            // Let's assume if they click this, they want to run the logic.
                            // But generateChatTitle respects manualTitle.
                            // Let's temporarily unset manualTitle or pass a flag?
                            // generateChatTitle checks !chat.manualTitle.
                            // If user wants to force it, we might need to bypass that check.
                            // But for now, let's just call it. If they manually named it, maybe they don't want it overwritten.
                            await this.plugin.generateChatTitle(chat, true);
                        }
                        new Notice('Renamed recent chats.');
                    } catch (e) {
                        new Notice('Failed to rename chats.');
                        console.error(e);
                    } finally {
                        btn.setDisabled(false);
                        btn.setButtonText('Rename Recent');
                    }
                }));

        new Setting(containerEl)
            .setName('Export Path')
            .setDesc('Folder path to export conversations to (relative to vault root)')
            .addText(text => text
                .setPlaceholder('OChat_Exports')
                .setValue(this.plugin.settings.exportPath)
                .onChange(async (value) => {
                    this.plugin.settings.exportPath = value;
                    await this.plugin.saveSettings();
                }));

        containerEl.createEl('h3', { text: 'Agents' });
        containerEl.createEl('p', { text: 'Configure different AI agents with specific models and prompts.' });

        const agentsContainer = containerEl.createDiv('OChat-agents-list');

        this.plugin.settings.agents.forEach((agent, index) => {
            const setting = new Setting(agentsContainer)
                .setName(agent.name)
                .setDesc(`${agent.model} • ${agent.systemPrompt.substring(0, 50)}...`);

            setting.addButton(btn => btn
                .setButtonText('Edit')
                .onClick(() => {
                    new AgentConfigModal(this.app, agent, this.plugin.apiClient, async (savedAgent) => {
                        this.plugin.settings.agents[index] = savedAgent;
                        if (this.plugin.settings.activeAgentId === agent.id) {
                            // Refresh view if active agent was edited
                            // We can't easily reach the view from here, but next time it renders it will be updated
                        }
                        await this.plugin.saveSettings();
                        this.display(); // Refresh settings view
                    }).open();
                }));

            setting.addButton(btn => btn
                .setButtonText('Delete')
                .setWarning()
                .setDisabled(this.plugin.settings.agents.length <= 1) // Prevent deleting the last agent
                .onClick(async () => {
                    if (confirm(`Are you sure you want to delete agent "${agent.name}"?`)) {
                        this.plugin.settings.agents.splice(index, 1);
                        // If we deleted the active agent, switch to the first one
                        if (this.plugin.settings.activeAgentId === agent.id) {
                            this.plugin.settings.activeAgentId = this.plugin.settings.agents[0].id;
                        }
                        await this.plugin.saveSettings();
                        this.display();
                    }
                }));
        });

        new Setting(containerEl)
            .addButton(btn => btn
                .setButtonText('Add New Agent')
                .setCta()
                .onClick(() => {
                    const newAgent: Agent = {
                        ...DEFAULT_AGENT,
                        id: Date.now().toString(),
                        name: 'New Agent',
                    };
                    new AgentConfigModal(this.app, newAgent, this.plugin.apiClient, async (savedAgent) => {
                        this.plugin.settings.agents.push(savedAgent);
                        await this.plugin.saveSettings();
                        this.display();
                    }).open();
                }));

        containerEl.createEl('h3', { text: 'Regex Replacements' });
        containerEl.createEl('p', { text: 'Define regex rules to replace or remove text in chat messages.' });

        const regexContainer = containerEl.createDiv('OChat-regex-list');

        // List existing rules
        this.plugin.settings.regexRules.forEach((rule, index) => {
            const ruleSetting = new Setting(regexContainer)
                .setName(`Rule ${index + 1}`)
                .setDesc(`/${rule.pattern}/${rule.flags || 'g'} -> "${rule.replacement}" [${rule.scope}]`);

            ruleSetting.addButton(btn => btn
                .setButtonText('Delete')
                .setWarning()
                .onClick(async () => {
                    this.plugin.settings.regexRules.splice(index, 1);
                    await this.plugin.saveSettings();
                    this.display();
                }));
        });

        // Add new rule
        const newRuleContainer = containerEl.createDiv('OChat-new-rule-container');
        newRuleContainer.style.borderTop = '1px solid var(--background-modifier-border)';
        newRuleContainer.style.paddingTop = '10px';
        newRuleContainer.style.marginTop = '10px';

        let newPattern = '';
        let newReplacement = '';
        let newScope: 'display' | 'request' | 'both' = 'display';

        new Setting(newRuleContainer)
            .setName('New Rule Pattern')
            .setDesc('Regex pattern to match')
            .addText(text => text
                .setPlaceholder('e.g. \\bfoo\\b')
                .onChange(value => newPattern = value));

        new Setting(newRuleContainer)
            .setName('Replacement')
            .setDesc('Text to replace with (leave empty to remove)')
            .addText(text => text
                .setPlaceholder('Replacement text')
                .onChange(value => newReplacement = value));

        new Setting(newRuleContainer)
            .setName('Scope')
            .setDesc('Where to apply this rule')
            .addDropdown(dropdown => dropdown
                .addOption('display', 'Display Only')
                .addOption('request', 'Request Only')
                .addOption('both', 'Both')
                .setValue('display')
                .onChange((value: any) => newScope = value));

        new Setting(newRuleContainer)
            .addButton(btn => btn
                .setButtonText('Add Rule')
                .setCta()
                .onClick(async () => {
                    if (!newPattern) {
                        new Notice('Pattern is required');
                        return;
                    }
                    this.plugin.settings.regexRules.push({
                        pattern: newPattern,
                        replacement: newReplacement,
                        flags: 'g',
                        scope: newScope
                    });
                    await this.plugin.saveSettings();
                    this.display();
                }));
    }
}
