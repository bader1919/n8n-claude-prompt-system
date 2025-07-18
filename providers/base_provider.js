/**
 * Abstract Base Provider for LLM Integration
 * Defines the interface that all LLM providers must implement
 */
class BaseProvider {
    constructor(config = {}) {
        this.config = config;
        this.name = this.constructor.name;
        this.rateLimits = config.rateLimits || {};
        this.maxRetries = config.maxRetries || 3;
        this.timeout = config.timeout || 30000;
    }

    /**
   * Abstract method - must be implemented by subclasses
   * @param {string} prompt - The processed prompt to send
   * @param {Object} options - Provider-specific options
   * @returns {Promise<Object>} - Standardized response object
   */
    async generateResponse(prompt, _options = {}) {
        throw new Error('generateResponse method must be implemented by subclass');
    }

    /**
   * Abstract method - must be implemented by subclasses
   * @param {string} prompt - Raw prompt text
   * @param {Object} options - Formatting options
   * @returns {Object} - Provider-specific formatted request
   */
    formatRequest(prompt, _options = {}) {
        throw new Error('formatRequest method must be implemented by subclass');
    }

    /**
   * Abstract method - must be implemented by subclasses
   * @param {Object} response - Raw provider response
   * @returns {Object} - Standardized response format
   */
    formatResponse(_response) {
        throw new Error('formatResponse method must be implemented by subclass');
    }

    /**
   * Validate that the provider is properly configured
   * @returns {boolean} - True if valid configuration
   */
    validateConfig() {
        return true; // Override in subclasses for specific validation
    }

    /**
   * Get provider-specific cost calculation
   * @param {Object} usage - Token usage information
   * @returns {number} - Cost in USD
   */
    calculateCost(_usage) {
        return 0; // Override in subclasses
    }

    /**
   * Get provider capabilities
   * @returns {Object} - Provider capabilities object
   */
    getCapabilities() {
        return {
            name: this.name,
            supportsStreaming: false,
            supportsImages: false,
            supportsFiles: false,
            maxTokens: 4000,
            supportedModels: []
        };
    }

    /**
   * Standardized error handling
   * @param {Error} error - Original error
   * @param {string} context - Context where error occurred
   * @returns {Object} - Standardized error object
   */
    handleError(error, context = 'unknown') {
        return {
            success: false,
            error: {
                message: error.message || 'Unknown error',
                type: error.name || 'Error',
                context: context,
                timestamp: new Date().toISOString(),
                provider: this.name
            }
        };
    }

    /**
   * Standardized success response
   * @param {string} content - Generated content
   * @param {Object} metadata - Additional metadata
   * @returns {Object} - Standardized success object
   */
    createSuccessResponse(content, metadata = {}) {
        return {
            success: true,
            content: content,
            metadata: {
                provider: this.name,
                timestamp: new Date().toISOString(),
                ...metadata
            }
        };
    }

    /**
   * Check if provider is available/healthy
   * @returns {Promise<boolean>} - True if healthy
   */
    async healthCheck() {
        try {
            // Override in subclasses for specific health checks
            return true;
        } catch (error) { // eslint-disable-line no-unreachable
            return false;
        }
    }
}

module.exports = BaseProvider;
