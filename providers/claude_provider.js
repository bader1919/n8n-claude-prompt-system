const axios = require('axios');
const BaseProvider = require('./base_provider');

class ClaudeProvider extends BaseProvider {
  constructor(apiKey) {
    super();
    this.apiKey = apiKey;
    this.apiUrl = 'https://api.anthropic.com/v1/complete';
  }

  async generateCompletion(prompt, options = {}) {
    try {
      const response = await axios.post(
        this.apiUrl,
        {
          model: options.model || 'claude-v1',
          prompt: prompt,
          max_tokens_to_sample: options.maxTokens || 100,
          temperature: options.temperature || 0.7,
          stop_sequences: options.stopSequences || ["\n\n"],
        },
        {
          headers: {
            'x-api-key': this.apiKey,
            'Content-Type': 'application/json',
          },
        }
      );

      if (response.data && response.data.completion) {
        return response.data.completion;
      } else {
        throw new Error('No completion returned from Claude API');
      }
    } catch (error) {
      throw new Error(`Claude API error: ${error.message}`);
    }
  }

  calculateCost(tokens) {
    // Example cost calculation: $0.0032 per 1,000 tokens
    const costPerThousandTokens = 0.0032;
    return (tokens / 1000) * costPerThousandTokens;
  }
}

module.exports = ClaudeProvider;
