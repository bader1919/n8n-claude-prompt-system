/**
 * Error Handler - Comprehensive error handling and input sanitization
 * Part of the n8n Claude Prompt System
 *
 * Features:
 * - Input validation and sanitization
 * - Secure error message handling
 * - Template injection protection
 * - Request validation middleware
 * - Logging and monitoring
 * - Integration with new error types and validation systems
 *
 * @author Bader Abdulrahim
 * @version 1.0.0
 */

const { 
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
} = require('./error_types');
const { schemaValidator } = require('./schema_validator');

class ErrorHandler {
    constructor(options = {}) {
        this.logLevel = options.logLevel || 'error';
        this.includeStackTrace = options.includeStackTrace || false;
        this.sanitizeErrors = options.sanitizeErrors !== false; // Default to true
    }

    /**
     * Sanitize input to prevent injection attacks
     */
    sanitizeInput(input) {
        if (typeof input !== 'string') {
            return input;
        }

        // Remove potential script injections
        let sanitized = input
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/on\w+\s*=/gi, '')
            .replace(/eval\s*\(/gi, '')
            .replace(/Function\s*\(/gi, '')
            .replace(/setTimeout\s*\(/gi, '')
            .replace(/setInterval\s*\(/gi, '');

        // Handle javascript: protocol specifically - remove the entire content if it starts with javascript:
        if (sanitized.toLowerCase().startsWith('javascript:')) {
            return '';
        }

        // Remove any remaining alert() calls and similar dangerous functions
        sanitized = sanitized
            .replace(/alert\s*\([^)]*\)/gi, '')
            .replace(/confirm\s*\([^)]*\)/gi, '')
            .replace(/prompt\s*\([^)]*\)/gi, '');

        return sanitized.trim();
    }

    /**
     * Validate template variables
     */
    validateTemplateVariables(variables) {
        const errors = [];

        if (!variables || typeof variables !== 'object') {
            errors.push('Variables must be a valid object');
            return errors;
        }

        for (const [key, value] of Object.entries(variables)) {
            // Validate key format
            if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
                errors.push(`Invalid variable name: ${key}. Must be alphanumeric with underscores.`);
            }

            // Validate value
            if (typeof value === 'string') {
                if (value.length > 10000) {
                    errors.push(`Variable ${key} exceeds maximum length of 10000 characters`);
                }

                // Check for potential injection patterns
                if (this.containsSuspiciousPatterns(value)) {
                    errors.push(`Variable ${key} contains potentially unsafe content`);
                }
            }
        }

        return errors;
    }

    /**
     * Check for suspicious patterns that might indicate injection attempts
     */
    containsSuspiciousPatterns(text) {
        const suspiciousPatterns = [
            /\{\{.*?eval.*?\}\}/i,
            /\{\{.*?function.*?\}\}/i,
            /\{\{.*?require.*?\}\}/i,
            /\{\{.*?process.*?\}\}/i,
            /\{\{.*?global.*?\}\}/i,
            /\{\{.*?constructor.*?\}\}/i,
            /\{\{.*?__proto__.*?\}\}/i,
            /\{\{.*?prototype.*?\}\}/i
        ];

        return suspiciousPatterns.some(pattern => pattern.test(text));
    }

    /**
     * Validate API request structure
     */
    validateApiRequest(req) {
        const errors = [];

        // Check required fields based on endpoint
        if (req.path.includes('/generate')) {
            if (!req.body.template) {
                errors.push('Template is required for generation');
            }

            if (req.body.variables) {
                const variableErrors = this.validateTemplateVariables(req.body.variables);
                errors.push(...variableErrors);
            }
        }

        // Validate headers for POST requests only
        if (req.method === 'POST' && (!req.headers['content-type'] || !req.headers['content-type'].includes('application/json'))) {
            errors.push('Content-Type must be application/json');
        }

        return errors;
    }

    /**
     * Handle errors securely without exposing sensitive information
     */
    handleError(error, req = null) {
        const timestamp = new Date().toISOString();
        const errorId = this.generateErrorId();

        // Log full error details internally
        const logEntry = {
            errorId,
            timestamp,
            message: error.message,
            stack: error.stack,
            url: req?.url,
            method: req?.method,
            userAgent: req?.headers['user-agent'],
            ip: req?.ip,
            type: error.name || 'Error'
        };

        this.logError(logEntry);

        // Return sanitized error for client
        return this.sanitizeErrorResponse(error, errorId);
    }

    /**
     * Generate unique error ID for tracking
     */
    generateErrorId() {
        return `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Sanitize error response to prevent information disclosure
     */
    sanitizeErrorResponse(error, errorId) {
        const timestamp = new Date().toISOString();

        // If error is already a BaseError instance, use its user error method
        if (error instanceof BaseError) {
            const userError = error.toUserError();
            userError.errorId = errorId;
            return userError;
        }

        // Handle legacy error types and unknown errors
        const sanitizedResponse = {
            error: true,
            errorId,
            timestamp,
            retryable: false
        };

        // Map internal errors to safe external messages
        if (error.name === 'ValidationError') {
            sanitizedResponse.message = 'Invalid input provided';
            sanitizedResponse.type = 'validation_error';
            sanitizedResponse.code = 'VALIDATION_FAILED';
            if (error.details) {
                sanitizedResponse.details = error.details;
            }
        } else if (error.name === 'AuthenticationError') {
            sanitizedResponse.message = 'Authentication failed';
            sanitizedResponse.type = 'authentication_error';
            sanitizedResponse.code = 'AUTHENTICATION_FAILED';
        } else if (error.name === 'AuthorizationError') {
            sanitizedResponse.message = 'Access denied';
            sanitizedResponse.type = 'authorization_error';
            sanitizedResponse.code = 'AUTHORIZATION_FAILED';
        } else if (error.name === 'RateLimitError') {
            sanitizedResponse.message = 'Rate limit exceeded';
            sanitizedResponse.type = 'rate_limit_error';
            sanitizedResponse.code = 'RATE_LIMIT_EXCEEDED';
            sanitizedResponse.retryable = true;
            if (error.retryAfter) {
                sanitizedResponse.retryAfter = error.retryAfter;
            }
        } else if (error.code === 'ENOENT') {
            sanitizedResponse.message = 'Resource not found';
            sanitizedResponse.type = 'not_found_error';
            sanitizedResponse.code = 'RESOURCE_NOT_FOUND';
        } else if (error.response?.status >= 400 && error.response?.status < 500) {
            sanitizedResponse.message = 'Client error occurred';
            sanitizedResponse.type = 'client_error';
            sanitizedResponse.code = 'CLIENT_ERROR';
        } else if (error.response?.status >= 500) {
            sanitizedResponse.message = 'External service error';
            sanitizedResponse.type = 'external_service_error';
            sanitizedResponse.code = 'EXTERNAL_SERVICE_ERROR';
            sanitizedResponse.retryable = true;
        } else if (error.code === 'ECONNRESET' || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
            sanitizedResponse.message = 'Network error occurred';
            sanitizedResponse.type = 'timeout_error';
            sanitizedResponse.code = error.code;
            sanitizedResponse.retryable = true;
        } else {
            sanitizedResponse.message = 'An internal error occurred';
            sanitizedResponse.type = 'internal_error';
            sanitizedResponse.code = 'INTERNAL_ERROR';
        }

        // Include stack trace only in development
        if (!this.sanitizeErrors && this.includeStackTrace) {
            sanitizedResponse.stack = error.stack;
        }

        return sanitizedResponse;
    }

    /**
     * Log error with appropriate level
     */
    logError(logEntry) {
        const logMessage = JSON.stringify(logEntry, null, 2);

        switch (this.logLevel) {
        case 'debug':
            console.debug(`[DEBUG] ${logMessage}`);
            break;
        case 'info':
            console.info(`[INFO] ${logMessage}`);
            break;
        case 'warn':
            console.warn(`[WARN] ${logMessage}`);
            break;
        case 'error':
        default:
            console.error(`[ERROR] ${logMessage}`);
            break;
        }
    }

    /**
     * Express middleware for error handling
     */
    expressMiddleware() {
        return (error, req, res, _next) => {
            const handledError = this.handleError(error, req);

            // Determine HTTP status code
            let statusCode = 500;
            if (error instanceof BaseError) {
                statusCode = error.statusCode;
            } else {
                // Legacy status code mapping
                if (handledError.type === 'validation_error') statusCode = 400;
                else if (handledError.type === 'authentication_error') statusCode = 401;
                else if (handledError.type === 'authorization_error') statusCode = 403;
                else if (handledError.type === 'not_found_error') statusCode = 404;
                else if (handledError.type === 'rate_limit_error') statusCode = 429;
                else if (handledError.type === 'client_error') statusCode = 400;
                else if (handledError.type === 'external_service_error') statusCode = 502;
                else if (handledError.type === 'circuit_breaker_error') statusCode = 503;
                else if (handledError.type === 'timeout_error') statusCode = 408;
            }

            // Validate error response against schema
            const validation = schemaValidator.validateResponse(handledError, 'error_response');
            if (!validation.valid) {
                console.error('Error response validation failed:', validation.error);
            }

            // Set additional headers for specific error types
            if (handledError.type === 'rate_limit_error' && handledError.retryAfter) {
                res.set('Retry-After', handledError.retryAfter.toString());
            }

            res.status(statusCode).json(handledError);
        };
    }

    /**
     * Express middleware for request validation
     */
    validationMiddleware() {
        return (req, res, next) => {
            try {
                // Use schema validator for comprehensive validation
                schemaValidator.validateApiRequest(req, res, (error) => {
                    if (error) {
                        return next(error);
                    }
                    
                    // Additional legacy validations
                    const errors = this.validateApiRequest(req);
                    if (errors.length > 0) {
                        const validationError = new ValidationError(
                            'Validation failed', 
                            errors,
                            { code: 'LEGACY_VALIDATION_FAILED' }
                        );
                        throw validationError;
                    }

                    // Sanitize request body
                    if (req.body) {
                        req.body = this.sanitizeRequestBody(req.body);
                    }

                    next();
                });
            } catch (error) {
                next(error);
            }
        };
    }

    /**
     * Recursively sanitize request body
     */
    sanitizeRequestBody(body) {
        if (typeof body === 'string') {
            return this.sanitizeInput(body);
        } else if (Array.isArray(body)) {
            return body.map(item => this.sanitizeRequestBody(item));
        } else if (body && typeof body === 'object') {
            const sanitized = {};
            for (const [key, value] of Object.entries(body)) {
                sanitized[key] = this.sanitizeRequestBody(value);
            }
            return sanitized;
        }
        return body;
    }

    /**
     * Create custom error types
     */
    static createError(name, message, statusCode = 500) {
        const error = new Error(message);
        error.name = name;
        error.statusCode = statusCode;
        return error;
    }
}

module.exports = {
    ErrorHandler
};
