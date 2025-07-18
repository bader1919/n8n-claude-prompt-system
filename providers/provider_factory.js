const ClaudeProvider = require('./claude_provider');
const OpenAIProvider = require('./openai_provider');
const LocalProvider = require('./local_provider');

/**
 * Factory for creating LLM providers
 */
class ProviderFactory {
    static providers = {
        'claude': ClaudeProvider,
        'openai': OpenAIProvider,
        'local': LocalProvider
    };

    static supportedProviders = Object.keys(ProviderFactory.providers);

    /**
     * Create a provider instance
     * @param {string} providerName - Name of the provider
     * @param {Object} config - Provider configuration
     * @returns {BaseLLMProvider} - Provider instance
     */
    static createProvider(providerName, config) {
        const normalizedName = providerName.toLowerCase();
        
        if (!ProviderFactory.providers[normalizedName]) {
            throw new Error(`Unsupported provider: ${providerName}. Supported providers: ${ProviderFactory.supportedProviders.join(', ')}`);
        }

        const ProviderClass = ProviderFactory.providers[normalizedName];
        const provider = new ProviderClass(config);
        
        // Validate provider configuration
        provider.validateConfig();
        
        return provider;
    }

    /**
     * Get list of supported providers
     * @returns {Array<string>} - List of provider names
     */
    static getSupportedProviders() {
        return [...ProviderFactory.supportedProviders];
    }

    /**
     * Register a new provider
     * @param {string} name - Provider name
     * @param {Class} providerClass - Provider class
     */
    static registerProvider(name, providerClass) {
        ProviderFactory.providers[name.toLowerCase()] = providerClass;
        ProviderFactory.supportedProviders = Object.keys(ProviderFactory.providers);
    }

    /**
     * Get provider configuration template
     * @param {string} providerName - Name of the provider
     * @returns {Object} - Configuration template
     */
    static getConfigTemplate(providerName) {
        const templates = {
            claude: {
                apiKey: 'required',
                model: 'claude-sonnet-4-20250514',
                maxTokens: 1000,
                temperature: 0.7,
                anthropicVersion: '2023-06-01'
            },
            openai: {
                apiKey: 'required',
                model: 'gpt-4',
                maxTokens: 1000,
                temperature: 0.7,
                organization: 'optional'
            },
            local: {
                baseUrl: 'http://localhost:11434',
                model: 'llama2',
                providerType: 'ollama', // ollama, lmstudio, textgeneration
                maxTokens: 1000,
                temperature: 0.7
            }
        };

        return templates[providerName.toLowerCase()] || null;
    }
}

module.exports = ProviderFactory;
