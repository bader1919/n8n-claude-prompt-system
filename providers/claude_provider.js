const axios = require('axios');
const BaseProvider = require('./base_provider');
const { ErrorHandler, ValidationError } = require('../core/error_handler');

class ClaudeProvider extends BaseProvider {
    constructor(apiKey, options = {}) {
        super();
        this.apiKey = apiKey;
        this.apiUrl = 'https://api.anthropic.com/v1/messages';
        this.apiVersion = '2023-06-01';
        this.errorHandler = new ErrorHandler(options.errorHandler || {});
        this.rateLimiter = this.createRateLimiter();

        if (!this.apiKey) {
            throw new ValidationError('Claude API key is required');
        }
    }

    /**
   * Create simple rate limiter to prevent API abuse
   */
    createRateLimiter() {
        const requests = [];
        const maxRequests = 50; // Requests per minute
        const windowMs = 60 * 1000; // 1 minute

        return {
            checkLimit: () => {
                const now = Date.now();
                // Remove old requests outside the window
                while (requests.length > 0 && requests[0] < now - windowMs) {
                    requests.shift();
                }

                if (requests.length >= maxRequests) {
                    const error = new Error('Rate limit exceeded');
                    error.name = 'RateLimitError';
                    throw error;
                }

                requests.push(now);
            }
        };
    }

    /**
   * Generate completion using modern Claude Messages API
   */
    async generateCompletion(prompt, options = {}) {
        try {
            // Check rate limit
            this.rateLimiter.checkLimit();

            // Validate and sanitize input
            const sanitizedPrompt = this.errorHandler.sanitizeInput(prompt);
            if (!sanitizedPrompt || sanitizedPrompt.trim().length === 0) {
                throw new ValidationError('Prompt cannot be empty');
            }

            if (sanitizedPrompt.length > 200000) {
                throw new ValidationError('Prompt exceeds maximum length of 200,000 characters');
            }

            // Prepare request data for Messages API
            const requestData = {
                model: options.model || 'claude-3-haiku-20240307',
                max_tokens: Math.min(options.maxTokens || 1000, 4096),
                temperature: Math.max(0, Math.min(1, options.temperature || 0.7)),
                messages: [
                    {
                        role: 'user',
                        content: sanitizedPrompt
                    }
                ]
            };

            // Add system prompt if provided
            if (options.systemPrompt) {
                const sanitizedSystem = this.errorHandler.sanitizeInput(options.systemPrompt);
                requestData.system = sanitizedSystem;
            }

            // Add stop sequences if provided
            if (options.stopSequences && Array.isArray(options.stopSequences)) {
                requestData.stop_sequences = options.stopSequences.slice(0, 4); // Max 4 stop sequences
            }

            const startTime = Date.now();
            const response = await axios.post(
                this.apiUrl,
                requestData,
                {
                    headers: {
                        'x-api-key': this.apiKey,
                        'Content-Type': 'application/json',
                        'anthropic-version': this.apiVersion
                    },
                    timeout: options.timeout || 30000, // 30 second timeout
                    validateStatus: (status) => status < 500 // Don't throw on 4xx errors
                }
            );

            const responseTime = Date.now() - startTime;

            // Handle error responses
            if (response.status >= 400) {
                this.handleApiError(response);
            }

            if (!response.data || !response.data.content || !Array.isArray(response.data.content)) {
                throw new Error('Invalid response format from Claude API');
            }

            // Extract text content from response
            const textContent = response.data.content
                .filter(item => item.type === 'text')
                .map(item => item.text)
                .join('');

            if (!textContent) {
                throw new Error('No text content returned from Claude API');
            }

            // Calculate usage metrics
            const inputTokens = response.data.usage?.input_tokens || 0;
            const outputTokens = response.data.usage?.output_tokens || 0;
            const totalTokens = inputTokens + outputTokens;

            return {
                content: textContent,
                model: response.data.model,
                usage: {
                    inputTokens,
                    outputTokens,
                    totalTokens
                },
                cost: this.calculateCost(inputTokens, outputTokens, response.data.model),
                responseTime,
                finishReason: response.data.stop_reason
            };

        } catch (error) {
            // Handle and log errors securely
            const handledError = this.errorHandler.handleError(error);

            // Re-throw with additional context
            const claudeError = new Error(handledError.message);
            claudeError.name = handledError.type;
            claudeError.originalError = error;
            claudeError.provider = 'claude';

            throw claudeError;
        }
    }

    /**
   * Handle API error responses
   */
    handleApiError(response) {
        const errorData = response.data?.error;
        let errorMessage = 'Claude API request failed';

        if (errorData) {
            switch (errorData.type) {
            case 'invalid_request_error':
                errorMessage = 'Invalid request to Claude API';
                break;
            case 'authentication_error':
                errorMessage = 'Authentication failed with Claude API';
                break;
            case 'permission_error':
                errorMessage = 'Permission denied by Claude API';
                break;
            case 'not_found_error':
                errorMessage = 'Requested resource not found';
                break;
            case 'rate_limit_error':
                errorMessage = 'Rate limit exceeded for Claude API';
                break;
            case 'api_error':
                errorMessage = 'Internal error from Claude API';
                break;
            case 'overloaded_error':
                errorMessage = 'Claude API is temporarily overloaded';
                break;
            default:
                errorMessage = errorData.message || errorMessage;
            }
        }

        const error = new Error(errorMessage);
        error.status = response.status;
        error.type = errorData?.type || 'api_error';

        throw error;
    }

    /**
   * Calculate cost based on model and token usage
   */
    calculateCost(inputTokens, outputTokens, model) {
    // Pricing as of 2024 (per million tokens)
        const pricing = {
            'claude-3-opus-20240229': { input: 15.00, output: 75.00 },
            'claude-3-sonnet-20240229': { input: 3.00, output: 15.00 },
            'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },
            'claude-3-5-sonnet-20241022': { input: 3.00, output: 15.00 }
        };

        const modelPricing = pricing[model] || pricing['claude-3-haiku-20240307'];

        const inputCost = (inputTokens / 1000000) * modelPricing.input;
        const outputCost = (outputTokens / 1000000) * modelPricing.output;

        return inputCost + outputCost;
    }

    /**
   * Get available models
   */
    getAvailableModels() {
        return [
            'claude-3-opus-20240229',
            'claude-3-sonnet-20240229',
            'claude-3-haiku-20240307',
            'claude-3-5-sonnet-20241022'
        ];
    }

    /**
   * Validate API key format
   */
    validateApiKey() {
        if (!this.apiKey) {
            return false;
        }

        // Anthropic API keys start with 'sk-ant-'
        return this.apiKey.startsWith('sk-ant-') && this.apiKey.length > 20;
    }

    /**
   * Test API connection
   */
    async testConnection() {
        try {
            const response = await this.generateCompletion('Hello', {
                maxTokens: 5,
                model: 'claude-3-haiku-20240307'
            });
            return {
                success: true,
                model: response.model,
                responseTime: response.responseTime
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }
}

module.exports = ClaudeProvider;
