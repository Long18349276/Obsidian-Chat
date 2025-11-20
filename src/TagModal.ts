import { App, Modal, Setting } from 'obsidian';

export class TagModal extends Modal {
    private tags: string[];
    private onSubmit: (tags: string[]) => void;

    constructor(app: App, currentTags: string[] | undefined, onSubmit: (tags: string[]) => void) {
        super(app);
        this.tags = currentTags ? [...currentTags] : [];
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: 'Manage Tags' });

        const tagContainer = contentEl.createDiv({ cls: 'OChat-tag-container' });
        this.renderTags(tagContainer);

        let newTag = '';

        new Setting(contentEl)
            .setName('Add Tag')
            .addText(text => text
                .setPlaceholder('Enter tag name')
                .onChange(value => newTag = value)
                .inputEl.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' && newTag.trim()) {
                        if (!this.tags.includes(newTag.trim())) {
                            this.tags.push(newTag.trim());
                            this.renderTags(tagContainer);
                            text.setValue('');
                            newTag = '';
                        }
                    }
                }))
            .addButton(btn => btn
                .setButtonText('Add')
                .onClick(() => {
                    if (newTag.trim() && !this.tags.includes(newTag.trim())) {
                        this.tags.push(newTag.trim());
                        this.renderTags(tagContainer);
                        // Clear input - simpler to just re-render or clear manually if we had ref
                        // But Setting doesn't give easy access to clear without rebuilding or keeping ref.
                        // Let's just rely on the renderTags update or simple rebuild.
                        // Actually, let's just close and reopen or better, use React? No, stick to Obsidian API for modals.
                        // We can clear the input by finding it.
                        const input = contentEl.querySelector('input[type="text"]') as HTMLInputElement;
                        if (input) input.value = '';
                        newTag = '';
                    }
                }));

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('Save')
                .setCta()
                .onClick(() => {
                    this.onSubmit(this.tags);
                    this.close();
                }))
            .addButton(btn => btn
                .setButtonText('Cancel')
                .onClick(() => this.close()));
    }

    private renderTags(container: HTMLElement) {
        container.empty();
        container.style.display = 'flex';
        container.style.flexWrap = 'wrap';
        container.style.gap = '5px';
        container.style.marginBottom = '15px';

        this.tags.forEach(tag => {
            const tagEl = container.createDiv({ cls: 'OChat-tag-chip' });
            tagEl.style.backgroundColor = 'var(--interactive-accent)';
            tagEl.style.color = 'var(--text-on-accent)';
            tagEl.style.padding = '2px 8px';
            tagEl.style.borderRadius = '10px';
            tagEl.style.fontSize = '0.9em';
            tagEl.style.display = 'flex';
            tagEl.style.alignItems = 'center';
            tagEl.style.gap = '5px';

            tagEl.createSpan({ text: tag });

            const removeBtn = tagEl.createEl('span', { text: '×' });
            removeBtn.style.cursor = 'pointer';
            removeBtn.style.fontWeight = 'bold';
            removeBtn.onclick = () => {
                this.tags = this.tags.filter(t => t !== tag);
                this.renderTags(container);
            };
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
