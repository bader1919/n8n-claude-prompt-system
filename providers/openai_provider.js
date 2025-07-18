const BaseLLMProvider = require('./base_provider');

/**
 * OpenAI Provider Implementation
 */
class OpenAIProvider extends BaseLLMProvider {
    constructor(config) {
        super({
            name: 'openai',
            baseUrl: 'https://api.openai.com/v1/chat/completions',
            ...config
        });
        this.model = config.model || 'gpt-4';
        this.organization = config.organization;
    }

    async generateResponse(prompt, options = {}) {
        const headers = {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
        };

        if (this.organization) {
            headers['OpenAI-Organization'] = this.organization;
        }

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
                const errorData = await response.json();
                throw new Error(`OpenAI API error: ${response.status} - ${errorData.error?.message || response.statusText}`);
            }

            const data = await response.json();
            return this.formatResponse(data);
        } catch (error) {
            throw new Error(`OpenAI Provider Error: ${error.message}`);
        }
    }

    extractContent(response) {
        return response.choices && response.choices[0] && response.choices[0].message
            ? response.choices[0].message.content
            : 'No response content';
    }

    extractTokenUsage(response) {
        return {
            input_tokens: response.usage?.prompt_tokens || 0,
            output_tokens: response.usage?.completion_tokens || 0,
            total_tokens: response.usage?.total_tokens || 0
        };
    }

    calculateCost(response) {
        const usage = this.extractTokenUsage(response);
        
        // GPT-4 pricing (approximate)
        let inputCostPer1K, outputCostPer1K;
        
        if (this.model.includes('gpt-4o')) {
            inputCostPer1K = 0.005;
            outputCostPer1K = 0.015;
        } else if (this.model.includes('gpt-4-turbo')) {
            inputCostPer1K = 0.01;
            outputCostPer1K = 0.03;
        } else if (this.model.includes('gpt-4')) {
            inputCostPer1K = 0.03;
            outputCostPer1K = 0.06;
        } else if (this.model.includes('gpt-3.5-turbo')) {
            inputCostPer1K = 0.001;
            outputCostPer1K = 0.002;
        } else {
            // Default fallback
            inputCostPer1K = 0.01;
            outputCostPer1K = 0.03;
        }
        
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

module.exports = OpenAIProvider;
