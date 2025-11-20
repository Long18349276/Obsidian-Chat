import { App, Modal, TextAreaComponent, ButtonComponent } from 'obsidian';

export class EditMessageModal extends Modal {
    private content: string;
    private onSave: (newContent: string) => void;

    constructor(app: App, content: string, onSave: (newContent: string) => void) {
        super(app);
        this.content = content;
        this.onSave = onSave;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: 'Edit Message' });

        const container = contentEl.createDiv({ cls: 'OChat-edit-modal-container' });

        const textArea = new TextAreaComponent(container);
        textArea.inputEl.style.width = '100%';
        textArea.inputEl.style.height = '300px';
        textArea.inputEl.style.resize = 'vertical';
        textArea.inputEl.style.fontFamily = 'var(--font-monospace)';
        textArea.setValue(this.content);
        textArea.onChange((value) => {
            this.content = value;
        });

        const buttonContainer = contentEl.createDiv({ cls: 'OChat-modal-buttons' });
        buttonContainer.style.display = 'flex';
        buttonContainer.style.justifyContent = 'flex-end';
        buttonContainer.style.marginTop = '10px';
        buttonContainer.style.gap = '10px';

        new ButtonComponent(buttonContainer)
            .setButtonText('Save')
            .setCta()
            .onClick(() => {
                this.onSave(this.content);
                this.close();
            });

        new ButtonComponent(buttonContainer)
            .setButtonText('Cancel')
            .onClick(() => this.close());
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
