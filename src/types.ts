// Message types following OpenAI format
export interface Message {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

// Agent configuration
export interface Agent {
    id: string;
    name: string;
    model: string;
    systemPrompt: string; // Kept for backward compatibility/API usage
    systemPrompts: { id: string; name: string; content: string }[];
    activeSystemPromptId: string;
    temperature: number;
    maxTokens: number;
}

// Chat session
export interface Chat {
    id: string;
    agentId: string; // Linked agent ID
    title: string;
    manualTitle?: boolean; // If true, auto-naming will be skipped
    tags?: string[]; // Custom tags for the conversation
    createdAt: number;
    updatedAt: number;
    messages: Message[];
}

// Plugin settings
export interface RegexRule {
    pattern: string;
    replacement: string;
    flags?: string; // default 'g'
    scope: 'display' | 'request' | 'both';
}

export interface OChatSettings {
    apiEndpoint: string;
    apiKey: string;
    agents: Agent[];
    activeAgentId: string;
    topicModel: string;
    autoTopicNaming: boolean;
    exportPath: string; // Path to export conversations
    regexRules: RegexRule[];
}

export const DEFAULT_AGENT: Agent = {
    id: 'default',
    name: 'Default Agent',
    model: '',
    systemPrompt: '你是一个AI助手，生活在Obsidian中。',
    systemPrompts: [{ id: 'default', name: 'Default', content: '你是一个AI助手，生活在Obsidian中。' }],
    activeSystemPromptId: 'default',
    temperature: 0.7,
    maxTokens: 30000,
};

export const DEFAULT_SETTINGS: OChatSettings = {
    apiEndpoint: '',
    apiKey: '',
    agents: [DEFAULT_AGENT],
    activeAgentId: 'default',
    topicModel: '',
    autoTopicNaming: false,
    exportPath: 'OChat_Exports',
    regexRules: [],
};

// OpenAI API request format
export interface OpenAIRequest {
    model: string;
    messages: Message[];
    temperature?: number;
    max_tokens?: number;
    stream?: boolean;
}

// OpenAI API response format (streaming)
export interface OpenAIStreamChunk {
    choices: Array<{
        delta: {
            content?: string;
        };
        finish_reason?: string | null;
    }>;
}

// OpenAI Models API response
export interface OpenAIModelsResponse {
    data: Array<{
        id: string;
        object: string;
        created: number;
        owned_by: string;
    }>;
}
