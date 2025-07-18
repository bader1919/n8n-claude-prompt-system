const BaseProvider = require('./base_provider');

/**
 * Local Provider for self-hosted LLM models
 * Implements the BaseProvider interface for local/on-premise models
 */
class LocalProvider extends BaseProvider {
  constructor(config = {}) {
    super(config);
    this.endpoint = config.endpoint || process.env.LOCAL_LLM_ENDPOINT || 'http://localhost:11434';
    this.model = config.model || process.env.LOCAL_LLM_MODEL || 'llama2';
    this.maxTokens = config.maxTokens || 1000;
    this.apiType = config.apiType || 'ollama'; // 'ollama', 'llamacpp', 'textgen'
    this.temperature = config.temperature || 0.7;
    
    // Local models are typically free
    this.costPerToken = 0;
  }

  /**
   * Generate response using local LLM
   * @param {string} prompt - The processed prompt
   * @param {Object} options - Local-specific options
   * @returns {Promise<Object>} - Standardized response
   */
  async generateResponse(prompt, options = {}) {
    try {
      if (!this.validateConfig()) {
        throw new Error('Invalid Local LLM configuration');
      }

      const requestBody = this.formatRequest(prompt, options);
      const endpoint = this.getEndpoint();
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody),
        timeout: this.timeout
      });

      if (!response.ok) {
        throw new Error(`Local LLM API Error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return this.formatResponse(data);
      
    } catch (error) {
      return this.handleError(error, 'generateResponse');
    }
  }

  /**
   * Get the appropriate endpoint based on API type
   * @returns {string} - Full endpoint URL
   */
  getEndpoint() {
    const baseUrl = this.endpoint.replace(/\/$/, ''); // Remove trailing slash
    
    switch (this.apiType.toLowerCase()) {
      case 'ollama':
        return `${baseUrl}/api/generate`;
      case 'llamacpp':
        return `${baseUrl}/completion`;
      case 'textgen':
        return `${baseUrl}/v1/completions`;
      default:
        return `${baseUrl}/api/generate`;
    }
  }

  /**
   * Format request for local LLM
   * @param {string} prompt - Raw prompt text
   * @param {Object} options - Formatting options
   * @returns {Object} - Local LLM formatted request
   */
  formatRequest(prompt, options = {}) {
    const baseRequest = {
      model: options.model || this.model,
      prompt: prompt,
      stream: false,
      temperature: options.temperature || this.temperature,
      max_tokens: options.maxTokens || this.maxTokens
    };

    // Format based on API type
    switch (this.apiType.toLowerCase()) {
      case 'ollama':
        return {
          model: baseRequest.model,
          prompt: baseRequest.prompt,
          stream: baseRequest.stream,
          options: {
            temperature: baseRequest.temperature,
            num_predict: baseRequest.max_tokens,
            top_p: options.topP || 0.9,
            repeat_penalty: options.repeatPenalty || 1.1
          }
        };
      
      case 'llamacpp':
        return {
          prompt: baseRequest.prompt,
          n_predict: baseRequest.max_tokens,
          temperature: baseRequest.temperature,
          top_p: options.topP || 0.9,
          repeat_penalty: options.repeatPenalty || 1.1,
          stream: baseRequest.stream
        };
      
      case 'textgen':
        return {
          prompt: baseRequest.prompt,
          max_tokens: baseRequest.max_tokens,
          temperature: baseRequest.temperature,
          top_p: options.topP || 0.9,
          repetition_penalty: options.repeatPenalty || 1.1,
          stream: baseRequest.stream
        };
      
      default:
        return baseRequest;
    }
  }

  /**
   * Format local LLM response to standard format
   * @param {Object} response - Raw local LLM response
   * @returns {Object} - Standardized response
   */
  formatResponse(response) {
    let content = '';
    let usage = {};

    // Parse response based on API type
    switch (this.apiType.toLowerCase()) {
      case 'ollama':
        content = response.response || 'No response content';
        usage = {
          prompt_tokens: response.prompt_eval_count || 0,
          completion_tokens: response.eval_count || 0,
          total_tokens: (response.prompt_eval_count || 0) + (response.eval_count || 0)
        };
        break;
      
      case 'llamacpp':
        content = response.content || 'No response content';
        usage = {
          prompt_tokens: response.tokens_evaluated || 0,
          completion_tokens: response.tokens_generated || 0,
          total_tokens: (response.tokens_evaluated || 0) + (response.tokens_generated || 0)
        };
        break;
      
      case 'textgen':
        const choice = response.choices && response.choices[0];
        content = choice ? choice.text : 'No response content';
        usage = response.usage || {};
        break;
      
      default:
        content = response.response || response.content || 'No response content';
        usage = response.usage || {};
    }

    const cost = this.calculateCost(usage);

    return this.createSuccessResponse(content, {
      model: response.model || this.model,
      usage: usage,
      cost: cost,
      apiType: this.apiType,
      done: response.done,
      created_at: response.created_at
    });
  }

  /**
   * Validate local LLM configuration
   * @returns {boolean} - True if valid
   */
  validateConfig() {
    if (!this.endpoint) {
      console.error('Local LLM endpoint is required');
      return false;
    }
    
    if (!this.model) {
      console.error('Local LLM model is required');
      return false;
    }
    
    return true;
  }

  /**
   * Calculate cost for local LLM usage (typically free)
   * @param {Object} usage - Token usage
   * @returns {number} - Cost in USD (usually 0)
   */
  calculateCost(usage) {
    if (this.costPerToken === 0) {
      return 0;
    }
    
    const totalTokens = usage.total_tokens || 0;
    return (totalTokens / 1000) * this.costPerToken;
  }

  /**
   * Get local provider capabilities
   * @returns {Object} - Provider capabilities
   */
  getCapabilities() {
    return {
      name: 'LocalProvider',
      supportsStreaming: true,
      supportsImages: false,
      supportsFiles: false,
      maxTokens: this.maxTokens,
      supportedModels: [
        'llama2',
        'llama2:13b',
        'llama2:70b',
        'codellama',
        'mistral',
        'mistral:7b',
        'vicuna',
        'alpaca',
        'custom'
      ],
      apiType: this.apiType,
      endpoint: this.endpoint,
      free: true
    };
  }

  /**
   * Health check for local LLM
   * @returns {Promise<boolean>} - True if healthy
   */
  async healthCheck() {
    try {
      // Try to make a simple request to check if the service is running
      const healthEndpoint = this.getHealthEndpoint();
      const response = await fetch(healthEndpoint, {
        method: 'GET',
        timeout: 5000
      });
      
      if (response.ok) {
        return true;
      }
      
      // Fallback: try a simple generation request
      const testResponse = await this.generateResponse('Test', { maxTokens: 5 });
      return testResponse.success;
      
    } catch (error) {
      console.error('Local LLM health check failed:', error);
      return false;
    }
  }

  /**
   * Get health check endpoint based on API type
   * @returns {string} - Health endpoint URL
   */
  getHealthEndpoint() {
    const baseUrl = this.endpoint.replace(/\/$/, '');
    
    switch (this.apiType.toLowerCase()) {
      case 'ollama':
        return `${baseUrl}/api/tags`;
      case 'llamacpp':
        return `${baseUrl}/health`;
      case 'textgen':
        return `${baseUrl}/v1/models`;
      default:
        return `${baseUrl}/health`;
    }
  }

  /**
   * List available models from local LLM service
   * @returns {Promise<Array>} - Array of available models
   */
  async listModels() {
    try {
      const endpoint = this.getModelsEndpoint();
      const response = await fetch(endpoint, {
        method: 'GET',
        timeout: 5000
      });
      
      if (!response.ok) {
        throw new Error(`Failed to list models: ${response.statusText}`);
      }
      
      const data = await response.json();
      return this.parseModelsResponse(data);
      
    } catch (error) {
      console.error('Failed to list local models:', error);
      return [];
    }
  }

  /**
   * Get models endpoint based on API type
   * @returns {string} - Models endpoint URL
   */
  getModelsEndpoint() {
    const baseUrl = this.endpoint.replace(/\/$/, '');
    
    switch (this.apiType.toLowerCase()) {
      case 'ollama':
        return `${baseUrl}/api/tags`;
      case 'llamacpp':
        return `${baseUrl}/models`;
      case 'textgen':
        return `${baseUrl}/v1/models`;
      default:
        return `${baseUrl}/api/tags`;
    }
  }

  /**
   * Parse models response based on API type
   * @param {Object} data - Raw response data
   * @returns {Array} - Array of model names
   */
  parseModelsResponse(data) {
    switch (this.apiType.toLowerCase()) {
      case 'ollama':
        return data.models ? data.models.map(m => m.name) : [];
      case 'llamacpp':
        return data.models || [];
      case 'textgen':
        return data.data ? data.data.map(m => m.id) : [];
      default:
        return [];
    }
  }
}

module.exports = LocalProvider;
