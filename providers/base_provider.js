/**
 * Base LLM Provider Abstract Class
 * Defines the interface that all LLM providers must implement
 */
class BaseLLMProvider {
    constructor(config) {
        this.name = config.name;
        this.apiKey = config.apiKey;
        this.baseUrl = config.baseUrl;
        this.maxTokens = config.maxTokens || 1000;
        this.temperature = config.temperature || 0.7;
        this.timeout = config.timeout || 30000;
    }

    /**
     * Must be implemented by each provider
     * @param {string} prompt - The processed prompt
     * @param {Object} options - Additional options
     * @returns {Promise<Object>} - Standardized response
     */
    async generateResponse(prompt, options = {}) {
        throw new Error('generateResponse must be implemented by subclass');
    }

    /**
     * Standardizes response format across all providers
     */
    formatResponse(rawResponse) {
        return {
            provider: this.name,
            content: this.extractContent(rawResponse),
            metadata: {
                model: this.getModel(),
                tokens_used: this.extractTokenUsage(rawResponse),
                processing_time: new Date().toISOString(),
                cost_estimate: this.calculateCost(rawResponse)
            },
            raw_response: rawResponse
        };
    }

    // Abstract methods that must be implemented
    extractContent(response) { throw new Error('extractContent must be implemented'); }
    extractTokenUsage(response) { throw new Error('extractTokenUsage must be implemented'); }
    calculateCost(response) { throw new Error('calculateCost must be implemented'); }
    getModel() { throw new Error('getModel must be implemented'); }

    validateConfig() {
        if (!this.apiKey) throw new Error(`API key required for ${this.name} provider`);
        if (!this.baseUrl) throw new Error(`Base URL required for ${this.name} provider`);
    }
}

module.exports = BaseLLMProvider;
