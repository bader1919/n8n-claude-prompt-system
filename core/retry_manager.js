/**
 * Retry Mechanism with Exponential Backoff
 * Part of the n8n Claude Prompt System
 *
 * Features:
 * - Configurable retry policies
 * - Exponential backoff with jitter
 * - Conditional retry based on error types
 * - Circuit breaker integration
 *
 * @author Bader Abdulrahim
 * @version 1.0.0
 */

const { TimeoutError, RateLimitError, ExternalServiceError } = require('./error_types');

class RetryPolicy {
    constructor(options = {}) {
        this.maxRetries = options.maxRetries || 3;
        this.initialDelay = options.initialDelay || 1000; // 1 second
        this.maxDelay = options.maxDelay || 30000; // 30 seconds
        this.backoffMultiplier = options.backoffMultiplier || 2;
        this.jitter = options.jitter !== false; // Default to true
        this.jitterFactor = options.jitterFactor || 0.1;
        
        // Retry conditions
        this.retryableErrors = options.retryableErrors || [
            'TimeoutError',
            'RateLimitError',
            'ExternalServiceError',
            'ECONNRESET',
            'ENOTFOUND',
            'ECONNREFUSED',
            'ETIMEDOUT'
        ];
        
        // Status codes that should trigger retries
        this.retryableStatusCodes = options.retryableStatusCodes || [
            429, // Too Many Requests
            500, // Internal Server Error
            502, // Bad Gateway
            503, // Service Unavailable
            504  // Gateway Timeout
        ];
    }

    /**
     * Check if an error should trigger a retry
     */
    shouldRetry(error, attempt) {
        if (attempt >= this.maxRetries) {
            return false;
        }

        // Check for explicitly retryable errors
        if (error.retryable === true) {
            return true;
        }

        if (error.retryable === false) {
            return false;
        }

        // Check error type/name
        if (this.retryableErrors.includes(error.name) || 
            this.retryableErrors.includes(error.constructor.name)) {
            return true;
        }

        // Check error code
        if (error.code && this.retryableErrors.includes(error.code)) {
            return true;
        }

        // Check HTTP status codes
        if (error.status && this.retryableStatusCodes.includes(error.status)) {
            return true;
        }

        if (error.response?.status && this.retryableStatusCodes.includes(error.response.status)) {
            return true;
        }

        // Special handling for rate limit errors
        if (error.name === 'RateLimitError' || error.status === 429) {
            return true;
        }

        return false;
    }

    /**
     * Calculate delay for next retry attempt
     */
    calculateDelay(attempt, error = null) {
        // If error has a specific retry-after value, use it
        if (error?.retryAfter) {
            return Math.min(error.retryAfter * 1000, this.maxDelay);
        }

        // Handle rate limit headers
        if (error?.response?.headers?.['retry-after']) {
            const retryAfter = parseInt(error.response.headers['retry-after']) * 1000;
            return Math.min(retryAfter, this.maxDelay);
        }

        // Exponential backoff
        let delay = this.initialDelay * Math.pow(this.backoffMultiplier, attempt);
        delay = Math.min(delay, this.maxDelay);

        // Add jitter to prevent thundering herd
        if (this.jitter) {
            const jitterAmount = delay * this.jitterFactor;
            const jitterOffset = (Math.random() - 0.5) * 2 * jitterAmount;
            delay += jitterOffset;
        }

        return Math.max(delay, 0);
    }

    /**
     * Execute function with retry logic
     */
    async execute(fn, ...args) {
        let lastError;
        let attempt = 0;

        while (attempt <= this.maxRetries) {
            try {
                const result = await fn(...args);
                
                // Log successful retry if this wasn't the first attempt
                if (attempt > 0) {
                    console.info(`Operation succeeded after ${attempt} retry attempts`);
                }
                
                return result;
            } catch (error) {
                lastError = error;
                
                if (!this.shouldRetry(error, attempt)) {
                    console.warn(`Not retrying error: ${error.message} (attempt ${attempt + 1})`);
                    throw error;
                }

                attempt++;
                
                if (attempt > this.maxRetries) {
                    console.error(`All ${this.maxRetries} retry attempts failed. Last error: ${error.message}`);
                    throw this.createRetryExhaustedError(lastError, attempt - 1);
                }

                const delay = this.calculateDelay(attempt - 1, error);
                
                console.warn(`Retry attempt ${attempt}/${this.maxRetries} after ${delay}ms delay. Error: ${error.message}`);
                
                await this.sleep(delay);
            }
        }

        throw this.createRetryExhaustedError(lastError, attempt);
    }

    /**
     * Create error for when all retries are exhausted
     */
    createRetryExhaustedError(originalError, attempts) {
        const error = new ExternalServiceError(
            `Operation failed after ${attempts} retry attempts: ${originalError.message}`,
            {
                code: 'RETRY_EXHAUSTED',
                statusCode: originalError.statusCode || 500,
                userMessage: 'Service temporarily unavailable. Please try again later.',
                context: {
                    attempts,
                    originalError: originalError.message,
                    originalErrorType: originalError.name
                }
            }
        );
        error.originalError = originalError;
        return error;
    }

    /**
     * Sleep utility function
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

/**
 * Retry Manager - Manages retry policies for different operations
 */
class RetryManager {
    constructor() {
        this.policies = new Map();
        this.defaultPolicy = new RetryPolicy();
    }

    /**
     * Register a retry policy
     */
    registerPolicy(name, policy) {
        this.policies.set(name, policy);
    }

    /**
     * Get a retry policy
     */
    getPolicy(name) {
        return this.policies.get(name) || this.defaultPolicy;
    }

    /**
     * Execute with named retry policy
     */
    async executeWithPolicy(policyName, fn, ...args) {
        const policy = this.getPolicy(policyName);
        return policy.execute(fn, ...args);
    }

    /**
     * Execute with custom retry options
     */
    async execute(fn, retryOptions = {}, ...args) {
        const policy = new RetryPolicy(retryOptions);
        return policy.execute(fn, ...args);
    }

    /**
     * Create pre-configured policies for common scenarios
     */
    setupDefaultPolicies() {
        // Fast retry for quick operations
        this.registerPolicy('fast', new RetryPolicy({
            maxRetries: 2,
            initialDelay: 500,
            maxDelay: 5000,
            backoffMultiplier: 1.5
        }));

        // Standard retry for API calls
        this.registerPolicy('api', new RetryPolicy({
            maxRetries: 3,
            initialDelay: 1000,
            maxDelay: 30000,
            backoffMultiplier: 2
        }));

        // Conservative retry for expensive operations
        this.registerPolicy('conservative', new RetryPolicy({
            maxRetries: 2,
            initialDelay: 2000,
            maxDelay: 60000,
            backoffMultiplier: 3
        }));

        // Rate limit specific retry
        this.registerPolicy('rateLimit', new RetryPolicy({
            maxRetries: 5,
            initialDelay: 60000, // 1 minute
            maxDelay: 300000,    // 5 minutes
            backoffMultiplier: 1.5,
            retryableErrors: ['RateLimitError', 'RATE_LIMIT_EXCEEDED'],
            retryableStatusCodes: [429]
        }));

        // External service retry
        this.registerPolicy('external', new RetryPolicy({
            maxRetries: 4,
            initialDelay: 1000,
            maxDelay: 45000,
            backoffMultiplier: 2,
            jitter: true
        }));
    }
}

// Create global retry manager with default policies
const globalRetryManager = new RetryManager();
globalRetryManager.setupDefaultPolicies();

module.exports = {
    RetryPolicy,
    RetryManager,
    retryManager: globalRetryManager
};