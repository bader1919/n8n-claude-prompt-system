const BaseProvider = require('./base_provider');

/**
 * Claude Provider for Anthropic's Claude API
 * Implements the BaseProvider interface for Claude models
 */
class ClaudeProvider extends BaseProvider {
  constructor(config = {}) {
    super(config);
    this.apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
    this.baseUrl = config.baseUrl || 'https://api.anthropic.com/v1/messages';
    this.model = config.model || 'claude-sonnet-4-20250514';
    this.maxTokens = config.maxTokens || 1000;
    this.anthropicVersion = config.anthropicVersion || '2023-06-01';
    
    // Claude-specific pricing (per 1K tokens)
    this.inputTokenPrice = 0.003;
    this.outputTokenPrice = 0.015;
  }

  /**
   * Generate response using Claude API
   * @param {string} prompt - The processed prompt
   * @param {Object} options - Claude-specific options
   * @returns {Promise<Object>} - Standardized response
   */
  async generateResponse(prompt, options = {}) {
    try {
      if (!this.validateConfig()) {
        throw new Error('Invalid Claude configuration');
      }

      const requestBody = this.formatRequest(prompt, options);
      
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': this.anthropicVersion
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Claude API Error: ${errorData.error?.message || response.statusText}`);
      }

      const data = await response.json();
      return this.formatResponse(data);
      
    } catch (error) {
      return this.handleError(error, 'generateResponse');
    }
  }

  /**
   * Format request for Claude API
   * @param {string} prompt - Raw prompt text
   * @param {Object} options - Formatting options
   * @returns {Object} - Claude-formatted request
   */
  formatRequest(prompt, options = {}) {
    return {
      model: options.model || this.model,
      max_tokens: options.maxTokens || this.maxTokens,
      temperature: options.temperature || 0.7,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      ...(options.systemPrompt && {
        system: options.systemPrompt
      })
    };
  }

  /**
   * Format Claude response to standard format
   * @param {Object} response - Raw Claude response
   * @returns {Object} - Standardized response
   */
  formatResponse(response) {
    const content = response.content && response.content[0] 
      ? response.content[0].text 
      : 'No response content';

    const usage = response.usage || {};
    const cost = this.calculateCost(usage);

    return this.createSuccessResponse(content, {
      model: response.model,
      usage: usage,
      cost: cost,
      stopReason: response.stop_reason,
      stopSequence: response.stop_sequence
    });
  }

  /**
   * Validate Claude configuration
   * @returns {boolean} - True if valid
   */
  validateConfig() {
    if (!this.apiKey) {
      console.error('Claude API key is required');
      return false;
    }
    return true;
  }

  /**
   * Calculate cost for Claude usage
   * @param {Object} usage - Token usage from Claude
   * @returns {number} - Cost in USD
   */
  calculateCost(usage) {
    const inputTokens = usage.input_tokens || 0;
    const outputTokens = usage.output_tokens || 0;
    
    const inputCost = (inputTokens / 1000) * this.inputTokenPrice;
    const outputCost = (outputTokens / 1000) * this.outputTokenPrice;
    
    return Math.round((inputCost + outputCost) * 100000) / 100000; // Round to 5 decimal places
  }

  /**
   * Get Claude provider capabilities
   * @returns {Object} - Provider capabilities
   */
  getCapabilities() {
    return {
      name: 'ClaudeProvider',
      supportsStreaming: false,
      supportsImages: true,
      supportsFiles: false,
      maxTokens: 200000,
      supportedModels: [
        'claude-opus-4',
        'claude-sonnet-4-20250514',
        'claude-3-5-sonnet-20241022',
        'claude-3-opus-20240229',
        'claude-3-sonnet-20240229',
        'claude-3-haiku-20240307'
      ]
    };
  }

  /**
   * Health check for Claude API
   * @returns {Promise<boolean>} - True if healthy
   */
  async healthCheck() {
    try {
      const response = await this.generateResponse('Test health check');
      return response.success;
    } catch (error) {
      console.error('Claude health check failed:', error);
      return false;
    }
  }
}

module.exports = ClaudeProvider;
