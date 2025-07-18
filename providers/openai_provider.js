const BaseProvider = require('./base_provider');

/**
 * OpenAI Provider for OpenAI's GPT models
 * Implements the BaseProvider interface for OpenAI models
 */
class OpenAIProvider extends BaseProvider {
  constructor(config = {}) {
    super(config);
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY;
    this.baseUrl = config.baseUrl || 'https://api.openai.com/v1/chat/completions';
    this.model = config.model || 'gpt-4';
    this.maxTokens = config.maxTokens || 1000;
    this.organization = config.organization || process.env.OPENAI_ORG_ID;
    
    // OpenAI pricing (per 1K tokens) - approximate rates
    this.modelPricing = {
      'gpt-4': { input: 0.03, output: 0.06 },
      'gpt-4-turbo': { input: 0.01, output: 0.03 },
      'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
      'gpt-3.5-turbo-16k': { input: 0.003, output: 0.004 }
    };
  }

  /**
   * Generate response using OpenAI API
   * @param {string} prompt - The processed prompt
   * @param {Object} options - OpenAI-specific options
   * @returns {Promise<Object>} - Standardized response
   */
  async generateResponse(prompt, options = {}) {
    try {
      if (!this.validateConfig()) {
        throw new Error('Invalid OpenAI configuration');
      }

      const requestBody = this.formatRequest(prompt, options);
      
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      };
      
      if (this.organization) {
        headers['OpenAI-Organization'] = this.organization;
      }

      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`OpenAI API Error: ${errorData.error?.message || response.statusText}`);
      }

      const data = await response.json();
      return this.formatResponse(data);
      
    } catch (error) {
      return this.handleError(error, 'generateResponse');
    }
  }

  /**
   * Format request for OpenAI API
   * @param {string} prompt - Raw prompt text
   * @param {Object} options - Formatting options
   * @returns {Object} - OpenAI-formatted request
   */
  formatRequest(prompt, options = {}) {
    const messages = [];
    
    // Add system message if provided
    if (options.systemPrompt) {
      messages.push({
        role: 'system',
        content: options.systemPrompt
      });
    }
    
    // Add user message
    messages.push({
      role: 'user',
      content: prompt
    });

    return {
      model: options.model || this.model,
      messages: messages,
      max_tokens: options.maxTokens || this.maxTokens,
      temperature: options.temperature || 0.7,
      top_p: options.topP || 1,
      n: options.n || 1,
      stream: options.stream || false,
      stop: options.stop || null,
      presence_penalty: options.presencePenalty || 0,
      frequency_penalty: options.frequencyPenalty || 0
    };
  }

  /**
   * Format OpenAI response to standard format
   * @param {Object} response - Raw OpenAI response
   * @returns {Object} - Standardized response
   */
  formatResponse(response) {
    const choice = response.choices && response.choices[0];
    const content = choice ? choice.message.content : 'No response content';

    const usage = response.usage || {};
    const cost = this.calculateCost(usage, response.model);

    return this.createSuccessResponse(content, {
      model: response.model,
      usage: usage,
      cost: cost,
      finishReason: choice?.finish_reason,
      id: response.id,
      object: response.object,
      created: response.created
    });
  }

  /**
   * Validate OpenAI configuration
   * @returns {boolean} - True if valid
   */
  validateConfig() {
    if (!this.apiKey) {
      console.error('OpenAI API key is required');
      return false;
    }
    return true;
  }

  /**
   * Calculate cost for OpenAI usage
   * @param {Object} usage - Token usage from OpenAI
   * @param {string} model - Model used
   * @returns {number} - Cost in USD
   */
  calculateCost(usage, model) {
    const inputTokens = usage.prompt_tokens || 0;
    const outputTokens = usage.completion_tokens || 0;
    
    const pricing = this.modelPricing[model] || this.modelPricing['gpt-4'];
    
    const inputCost = (inputTokens / 1000) * pricing.input;
    const outputCost = (outputTokens / 1000) * pricing.output;
    
    return Math.round((inputCost + outputCost) * 100000) / 100000; // Round to 5 decimal places
  }

  /**
   * Get OpenAI provider capabilities
   * @returns {Object} - Provider capabilities
   */
  getCapabilities() {
    return {
      name: 'OpenAIProvider',
      supportsStreaming: true,
      supportsImages: true,
      supportsFiles: false,
      maxTokens: 128000,
      supportedModels: [
        'gpt-4',
        'gpt-4-turbo',
        'gpt-4-turbo-preview',
        'gpt-3.5-turbo',
        'gpt-3.5-turbo-16k',
        'gpt-4-vision-preview'
      ]
    };
  }

  /**
   * Health check for OpenAI API
   * @returns {Promise<boolean>} - True if healthy
   */
  async healthCheck() {
    try {
      const response = await this.generateResponse('Test health check', { maxTokens: 10 });
      return response.success;
    } catch (error) {
      console.error('OpenAI health check failed:', error);
      return false;
    }
  }
}

module.exports = OpenAIProvider;
