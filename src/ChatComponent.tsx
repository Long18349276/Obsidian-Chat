import React, { useState, useRef, useEffect } from 'react';
import { Chat, Message, Agent, RegexRule } from './types';
import { setIcon, MarkdownRenderer, TFile, App } from 'obsidian';

interface ChatComponentProps {
    app: App;
    chat: Chat | null;
    activeAgent: Agent;
    agents: Agent[];
    onSendMessage: (content: string) => void;
    onNewChat: () => void;
    onAgentChange: (agentId: string) => void;
    onEditAgent: () => void;
    onShowHistory: () => void;
    onDeleteMessage: (index: number) => void;
    onRegenerate: (index: number) => void;
    onEditMessage: (index: number, content: string) => void;
    isLoading: boolean;
    onGetActiveNote: () => Promise<{ name: string; content: string } | null>;
    onBranch: (index: number) => void;
    onExport: () => void;
    onAddTag: () => void;
    regexRules: RegexRule[];
    onStop: () => void;
}

interface CitedNote {
    name: string;
    content: string;
}

const MarkdownMessage: React.FC<{ content: string; app: App }> = ({ content, app }) => {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (containerRef.current) {
            containerRef.current.innerHTML = '';
            MarkdownRenderer.render(
                app,
                content,
                containerRef.current,
                '/',
                new (class extends React.Component { render() { return null; } } as any)() // Mock component for lifecycle
            );
        }
    }, [content, app]);

    return <div ref={containerRef} className="OChat-markdown-content" />;
};

export const ChatComponent: React.FC<ChatComponentProps> = ({
    app,
    chat,
    activeAgent,
    agents,
    onSendMessage,
    onNewChat,
    onAgentChange,
    onEditAgent,
    onShowHistory,
    onDeleteMessage,
    onRegenerate,
    onEditMessage,
    isLoading,
    onGetActiveNote,
    onBranch,
    onExport,
    onAddTag,
    regexRules,
    onStop
}) => {
    const [input, setInput] = useState('');
    const [citedNotes, setCitedNotes] = useState<CitedNote[]>([]);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [chat?.messages, isLoading]);

    // Focus input on mount
    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if ((!input.trim() && citedNotes.length === 0) || isLoading) return;

        let finalContent = input;

        if (citedNotes.length > 0) {
            const citedContent = citedNotes.map(note =>
                `<<<[CITED_NOTE: ${note.name}]>>>\n${note.content}\n<<<[END_CITED_NOTE]>>>`
            ).join('\n\n');

            if (finalContent.trim()) {
                finalContent += '\n\n';
            }
            finalContent += citedContent;
        }

        onSendMessage(finalContent);
        setInput('');
        setCitedNotes([]);
    };

    const handleCiteNote = async () => {
        const note = await onGetActiveNote();
        if (note) {
            setCitedNotes(prev => {
                if (prev.some(n => n.name === note.name)) return prev;
                return [...prev, note];
            });
        }
    };

    const removeCitedNote = (name: string) => {
        setCitedNotes(prev => prev.filter(n => n.name !== name));
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        // Ctrl+Enter or Cmd+Enter to send
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            handleSubmit(e);
        }
    };

    const handleCopy = (text: string) => {
        navigator.clipboard.writeText(text);
    };

    const applyDisplayRules = (content: string): string => {
        let processedContent = content;
        regexRules.forEach(rule => {
            if (rule.scope === 'display' || rule.scope === 'both') {
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

    const renderMessageContent = (rawContent: string) => {
        const content = applyDisplayRules(rawContent);
        const toolRequestRegex = /<<<\[TOOL_REQUEST\]>>>([\s\S]*?)<<<\[END_TOOL_REQUEST\]>>>/g;
        const citedNoteRegex = /<<<\[CITED_NOTE: (.*?)\]>>>([\s\S]*?)<<<\[END_CITED_NOTE\]>>>/g;

        const parts: React.ReactNode[] = [];
        let lastIndex = 0;

        const matches: { index: number; length: number; type: 'tool' | 'note'; match: RegExpExecArray }[] = [];

        let match;
        while ((match = toolRequestRegex.exec(content)) !== null) {
            matches.push({ index: match.index, length: match[0].length, type: 'tool', match });
        }

        while ((match = citedNoteRegex.exec(content)) !== null) {
            matches.push({ index: match.index, length: match[0].length, type: 'note', match });
        }

        matches.sort((a, b) => a.index - b.index);

        for (const m of matches) {
            if (m.index > lastIndex) {
                parts.push(
                    <MarkdownMessage
                        key={`text-${lastIndex}`}
                        content={content.substring(lastIndex, m.index)}
                        app={app}
                    />
                );
            }

            if (m.type === 'tool') {
                const requestBody = m.match[1];
                const toolNameMatch = requestBody.match(/tool_name:「始」(.*?)「末」/);
                const agentNameMatch = requestBody.match(/agent_name:「始」(.*?)「末」/);

                const toolName = toolNameMatch ? toolNameMatch[1] : 'Unknown Tool';
                const agentName = agentNameMatch ? agentNameMatch[1] : null;

                parts.push(
                    <details key={`tool-${m.index}`} className="OChat-tool-request">
                        <summary>
                            <span className="OChat-tool-icon">🛠️</span>
                            <span className="OChat-tool-name">Used Tool: {toolName}</span>
                            {agentName && (
                                <span className="OChat-agent-name"> ({agentName})</span>
                            )}
                        </summary>
                        <div className="OChat-tool-request-content">
                            <div className="OChat-tool-field">
                                <pre>{requestBody.trim()}</pre>
                            </div>
                        </div>
                    </details>
                );
            } else {
                const fileName = m.match[1];
                parts.push(
                    <div key={`note-${m.index}`} className="OChat-cited-note-chip">
                        <span className="OChat-note-icon">📄</span>
                        <span className="OChat-note-name">{fileName}</span>
                    </div>
                );
            }

            lastIndex = m.index + m.length;
        }

        if (lastIndex < content.length) {
            parts.push(
                <MarkdownMessage
                    key={`text-${lastIndex}`}
                    content={content.substring(lastIndex)}
                    app={app}
                />
            );
        }

        return parts;
    };


    return (
        <div className="OChat-chat-container">
            <div className="OChat-toolbar">
                <select
                    className="dropdown"
                    value={activeAgent.id}
                    onChange={(e) => onAgentChange(e.target.value)}
                    style={{ maxWidth: '150px' }}
                >
                    {agents.map(agent => (
                        <option key={agent.id} value={agent.id}>
                            {agent.name}
                        </option>
                    ))}
                </select>

                <button
                    className="OChat-toolbar-button"
                    onClick={onEditAgent}
                    title="Edit Agent"
                >
                    <span className="OChat-icon">⚙️</span>
                </button>

                <button
                    className="OChat-toolbar-button"
                    onClick={onShowHistory}
                    title="Chat History"
                >
                    <span className="OChat-icon">🕒</span>
                </button>

                <button
                    className="OChat-toolbar-button"
                    onClick={onAddTag}
                    title="Tags"
                >
                    <span className="OChat-icon">🏷️</span>
                </button>

                <button
                    className="OChat-toolbar-button"
                    onClick={onNewChat}
                    title="New Chat"
                >
                    <span className="OChat-icon">➕</span>
                </button>

                <button
                    className="OChat-toolbar-button"
                    onClick={onExport}
                    title="Export Chats"
                >
                    <span className="OChat-icon">📤</span>
                </button>
            </div>

            <div className="OChat-messages">
                {chat?.messages.map((msg, index) => (
                    <div
                        key={index}
                        className={`OChat-message-container ${msg.role}`}
                    >
                        <div className={`OChat-message OChat-message-${msg.role}`}>
                            <div className="OChat-message-role">
                                {msg.role === 'user' ? 'Zeta' : activeAgent.name}
                            </div>
                            {renderMessageContent(msg.content)}
                        </div>
                        <div className="OChat-message-actions">
                            <button
                                className="OChat-action-button"
                                onClick={() => handleCopy(msg.content)}
                                title="Copy"
                            >
                                📋
                            </button>
                            <button
                                className="OChat-action-button"
                                onClick={() => onRegenerate(index)}
                                title="Regenerate"
                            >
                                🔄
                            </button>
                            <button
                                className="OChat-action-button"
                                onClick={() => onEditMessage(index, msg.content)}
                                title="Edit"
                            >
                                ✎
                            </button>
                            <button
                                className="OChat-action-button"
                                onClick={() => onBranch(index)}
                                title="Branch Conversation"
                            >
                                🌿
                            </button>
                            <button
                                className="OChat-action-button"
                                onClick={() => onDeleteMessage(index)}
                                title="Delete"
                            >
                                🗑️
                            </button>
                        </div>
                    </div>
                ))}
                {isLoading && (
                    <div className="OChat-loading">
                        <div className="OChat-loading-dot"></div>
                        <div className="OChat-loading-dot"></div>
                        <div className="OChat-loading-dot"></div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            <div className="OChat-input-area">
                {citedNotes.length > 0 && (
                    <div className="OChat-cited-notes-container">
                        {citedNotes.map((note, i) => (
                            <div key={i} className="OChat-cited-note-chip">
                                <span className="OChat-note-name">{note.name}</span>
                                <button
                                    className="OChat-remove-note-button"
                                    onClick={() => removeCitedNote(note.name)}
                                >
                                    ×
                                </button>
                            </div>
                        ))}
                    </div>
                )}
                <form onSubmit={handleSubmit} className="OChat-input-container">
                    <div className="OChat-input-wrapper">
                        <textarea
                            ref={inputRef}
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder={`Message ${activeAgent.name}... (Ctrl+Enter to send)`}
                            className="OChat-input"
                            disabled={isLoading}
                            rows={1}
                        />
                        <button
                            type="button"
                            className="OChat-cite-button"
                            onClick={handleCiteNote}
                            title="Cite Current Note"
                            disabled={isLoading}
                        >
                            Cite
                        </button>
                    </div>
                    <button
                        type="submit"
                        className="OChat-send-button"
                        disabled={isLoading || (!input.trim() && citedNotes.length === 0)}
                        style={{ display: isLoading ? 'none' : 'block' }}
                    >
                        Send
                    </button>
                    {isLoading && (
                        <button
                            type="button"
                            className="OChat-send-button OChat-stop-button"
                            onClick={onStop}
                            style={{ backgroundColor: '#d04255' }}
                        >
                            Stop
                        </button>
                    )}
                </form>
            </div>
        </div>
    );
};
