const BaseProvider = require('./base_provider');
const ClaudeProvider = require('./claude_provider');
const OpenAIProvider = require('./openai_provider');
const LocalProvider = require('./local_provider');

/**
 * Provider Factory for dynamic LLM provider selection
 * Handles provider instantiation, configuration, and selection logic
 */
class ProviderFactory {
  constructor() {
    this.providers = new Map();
    this.defaultProvider = 'claude';
    this.providerConfigs = new Map();
    
    this.registerProvider('claude', ClaudeProvider);
    this.registerProvider('openai', OpenAIProvider);
    this.registerProvider('local', LocalProvider);
  }

  /**
   * Register a new provider type
   * @param {string} name - Provider name
   * @param {Class} ProviderClass - Provider class
   */
  registerProvider(name, ProviderClass) {
    this.providers.set(name.toLowerCase(), ProviderClass);
  }

  /**
   * Set provider configuration
   * @param {string} providerName - Provider name
   * @param {Object} config - Provider configuration
   */
  setProviderConfig(providerName, config) {
    this.providerConfigs.set(providerName.toLowerCase(), config);
  }

  /**
   * Get available provider names
   * @returns {Array} - Array of provider names
   */
  getAvailableProviders() {
    return Array.from(this.providers.keys());
  }

  /**
   * Create a provider instance
   * @param {string} providerName - Provider name
   * @param {Object} config - Optional configuration override
   * @returns {BaseProvider} - Provider instance
   */
  createProvider(providerName, config = {}) {
    const name = providerName.toLowerCase();
    const ProviderClass = this.providers.get(name);
    
    if (!ProviderClass) {
      throw new Error(`Provider '${providerName}' not found. Available providers: ${this.getAvailableProviders().join(', ')}`);
    }

    const savedConfig = this.providerConfigs.get(name) || {};
    const mergedConfig = { ...savedConfig, ...config };
    
    const provider = new ProviderClass(mergedConfig);
    
    if (!(provider instanceof BaseProvider)) {
      throw new Error(`Provider '${providerName}' must extend BaseProvider`);
    }

    return provider;
  }

  /**
   * Get the best provider for given requirements
   * @param {Object} requirements - Requirements object
   * @returns {string} - Best provider name
   */
  getBestProvider(requirements = {}) {
    const {
      budget = 'medium',
      speed = 'medium',
      quality = 'medium',
      features = [],
      model = null
    } = requirements;

    // If specific model is requested, find the provider that supports it
    if (model) {
      for (const [providerName, ProviderClass] of this.providers) {
        try {
          const tempProvider = new ProviderClass({});
          const capabilities = tempProvider.getCapabilities();
          if (capabilities.supportedModels.includes(model)) {
            return providerName;
          }
        } catch (error) {
          // Skip providers that can't be instantiated
          continue;
        }
      }
    }

    // Provider selection logic based on requirements
    if (budget === 'low') {
      return 'local'; // Local models are typically free
    }

    if (speed === 'high' && quality === 'high') {
      return 'openai'; // GPT-4 for best balance
    }

    if (quality === 'high') {
      return 'claude'; // Claude for highest quality
    }

    if (features.includes('streaming')) {
      return 'openai'; // OpenAI has better streaming support
    }

    if (features.includes('images')) {
      return 'openai'; // GPT-4 Vision
    }

    // Default provider
    return this.defaultProvider;
  }

  /**
   * Get provider with automatic selection
   * @param {Object} requirements - Requirements object
   * @param {Object} config - Optional configuration
   * @returns {BaseProvider} - Provider instance
   */
  getProvider(requirements = {}, config = {}) {
    const providerName = requirements.provider || this.getBestProvider(requirements);
    return this.createProvider(providerName, config);
  }

  /**
   * Get provider capabilities summary
   * @returns {Object} - Capabilities summary for all providers
   */
  getAllCapabilities() {
    const capabilities = {};
    
    for (const [providerName, ProviderClass] of this.providers) {
      try {
        const tempProvider = new ProviderClass({});
        capabilities[providerName] = tempProvider.getCapabilities();
      } catch (error) {
        capabilities[providerName] = {
          name: providerName,
          error: error.message,
          available: false
        };
      }
    }
    
    return capabilities;
  }

  /**
   * Test all providers health
   * @returns {Promise<Object>} - Health status for all providers
   */
  async testAllProviders() {
    const results = {};
    
    for (const [providerName, ProviderClass] of this.providers) {
      try {
        const provider = new ProviderClass(this.providerConfigs.get(providerName) || {});
        const isHealthy = await provider.healthCheck();
        results[providerName] = {
          healthy: isHealthy,
          capabilities: provider.getCapabilities(),
          config: provider.validateConfig()
        };
      } catch (error) {
        results[providerName] = {
          healthy: false,
          error: error.message,
          config: false
        };
      }
    }
    
    return results;
  }

  /**
   * Get cost comparison for a request
   * @param {string} prompt - Prompt text
   * @param {Array} providerNames - Providers to compare
   * @returns {Object} - Cost comparison
   */
  async getCostComparison(prompt, providerNames = null) {
    const providersToTest = providerNames || this.getAvailableProviders();
    const comparison = {};
    
    for (const providerName of providersToTest) {
      try {
        const provider = this.createProvider(providerName);
        // Estimate tokens (rough approximation: 1 token ~= 4 characters)
        const estimatedTokens = Math.ceil(prompt.length / 4);
        const estimatedCost = provider.calculateCost({
          input_tokens: estimatedTokens,
          output_tokens: estimatedTokens / 2 // Assume response is half the size
        });
        
        comparison[providerName] = {
          estimatedCost: estimatedCost,
          capabilities: provider.getCapabilities()
        };
      } catch (error) {
        comparison[providerName] = {
          error: error.message,
          available: false
        };
      }
    }
    
    return comparison;
  }

  /**
   * Set default provider
   * @param {string} providerName - Provider name
   */
  setDefaultProvider(providerName) {
    if (!this.providers.has(providerName.toLowerCase())) {
      throw new Error(`Provider '${providerName}' not found`);
    }
    this.defaultProvider = providerName.toLowerCase();
  }

  /**
   * Load configuration from environment variables
   */
  loadEnvironmentConfig() {
    // Claude configuration
    if (process.env.ANTHROPIC_API_KEY) {
      this.setProviderConfig('claude', {
        apiKey: process.env.ANTHROPIC_API_KEY,
        model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514'
      });
    }

    // OpenAI configuration
    if (process.env.OPENAI_API_KEY) {
      this.setProviderConfig('openai', {
        apiKey: process.env.OPENAI_API_KEY,
        model: process.env.OPENAI_MODEL || 'gpt-4',
        organization: process.env.OPENAI_ORG_ID
      });
    }

    // Local provider configuration
    if (process.env.LOCAL_LLM_ENDPOINT) {
      this.setProviderConfig('local', {
        endpoint: process.env.LOCAL_LLM_ENDPOINT,
        model: process.env.LOCAL_LLM_MODEL || 'llama2'
      });
    }
  }
}

// Export singleton instance
module.exports = new ProviderFactory();
