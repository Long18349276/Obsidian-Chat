import { OChatSettings, Message, OpenAIRequest, OpenAIStreamChunk, Agent } from './types';

export class OpenAIClient {
    private settings: OChatSettings;

    constructor(settings: OChatSettings) {
        this.settings = settings;
    }

    updateSettings(settings: OChatSettings) {
        this.settings = settings;
    }

    async fetchModels(): Promise<string[]> {
        try {
            // Remove /chat/completions from the endpoint to get the base URL
            // Then append /models
            // This is a heuristic, might need adjustment for some providers
            const baseUrl = this.settings.apiEndpoint.replace(/\/chat\/completions\/?$/, '');
            const modelsUrl = `${baseUrl}/models`;

            console.log('[OChat] Fetching models from:', modelsUrl);

            const response = await fetch(modelsUrl, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.settings.apiKey}`,
                },
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            // Handle both standard OpenAI format { data: [...] } and simple array if any
            const models = Array.isArray(data.data) ? data.data : (Array.isArray(data) ? data : []);

            return models.map((m: any) => m.id).sort();
        } catch (error) {
            console.error('[OChat] Failed to fetch models:', error);
            throw error;
        }
    }

    async sendMessage(
        agent: Agent,
        messages: Message[],
        onChunk: (content: string) => void,
        signal?: AbortSignal
    ): Promise<void> {
        const request: OpenAIRequest = {
            model: agent.model,
            messages: messages,
            temperature: agent.temperature,
            max_tokens: agent.maxTokens,
            stream: true,
        };

        console.log('[OChat] Sending request to:', this.settings.apiEndpoint);
        console.log('[OChat] Request payload:', JSON.stringify(request, null, 2));

        try {
            // Normalize endpoint: if it ends with /v1 or /v1/, append /chat/completions
            let fetchUrl = this.settings.apiEndpoint;
            if (fetchUrl.endsWith('/v1') || fetchUrl.endsWith('/v1/')) {
                fetchUrl = fetchUrl.replace(/\/$/, '') + '/chat/completions';
                console.log('[OChat] Normalized endpoint to:', fetchUrl);
            }

            const response = await fetch(fetchUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.settings.apiKey}`,
                },
                body: JSON.stringify(request),
                signal: signal,
            });

            console.log('[OChat] Response status:', response.status, response.statusText);

            if (!response.ok) {
                const errorText = await response.text();
                console.error('[OChat] API error response:', errorText);

                let errorMessage = `API 请求失败 (${response.status})`;

                try {
                    const errorJson = JSON.parse(errorText);
                    if (errorJson.error?.message) {
                        errorMessage += `: ${errorJson.error.message}`;
                    } else {
                        errorMessage += `: ${errorText}`;
                    }
                } catch {
                    errorMessage += `: ${errorText}`;
                }

                throw new Error(errorMessage);
            }

            const reader = response.body?.getReader();
            if (!reader) {
                throw new Error('无法获取响应流');
            }

            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.trim() === '') continue;
                    if (line.trim() === 'data: [DONE]') continue;
                    if (!line.startsWith('data: ')) continue;

                    try {
                        const jsonStr = line.substring(6);
                        const chunk: OpenAIStreamChunk = JSON.parse(jsonStr);

                        // Safety check for providers like ModelScope that might send choices: null
                        if (!chunk.choices || !Array.isArray(chunk.choices) || chunk.choices.length === 0) {
                            continue;
                        }

                        const content = chunk.choices[0]?.delta?.content;
                        if (content) {
                            onChunk(content);
                        }
                    } catch (error) {
                        console.error('[OChat] Failed to parse chunk:', error, line);
                    }
                }
            }

            console.log('[OChat] Stream completed successfully');

        } catch (error) {
            console.error('[OChat] Request failed:', error);

            if (error instanceof TypeError && error.message.includes('fetch')) {
                throw new Error(`网络连接失败。请检查：\n1. API 地址是否正确\n2. 本地服务是否已启动\n3. 是否需要使用 HTTP 而非 HTTPS\n\n原始错误: ${error.message}`);
            }

            if (error.name === 'AbortError') {
                console.log('[OChat] Request aborted by user');
                return;
            }

            throw error;
        }
    }
}
