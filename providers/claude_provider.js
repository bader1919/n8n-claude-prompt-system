const axios = require('axios');
const BaseProvider = require('./base_provider');
const { 
    ValidationError, 
    ExternalServiceError, 
    RateLimitError, 
    TimeoutError,
    ProviderError 
} = require('../core/error_types');
const { ErrorHandler } = require('../core/error_handler');
const { circuitBreakerManager } = require('../core/circuit_breaker');
const { retryManager } = require('../core/retry_manager');

class ClaudeProvider extends BaseProvider {
    constructor(apiKey, options = {}) {
        super();
        this.apiKey = apiKey;
        this.apiUrl = 'https://api.anthropic.com/v1/messages';
        this.apiVersion = '2023-06-01';
        this.errorHandler = new ErrorHandler(options.errorHandler || {});
        this.rateLimiter = this.createRateLimiter();
        
        // Circuit breaker configuration
        this.circuitBreakerConfig = {
            failureThreshold: options.failureThreshold || 5,
            successThreshold: options.successThreshold || 2,
            timeout: options.circuitBreakerTimeout || 60000,
            resetTimeoutMultiplier: 1.5,
            maxResetTimeout: 300000
        };

        if (!this.apiKey) {
            throw new ValidationError('Claude API key is required', [], {
                code: 'MISSING_API_KEY',
                context: { provider: 'claude' }
            });
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
                    throw new RateLimitError('Rate limit exceeded', {
                        code: 'CLAUDE_RATE_LIMIT_EXCEEDED',
                        retryAfter: Math.ceil((requests[0] + windowMs - now) / 1000),
                        context: { 
                            requestCount: requests.length,
                            maxRequests,
                            windowMs
                        }
                    });
                }

                requests.push(now);
            }
        };
    }

    /**
     * Generate completion using modern Claude Messages API with circuit breaker and retry
     */
    async generateCompletion(prompt, options = {}) {
        const circuitBreakerName = `claude-${this.apiKey.slice(-8)}`;
        
        // Use circuit breaker with retry logic
        return circuitBreakerManager.execute(
            circuitBreakerName, 
            () => retryManager.executeWithPolicy('api', this._generateCompletionInternal.bind(this), prompt, options),
            this.circuitBreakerConfig
        );
    }

    /**
     * Internal completion generation method
     */
    async _generateCompletionInternal(prompt, options = {}) {
        try {
            // Check rate limit
            this.rateLimiter.checkLimit();

            // Validate and sanitize input
            const sanitizedPrompt = this.errorHandler.sanitizeInput(prompt);
            if (!sanitizedPrompt || sanitizedPrompt.trim().length === 0) {
                throw new ValidationError('Prompt cannot be empty', [], {
                    code: 'EMPTY_PROMPT',
                    context: { provider: 'claude' }
                });
            }

            if (sanitizedPrompt.length > 200000) {
                throw new ValidationError('Prompt exceeds maximum length of 200,000 characters', [], {
                    code: 'PROMPT_TOO_LONG',
                    context: { 
                        provider: 'claude',
                        promptLength: sanitizedPrompt.length,
                        maxLength: 200000
                    }
                });
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
                throw new ExternalServiceError('Invalid response format from Claude API', {
                    code: 'INVALID_RESPONSE_FORMAT',
                    service: 'claude',
                    context: { hasData: !!response.data, hasContent: !!response.data?.content }
                });
            }

            // Extract text content from response
            const textContent = response.data.content
                .filter(item => item.type === 'text')
                .map(item => item.text)
                .join('');

            if (!textContent) {
                throw new ExternalServiceError('No text content returned from Claude API', {
                    code: 'NO_TEXT_CONTENT',
                    service: 'claude',
                    context: { contentItems: response.data.content.length }
                });
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
            // Handle different error types appropriately
            if (error instanceof ValidationError || error instanceof RateLimitError) {
                throw error; // Re-throw as-is
            }

            if (error.code === 'ECONNRESET' || error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
                throw new ExternalServiceError(`Network error: ${error.message}`, {
                    code: error.code,
                    service: 'claude',
                    retryable: true,
                    context: { originalError: error.message }
                });
            }

            if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
                throw new TimeoutError(`Request timeout: ${error.message}`, {
                    code: error.code,
                    timeout: error.config?.timeout || 30000,
                    service: 'claude',
                    retryable: true
                });
            }

            // Handle and log errors securely
            const handledError = this.errorHandler.handleError(error);

            // Re-throw as ProviderError
            throw new ProviderError(handledError.message, {
                code: handledError.code || 'CLAUDE_PROVIDER_ERROR',
                provider: 'claude',
                context: { originalErrorType: error.name },
                retryable: error.response?.status >= 500 || error.code?.startsWith('E')
            });
        }
    }

    /**
     * Handle API error responses
     */
    handleApiError(response) {
        const errorData = response.data?.error;
        let errorMessage = 'Claude API request failed';
        let errorCode = 'CLAUDE_API_ERROR';
        let retryable = false;

        if (errorData) {
            switch (errorData.type) {
            case 'invalid_request_error':
                errorMessage = 'Invalid request to Claude API';
                errorCode = 'INVALID_REQUEST';
                break;
            case 'authentication_error':
                errorMessage = 'Authentication failed with Claude API';
                errorCode = 'AUTHENTICATION_FAILED';
                break;
            case 'permission_error':
                errorMessage = 'Permission denied by Claude API';
                errorCode = 'PERMISSION_DENIED';
                break;
            case 'not_found_error':
                errorMessage = 'Requested resource not found';
                errorCode = 'RESOURCE_NOT_FOUND';
                break;
            case 'rate_limit_error':
                errorMessage = 'Rate limit exceeded for Claude API';
                errorCode = 'RATE_LIMIT_EXCEEDED';
                retryable = true;
                break;
            case 'api_error':
                errorMessage = 'Internal error from Claude API';
                errorCode = 'CLAUDE_INTERNAL_ERROR';
                retryable = true;
                break;
            case 'overloaded_error':
                errorMessage = 'Claude API is temporarily overloaded';
                errorCode = 'SERVICE_OVERLOADED';
                retryable = true;
                break;
            default:
                errorMessage = errorData.message || errorMessage;
                errorCode = errorData.type?.toUpperCase() || errorCode;
            }
        }

        if (response.status === 429) {
            throw new RateLimitError(errorMessage, {
                code: errorCode,
                service: 'claude',
                retryAfter: this.getRetryAfter(response),
                context: { 
                    status: response.status,
                    errorType: errorData?.type
                }
            });
        } else if (response.status >= 500) {
            throw new ExternalServiceError(errorMessage, {
                code: errorCode,
                service: 'claude',
                serviceStatus: response.status,
                retryable: true,
                context: { 
                    status: response.status,
                    errorType: errorData?.type
                }
            });
        } else {
            throw new ProviderError(errorMessage, {
                code: errorCode,
                provider: 'claude',
                retryable,
                context: { 
                    status: response.status,
                    errorType: errorData?.type
                }
            });
        }
    }

    /**
     * Extract retry-after value from response headers
     */
    getRetryAfter(response) {
        const retryAfter = response.headers['retry-after'];
        if (retryAfter) {
            return parseInt(retryAfter);
        }
        // Default to 60 seconds for rate limits
        return 60;
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
     * Test API connection with circuit breaker
     */
    async testConnection() {
        try {
            const circuitBreakerName = `claude-test-${this.apiKey.slice(-8)}`;
            
            const response = await circuitBreakerManager.execute(
                circuitBreakerName,
                () => this._generateCompletionInternal('Hello', {
                    maxTokens: 5,
                    model: 'claude-3-haiku-20240307'
                }),
                { ...this.circuitBreakerConfig, failureThreshold: 2 } // Lower threshold for tests
            );
            
            return {
                success: true,
                model: response.model,
                responseTime: response.responseTime,
                circuitBreakerState: circuitBreakerManager.getCircuitBreaker(circuitBreakerName).getStatus().state
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                errorType: error.name || error.constructor.name,
                retryable: error.retryable || false
            };
        }
    }
}

module.exports = ClaudeProvider;
