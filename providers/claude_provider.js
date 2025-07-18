const BaseLLMProvider = require('./base_provider');

/**
 * Anthropic Claude Provider Implementation
 */
class ClaudeProvider extends BaseLLMProvider {
    constructor(config) {
        super({
            name: 'claude',
            baseUrl: 'https://api.anthropic.com/v1/messages',
            ...config
        });
        this.model = config.model || 'claude-sonnet-4-20250514';
        this.anthropicVersion = config.anthropicVersion || '2023-06-01';
    }

    async generateResponse(prompt, options = {}) {
        const headers = {
            'x-api-key': this.apiKey,
            'anthropic-version': this.anthropicVersion,
            'content-type': 'application/json'
        };

        const payload = {
            model: this.model,
            max_tokens: options.maxTokens || this.maxTokens,
            temperature: options.temperature || this.temperature,
            messages: [
                {
                    role: 'user',
                    content: prompt
                }
            ]
        };

        try {
            const response = await fetch(this.baseUrl, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error(`Claude API error: ${response.status} - ${response.statusText}`);
            }

            const data = await response.json();
            return this.formatResponse(data);
        } catch (error) {
            throw new Error(`Claude Provider Error: ${error.message}`);
        }
    }

    extractContent(response) {
        return response.content && response.content[0] 
            ? response.content[0].text 
            : 'No response content';
    }

    extractTokenUsage(response) {
        return {
            input_tokens: response.usage?.input_tokens || 0,
            output_tokens: response.usage?.output_tokens || 0,
            total_tokens: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0)
        };
    }

    calculateCost(response) {
        const usage = this.extractTokenUsage(response);
        // Claude Sonnet 4 pricing (approximate)
        const inputCostPer1K = 0.003;
        const outputCostPer1K = 0.015;
        
        return {
            input_cost: (usage.input_tokens / 1000) * inputCostPer1K,
            output_cost: (usage.output_tokens / 1000) * outputCostPer1K,
            total_cost: ((usage.input_tokens / 1000) * inputCostPer1K) + 
                       ((usage.output_tokens / 1000) * outputCostPer1K)
        };
    }

    getModel() {
        return this.model;
    }
}

module.exports = ClaudeProvider;
