/**
 * Comprehensive Error Types - Extended error class hierarchy
 * Part of the n8n Claude Prompt System
 *
 * Features:
 * - Standardized error types for different failure scenarios
 * - Enhanced error metadata for monitoring and debugging
 * - Serializable error objects for logging
 *
 * @author Bader Abdulrahim
 * @version 1.0.0
 */

/**
 * Base error class with enhanced metadata
 */
class BaseError extends Error {
    constructor(message, options = {}) {
        super(message);
        this.name = this.constructor.name;
        this.timestamp = new Date().toISOString();
        this.code = options.code || 'UNKNOWN_ERROR';
        this.context = options.context || {};
        this.userMessage = options.userMessage || null;
        this.retryable = options.retryable || false;
        this.statusCode = options.statusCode || 500;
        
        Error.captureStackTrace(this, this.constructor);
    }

    /**
     * Serialize error for logging
     */
    toJSON() {
        return {
            name: this.name,
            message: this.message,
            code: this.code,
            timestamp: this.timestamp,
            context: this.context,
            retryable: this.retryable,
            statusCode: this.statusCode,
            stack: this.stack
        };
    }

    /**
     * Get user-safe error representation
     */
    toUserError() {
        return {
            error: true,
            type: this.name.toLowerCase().replace('error', '_error'),
            message: this.userMessage || 'An error occurred',
            code: this.code,
            timestamp: this.timestamp,
            retryable: this.retryable
        };
    }
}

/**
 * Validation error for input/output validation failures
 */
class ValidationError extends BaseError {
    constructor(message, details = [], options = {}) {
        super(message, { 
            ...options, 
            code: options.code || 'VALIDATION_FAILED',
            statusCode: options.statusCode || 400,
            userMessage: options.userMessage || 'Invalid input provided'
        });
        this.details = details;
    }

    toUserError() {
        const userError = super.toUserError();
        userError.details = this.details;
        return userError;
    }
}

/**
 * Authentication and authorization errors
 */
class AuthenticationError extends BaseError {
    constructor(message, options = {}) {
        super(message, { 
            ...options, 
            code: options.code || 'AUTHENTICATION_FAILED',
            statusCode: options.statusCode || 401,
            userMessage: options.userMessage || 'Authentication required'
        });
    }
}

class AuthorizationError extends BaseError {
    constructor(message, options = {}) {
        super(message, { 
            ...options, 
            code: options.code || 'AUTHORIZATION_FAILED',
            statusCode: options.statusCode || 403,
            userMessage: options.userMessage || 'Access denied'
        });
    }
}

/**
 * Rate limiting errors
 */
class RateLimitError extends BaseError {
    constructor(message, options = {}) {
        super(message, { 
            ...options, 
            code: options.code || 'RATE_LIMIT_EXCEEDED',
            statusCode: options.statusCode || 429,
            userMessage: options.userMessage || 'Rate limit exceeded. Please try again later.',
            retryable: true
        });
        this.retryAfter = options.retryAfter || 60;
    }

    toUserError() {
        const userError = super.toUserError();
        userError.retryAfter = this.retryAfter;
        return userError;
    }
}

/**
 * External service errors (Claude API, etc.)
 */
class ExternalServiceError extends BaseError {
    constructor(message, options = {}) {
        super(message, { 
            ...options, 
            code: options.code || 'EXTERNAL_SERVICE_ERROR',
            statusCode: options.statusCode || 502,
            userMessage: options.userMessage || 'External service temporarily unavailable',
            retryable: options.retryable !== false
        });
        this.service = options.service || 'unknown';
        this.serviceStatus = options.serviceStatus || null;
    }

    toUserError() {
        const userError = super.toUserError();
        userError.service = this.service;
        return userError;
    }
}

/**
 * Circuit breaker error
 */
class CircuitBreakerError extends BaseError {
    constructor(message, options = {}) {
        super(message, { 
            ...options, 
            code: options.code || 'CIRCUIT_BREAKER_OPEN',
            statusCode: options.statusCode || 503,
            userMessage: options.userMessage || 'Service temporarily unavailable',
            retryable: true
        });
        this.circuitState = options.circuitState || 'open';
    }

    toUserError() {
        const userError = super.toUserError();
        userError.circuitState = this.circuitState;
        return userError;
    }
}

/**
 * Timeout errors
 */
class TimeoutError extends BaseError {
    constructor(message, options = {}) {
        super(message, { 
            ...options, 
            code: options.code || 'REQUEST_TIMEOUT',
            statusCode: options.statusCode || 408,
            userMessage: options.userMessage || 'Request timed out',
            retryable: true
        });
        this.timeout = options.timeout || 0;
    }

    toUserError() {
        const userError = super.toUserError();
        userError.timeout = this.timeout;
        return userError;
    }
}

/**
 * Resource not found errors
 */
class NotFoundError extends BaseError {
    constructor(message, options = {}) {
        super(message, { 
            ...options, 
            code: options.code || 'RESOURCE_NOT_FOUND',
            statusCode: options.statusCode || 404,
            userMessage: options.userMessage || 'Resource not found'
        });
        this.resource = options.resource || 'unknown';
    }

    toUserError() {
        const userError = super.toUserError();
        userError.resource = this.resource;
        return userError;
    }
}

/**
 * Configuration errors
 */
class ConfigurationError extends BaseError {
    constructor(message, options = {}) {
        super(message, { 
            ...options, 
            code: options.code || 'CONFIGURATION_ERROR',
            statusCode: options.statusCode || 500,
            userMessage: options.userMessage || 'System configuration error'
        });
    }
}

/**
 * Template processing errors
 */
class TemplateError extends BaseError {
    constructor(message, options = {}) {
        super(message, { 
            ...options, 
            code: options.code || 'TEMPLATE_ERROR',
            statusCode: options.statusCode || 400,
            userMessage: options.userMessage || 'Template processing failed'
        });
        this.templateName = options.templateName || null;
    }

    toUserError() {
        const userError = super.toUserError();
        if (this.templateName) {
            userError.templateName = this.templateName;
        }
        return userError;
    }
}

/**
 * Provider-specific errors
 */
class ProviderError extends BaseError {
    constructor(message, options = {}) {
        super(message, { 
            ...options, 
            code: options.code || 'PROVIDER_ERROR',
            statusCode: options.statusCode || 500,
            userMessage: options.userMessage || 'AI provider error',
            retryable: options.retryable !== false
        });
        this.provider = options.provider || 'unknown';
        this.providerCode = options.providerCode || null;
    }

    toUserError() {
        const userError = super.toUserError();
        userError.provider = this.provider;
        return userError;
    }
}

module.exports = {
    BaseError,
    ValidationError,
    AuthenticationError,
    AuthorizationError,
    RateLimitError,
    ExternalServiceError,
    CircuitBreakerError,
    TimeoutError,
    NotFoundError,
    ConfigurationError,
    TemplateError,
    ProviderError
};