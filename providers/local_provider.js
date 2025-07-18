const BaseLLMProvider = require('./base_provider');

/**
 * Local LLM Provider Implementation (Ollama, LM Studio, etc.)
 */
class LocalProvider extends BaseLLMProvider {
    constructor(config) {
        super({
            name: 'local',
            baseUrl: config.baseUrl || 'http://localhost:11434/api/generate',
            ...config
        });
        this.model = config.model || 'llama2';
        this.stream = config.stream || false;
        this.providerType = config.providerType || 'ollama'; // ollama, lmstudio, etc.
    }

    async generateResponse(prompt, options = {}) {
        const endpoint = this.getEndpoint();
        const payload = this.buildPayload(prompt, options);

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error(`Local Provider API error: ${response.status} - ${response.statusText}`);
            }

            const data = await response.json();
            return this.formatResponse(data);
        } catch (error) {
            throw new Error(`Local Provider Error: ${error.message}`);
        }
    }

    getEndpoint() {
        switch (this.providerType) {
            case 'ollama':
                return `${this.baseUrl}/api/generate`;
            case 'lmstudio':
                return `${this.baseUrl}/v1/chat/completions`;
            case 'textgeneration':
                return `${this.baseUrl}/v1/completions`;
            default:
                return this.baseUrl;
        }
    }

    buildPayload(prompt, options) {
        const basePayload = {
            model: this.model,
            stream: this.stream
        };

        switch (this.providerType) {
            case 'ollama':
                return {
                    ...basePayload,
                    prompt: prompt,
                    options: {
                        temperature: options.temperature || this.temperature,
                        num_predict: options.maxTokens || this.maxTokens
                    }
                };
            
            case 'lmstudio':
                return {
                    model: this.model,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: options.temperature || this.temperature,
                    max_tokens: options.maxTokens || this.maxTokens,
                    stream: false
                };
            
            case 'textgeneration':
                return {
                    model: this.model,
                    prompt: prompt,
                    temperature: options.temperature || this.temperature,
                    max_tokens: options.maxTokens || this.maxTokens
                };
            
            default:
                return {
                    ...basePayload,
                    prompt: prompt,
                    temperature: options.temperature || this.temperature,
                    max_tokens: options.maxTokens || this.maxTokens
                };
        }
    }

    extractContent(response) {
        switch (this.providerType) {
            case 'ollama':
                return response.response || 'No response content';
            case 'lmstudio':
                return response.choices && response.choices[0] && response.choices[0].message
                    ? response.choices[0].message.content
                    : 'No response content';
            case 'textgeneration':
                return response.choices && response.choices[0]
                    ? response.choices[0].text
                    : 'No response content';
            default:
                return response.text || response.response || 'No response content';
        }
    }

    extractTokenUsage(response) {
        // Local providers often don't provide detailed token usage
        // Estimate based on content length if not available
        const content = this.extractContent(response);
        const estimatedTokens = Math.ceil(content.length / 4); // Rough estimation
        
        return {
            input_tokens: response.prompt_eval_count || 0,
            output_tokens: response.eval_count || estimatedTokens,
            total_tokens: (response.prompt_eval_count || 0) + (response.eval_count || estimatedTokens)
        };
    }

    calculateCost(response) {
        // Local providers are typically free to run
        return {
            input_cost: 0,
            output_cost: 0,
            total_cost: 0,
            note: 'Local provider - no API costs'
        };
    }

    getModel() {
        return this.model;
    }

    // Override validation since local providers don't need API keys
    validateConfig() {
        if (!this.baseUrl) {
            throw new Error(`Base URL required for ${this.name} provider`);
        }
        // API key not required for local providers
    }
}

module.exports = LocalProvider;
