const BaseProvider = require('./base_provider');
const { ErrorHandler, ValidationError } = require('../core/error_handler');
const CacheManager = require('../core/cache_manager');
const ConnectionPoolManager = require('../core/connection_pool');

class ClaudeProvider extends BaseProvider {
    constructor(apiKey, options = {}) {
        super();
        this.apiKey = apiKey;
        this.apiUrl = 'https://api.anthropic.com/v1/messages';
        this.apiVersion = '2023-06-01';
        this.errorHandler = new ErrorHandler(options.errorHandler || {});
        this.rateLimiter = this.createRateLimiter();

        // Initialize performance components
        this.cacheManager = options.cacheManager || new CacheManager({
            redis: { enabled: process.env.REDIS_ENABLED !== 'false' }
        });
        this.connectionPool = options.connectionPool || new ConnectionPoolManager({
            maxSockets: 20,
            timeout: 30000,
            retry: { maxRetries: 3, baseDelay: 1000 }
        });

        // Performance metrics
        this.metrics = {
            totalRequests: 0,
            cachedResponses: 0,
            cacheHitRate: 0,
            avgResponseTime: 0,
            tokenUsage: {
                total: 0,
                input: 0,
                output: 0
            },
            costs: {
                total: 0,
                currentMonth: 0
            }
        };

        if (!this.apiKey) {
            throw new ValidationError('Claude API key is required');
        }

        this.initializeProvider();
    }

    /**
     * Initialize provider with performance optimizations
     */
    async initializeProvider() {
        // Setup cache warming for common requests
        this.setupCacheWarming();

        // Setup metrics collection
        this.setupMetricsCollection();

        console.log('Claude Provider initialized with performance optimizations');
    }

    /**
     * Setup cache warming for common requests
     */
    setupCacheWarming() {
        // Cache common model configurations
        const commonConfigs = [
            { model: 'claude-3-haiku-20240307', maxTokens: 1000 },
            { model: 'claude-3-sonnet-20240229', maxTokens: 2000 },
            { model: 'claude-3-5-sonnet-20241022', maxTokens: 4000 }
        ];

        // Pre-cache model pricing and configurations
        commonConfigs.forEach(config => {
            const cacheKey = `model_config:${config.model}`;
            this.cacheManager.set(cacheKey, config, {
                type: 'provider_config',
                ttl: 7200 // 2 hours
            });
        });
    }

    /**
     * Setup metrics collection
     */
    setupMetricsCollection() {
        // Update metrics periodically
        setInterval(() => {
            this.updateMetrics();
        }, 60000); // Every minute

        // Listen to cache events
        this.cacheManager.on('cache:hit', (event) => {
            if (event.type === 'claude_response') {
                this.metrics.cachedResponses++;
                this.updateCacheHitRate();
            }
        });
    }

    /**
     * Update provider metrics
     */
    updateMetrics() {
        this.metrics.cacheHitRate = this.metrics.totalRequests > 0 ?
            (this.metrics.cachedResponses / this.metrics.totalRequests * 100).toFixed(2) : 0;
    }

    /**
     * Update cache hit rate
     */
    updateCacheHitRate() {
        this.metrics.cacheHitRate = this.metrics.totalRequests > 0 ?
            (this.metrics.cachedResponses / this.metrics.totalRequests * 100).toFixed(2) : 0;
    }

    /**
     * Generate cache key for request
     */
    generateCacheKey(prompt, options = {}) {
        const cacheData = {
            prompt: prompt.substring(0, 1000), // First 1000 chars to avoid huge keys
            model: options.model || 'claude-3-haiku-20240307',
            maxTokens: options.maxTokens || 1000,
            temperature: options.temperature || 0.7,
            systemPrompt: options.systemPrompt ? options.systemPrompt.substring(0, 500) : null
        };

        const crypto = require('crypto');
        return crypto.createHash('sha256')
            .update(JSON.stringify(cacheData))
            .digest('hex').substring(0, 32);
    }
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
     * Generate completion using modern Claude Messages API with caching and optimization
     */
    async generateCompletion(prompt, options = {}) {
        try {
            const startTime = Date.now();
            this.metrics.totalRequests++;

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

            // Check cache first
            const cacheKey = this.generateCacheKey(sanitizedPrompt, options);
            const cachedResponse = await this.cacheManager.get(cacheKey, { type: 'claude_response' });

            if (cachedResponse && !options.bypassCache) {
                this.metrics.cachedResponses++;
                this.updateCacheHitRate();

                // Add cache metadata
                cachedResponse.cached = true;
                cachedResponse.responseTime = Date.now() - startTime;

                return cachedResponse;
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

            // Use connection pool for the request
            const response = await this.connectionPool.request({
                method: 'POST',
                url: this.apiUrl,
                data: requestData,
                headers: {
                    'x-api-key': this.apiKey,
                    'Content-Type': 'application/json',
                    'anthropic-version': this.apiVersion
                },
                timeout: options.timeout || 30000,
                validateStatus: (status) => status < 500
            });

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

            // Update provider metrics
            this.metrics.tokenUsage.total += totalTokens;
            this.metrics.tokenUsage.input += inputTokens;
            this.metrics.tokenUsage.output += outputTokens;

            const cost = this.calculateCost(inputTokens, outputTokens, response.data.model);
            this.metrics.costs.total += cost;

            // Update average response time
            const totalRequests = this.metrics.totalRequests;
            this.metrics.avgResponseTime =
                (this.metrics.avgResponseTime * (totalRequests - 1) + responseTime) / totalRequests;

            const result = {
                content: textContent,
                model: response.data.model,
                usage: {
                    inputTokens,
                    outputTokens,
                    totalTokens
                },
                cost,
                responseTime,
                finishReason: response.data.stop_reason,
                cached: false
            };

            // Cache the response for future use
            const cacheTTL = this.calculateCacheTTL(result, options);
            if (cacheTTL > 0) {
                await this.cacheManager.set(cacheKey, result, {
                    type: 'claude_response',
                    ttl: cacheTTL
                });
            }

            return result;

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
     * Calculate cache TTL based on response characteristics
     */
    calculateCacheTTL(result, options) {
        // Don't cache if explicitly disabled
        if (options.disableCache) return 0;

        // Longer TTL for successful, deterministic responses
        if (result.finishReason === 'end_turn') {
            // Lower temperature = more deterministic = longer cache
            const temperature = options.temperature || 0.7;
            const baseTTL = 1800; // 30 minutes

            if (temperature < 0.3) {
                return baseTTL * 2; // 1 hour for very deterministic
            } else if (temperature < 0.7) {
                return baseTTL; // 30 minutes for somewhat deterministic
            } else {
                return baseTTL / 2; // 15 minutes for creative responses
            }
        }

        // Shorter TTL for stopped or length-limited responses
        return 900; // 15 minutes
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
     * Batch multiple completion requests for efficiency
     */
    async batchCompletions(requests, options = {}) {
        const startTime = Date.now();
        const batchSize = options.batchSize || 5;
        const maxConcurrent = options.maxConcurrent || 3;

        console.log(`Processing batch of ${requests.length} requests with concurrency ${maxConcurrent}`);

        // Split requests into batches
        const batches = [];
        for (let i = 0; i < requests.length; i += batchSize) {
            batches.push(requests.slice(i, i + batchSize));
        }

        const results = [];

        // Process batches with limited concurrency
        for (const batch of batches) {
            const batchPromises = batch.map(async (request, index) => {
                try {
                    const result = await this.generateCompletion(request.prompt, {
                        ...request.options,
                        batchId: `batch_${batches.indexOf(batch)}_${index}`
                    });
                    return { success: true, result, originalIndex: request.originalIndex || index };
                } catch (error) {
                    return { success: false, error: error.message, originalIndex: request.originalIndex || index };
                }
            });

            // Execute batch with concurrency limit
            const chunkSize = Math.min(maxConcurrent, batch.length);
            const chunks = [];
            for (let i = 0; i < batchPromises.length; i += chunkSize) {
                chunks.push(batchPromises.slice(i, i + chunkSize));
            }

            for (const chunk of chunks) {
                const chunkResults = await Promise.allSettled(chunk);
                results.push(...chunkResults.map(r => r.value || r.reason));
            }
        }

        const totalTime = Date.now() - startTime;
        const successful = results.filter(r => r.success).length;

        console.log(`Batch completed: ${successful}/${requests.length} successful in ${totalTime}ms`);

        return {
            results,
            summary: {
                total: requests.length,
                successful,
                failed: requests.length - successful,
                totalTime,
                averageTime: totalTime / requests.length
            }
        };
    }

    /**
     * Stream large responses for memory efficiency
     */
    async generateCompletionStream(prompt, options = {}) {
        // Note: Claude API doesn't support streaming in the same way as OpenAI
        // This is a simulation for large responses
        const result = await this.generateCompletion(prompt, options);

        // Simulate streaming by chunking the response
        const chunkSize = options.streamChunkSize || 100;
        const chunks = [];

        for (let i = 0; i < result.content.length; i += chunkSize) {
            chunks.push({
                chunk: result.content.slice(i, i + chunkSize),
                index: Math.floor(i / chunkSize),
                isLast: i + chunkSize >= result.content.length,
                metadata: {
                    totalLength: result.content.length,
                    progress: ((i + chunkSize) / result.content.length * 100).toFixed(1)
                }
            });
        }

        return {
            chunks,
            metadata: {
                model: result.model,
                usage: result.usage,
                cost: result.cost,
                responseTime: result.responseTime,
                totalChunks: chunks.length
            }
        };
    }

    /**
     * Get provider performance metrics
     */
    getMetrics() {
        return {
            ...this.metrics,
            cache: this.cacheManager.getMetrics(),
            connectionPool: this.connectionPool.getMetrics(),
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Clear provider cache
     */
    async clearCache(pattern = null) {
        if (pattern) {
            return await this.cacheManager.clear(pattern, { type: 'claude_response' });
        }
        return await this.cacheManager.invalidateByType('claude_response');
    }

    /**
     * Warm cache with common requests
     */
    async warmCache(commonRequests = []) {
        const warmingData = {};

        for (const request of commonRequests) {
            const cacheKey = this.generateCacheKey(request.prompt, request.options);
            // Generate a placeholder response for warming (in practice, you'd use real responses)
            warmingData[cacheKey] = {
                content: 'Cached response placeholder',
                model: request.options?.model || 'claude-3-haiku-20240307',
                usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
                cost: 0,
                responseTime: 0,
                cached: true
            };
        }

        return await this.cacheManager.warmCache(warmingData, {
            type: 'claude_response',
            warmTTL: 7200 // 2 hours for warmed cache
        });
    }
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
     * Test API connection with performance metrics
     */
    async testConnection() {
        try {
            const startTime = Date.now();
            const response = await this.generateCompletion('Hello', {
                maxTokens: 5,
                model: 'claude-3-haiku-20240307',
                bypassCache: true // Force fresh request for testing
            });

            const responseTime = Date.now() - startTime;

            return {
                success: true,
                model: response.model,
                responseTime,
                cached: response.cached || false,
                metrics: this.getMetrics(),
                health: await this.getHealthStatus()
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                metrics: this.getMetrics()
            };
        }
    }

    /**
     * Get comprehensive health status
     */
    async getHealthStatus() {
        const cacheHealth = await this.cacheManager.healthCheck();
        const connectionHealth = await this.connectionPool.healthCheck();

        let overallStatus = 'healthy';
        if (cacheHealth.overall === 'degraded' || connectionHealth.status === 'warning') {
            overallStatus = 'degraded';
        }
        if (cacheHealth.overall === 'unhealthy' || connectionHealth.status === 'unhealthy') {
            overallStatus = 'unhealthy';
        }

        return {
            status: overallStatus,
            components: {
                cache: cacheHealth,
                connectionPool: connectionHealth,
                rateLimiter: {
                    status: 'healthy',
                    requestsInWindow: this.rateLimiter.requests?.length || 0
                }
            },
            metrics: this.metrics
        };
    }

    /**
     * Close provider and cleanup resources
     */
    async close() {
        if (this.cacheManager) {
            await this.cacheManager.close();
        }
        if (this.connectionPool) {
            await this.connectionPool.close();
        }
        console.log('Claude Provider closed');
    }
}

module.exports = ClaudeProvider;
