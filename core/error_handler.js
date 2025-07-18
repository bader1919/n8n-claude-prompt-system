/**
 * Error Handler - Comprehensive error handling and input sanitization
 * Part of the n8n Claude Prompt System
 *
 * Features:
 * - Input validation and sanitization
 * - Secure error message handling
 * - Template injection protection
 * - Request validation middleware
 * - Integrated logging and monitoring
 *
 * @author Bader Abdulrahim
 * @version 1.0.0
 */

const { logger } = require('./logger');

class ErrorHandler {
    constructor(options = {}) {
        this.logLevel = options.logLevel || 'error';
        this.includeStackTrace = options.includeStackTrace || false;
        this.sanitizeErrors = options.sanitizeErrors !== false; // Default to true
        this.monitoring = options.monitoring || null;
    }

    /**
     * Sanitize input to prevent injection attacks
     */
    sanitizeInput(input) {
        // Handle non-string types recursively
        if (typeof input !== 'string') {
            if (Array.isArray(input)) {
                return input.map(item => this.sanitizeInput(item));
            } else if (input && typeof input === 'object') {
                const sanitized = {};
                for (const [key, value] of Object.entries(input)) {
                    sanitized[key] = this.sanitizeInput(value);
                }
                return sanitized;
            }
            return input;
        }

        // Remove potential script injections
        let sanitized = input
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
            .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
            .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
            .replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, '')
            .replace(/on\w+\s*=/gi, '')
            .replace(/style\s*=/gi, '')
            .replace(/eval\s*\(/gi, '')
            .replace(/Function\s*\(/gi, '')
            .replace(/setTimeout\s*\(/gi, '')
            .replace(/setInterval\s*\(/gi, '');

        // Handle dangerous URL schemes
        const dangerousSchemes = ['javascript:', 'data:', 'vbscript:', 'file:', 'about:'];
        for (const scheme of dangerousSchemes) {
            if (sanitized.toLowerCase().includes(scheme)) {
                sanitized = sanitized.replace(new RegExp(scheme, 'gi'), '');
            }
        }

        // Remove any remaining dangerous functions and HTML
        sanitized = sanitized
            .replace(/alert\s*\([^)]*\)/gi, '')
            .replace(/confirm\s*\([^)]*\)/gi, '')
            .replace(/prompt\s*\([^)]*\)/gi, '')
            .replace(/<\s*\w.*?>/gi, '') // Remove any remaining HTML tags
            .replace(/&lt;script/gi, '')
            .replace(/&lt;\/script/gi, '');

        return sanitized.trim();
    }

    /**
     * Validate template variables
     */
    validateTemplateVariables(variables) {
        const errors = [];

        if (!variables || typeof variables !== 'object') {
            errors.push('Variables must be a valid object');
            logger.security('Template validation failed: Invalid variables object', {
                eventType: 'input_validation_failure',
                reason: 'variables_not_object'
            });
            return errors;
        }

        for (const [key, value] of Object.entries(variables)) {
            // Validate key format
            if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
                const error = `Invalid variable name: ${key}. Must be alphanumeric with underscores.`;
                errors.push(error);
                logger.security('Template validation failed: Invalid variable name', {
                    eventType: 'input_validation_failure',
                    variableName: key,
                    reason: 'invalid_variable_name'
                });
            }

            // Validate value
            if (typeof value === 'string') {
                if (value.length > 10000) {
                    const error = `Variable ${key} exceeds maximum length of 10000 characters`;
                    errors.push(error);
                    logger.security('Template validation failed: Variable too long', {
                        eventType: 'input_validation_failure',
                        variableName: key,
                        valueLength: value.length,
                        reason: 'variable_too_long'
                    });
                }

                // Check for potential injection patterns
                if (this.containsSuspiciousPatterns(value)) {
                    const error = `Variable ${key} contains potentially unsafe content`;
                    errors.push(error);
                    logger.security('Template validation failed: Suspicious patterns detected', {
                        eventType: 'input_validation_failure',
                        variableName: key,
                        reason: 'suspicious_patterns'
                    });
                }
            }
        }

        if (errors.length === 0) {
            logger.debug('Template variables validation passed', {
                variableCount: Object.keys(variables).length
            });
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
        const errorId = this.generateErrorId();

        // Log full error details internally using Winston logger
        logger.error('Application Error', error, {
            errorId,
            url: req?.url,
            method: req?.method,
            userAgent: req?.headers['user-agent'],
            ip: req?.ip,
            correlationId: req?.correlationId
        });

        // Track security events if relevant
        if (this.monitoring) {
            if (error.name === 'ValidationError') {
                this.monitoring.trackSecurityEvent('input_validation_failure', {
                    errorId,
                    errorType: error.name
                });
            } else if (error.name === 'AuthenticationError') {
                this.monitoring.trackSecurityEvent('auth_failure', {
                    errorId,
                    errorType: error.name,
                    ip: req?.ip
                });
            } else if (error.name === 'RateLimitError') {
                this.monitoring.trackSecurityEvent('rate_limit', {
                    errorId,
                    errorType: error.name,
                    ip: req?.ip
                });
            }
        }

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
        const sanitizedResponse = {
            error: true,
            errorId,
            timestamp: new Date().toISOString()
        };

        // Map internal errors to safe external messages
        if (error.name === 'ValidationError') {
            sanitizedResponse.message = 'Invalid input provided';
            sanitizedResponse.type = 'validation_error';
        } else if (error.name === 'AuthenticationError') {
            sanitizedResponse.message = 'Authentication failed';
            sanitizedResponse.type = 'auth_error';
        } else if (error.name === 'RateLimitError') {
            sanitizedResponse.message = 'Rate limit exceeded';
            sanitizedResponse.type = 'rate_limit_error';
        } else if (error.code === 'ENOENT') {
            sanitizedResponse.message = 'Resource not found';
            sanitizedResponse.type = 'not_found_error';
        } else if (error.response?.status >= 400 && error.response?.status < 500) {
            sanitizedResponse.message = 'Client error occurred';
            sanitizedResponse.type = 'client_error';
        } else if (error.response?.status >= 500) {
            sanitizedResponse.message = 'External service error';
            sanitizedResponse.type = 'service_error';
        } else {
            sanitizedResponse.message = 'An internal error occurred';
            sanitizedResponse.type = 'internal_error';
        }

        // Include stack trace only in development
        if (!this.sanitizeErrors && this.includeStackTrace) {
            sanitizedResponse.stack = error.stack;
        }

        return sanitizedResponse;
    }

    /**
     * Log error with appropriate level (deprecated - using Winston logger now)
     */
    logError(logEntry) {
        // This method is kept for backwards compatibility but logs are now handled by Winston
        logger.error('Legacy error logging', null, logEntry);
    }

    /**
     * Express middleware for error handling
     */
    expressMiddleware() {
        return (error, req, res, _next) => {
            const handledError = this.handleError(error, req);

            // Determine HTTP status code
            let statusCode = 500;
            if (handledError.type === 'validation_error') statusCode = 400;
            else if (handledError.type === 'auth_error') statusCode = 401;
            else if (handledError.type === 'not_found_error') statusCode = 404;
            else if (handledError.type === 'rate_limit_error') statusCode = 429;
            else if (handledError.type === 'client_error') statusCode = 400;
            else if (handledError.type === 'service_error') statusCode = 502;

            res.status(statusCode).json(handledError);
        };
    }

    /**
     * Express middleware for request validation
     */
    validationMiddleware() {
        return (req, res, next) => {
            try {
                const errors = this.validateApiRequest(req);

                if (errors.length > 0) {
                    logger.security('Request validation failed', {
                        eventType: 'input_validation_failure',
                        errors,
                        method: req.method,
                        url: req.url,
                        correlationId: req.correlationId
                    });

                    const validationError = new Error('Validation failed');
                    validationError.name = 'ValidationError';
                    validationError.details = errors;
                    throw validationError;
                }

                // Sanitize request body
                if (req.body) {
                    const originalBody = JSON.stringify(req.body);
                    req.body = this.sanitizeRequestBody(req.body);
                    const sanitizedBody = JSON.stringify(req.body);

                    if (originalBody !== sanitizedBody) {
                        logger.security('Request body sanitized', {
                            eventType: 'input_sanitization',
                            method: req.method,
                            url: req.url,
                            correlationId: req.correlationId
                        });
                    }
                }

                next();
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

// Custom error types
class ValidationError extends Error {
    constructor(message, details = []) {
        super(message);
        this.name = 'ValidationError';
        this.details = details;
    }
}

class AuthenticationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'AuthenticationError';
    }
}

class RateLimitError extends Error {
    constructor(message) {
        super(message);
        this.name = 'RateLimitError';
    }
}

module.exports = {
    ErrorHandler,
    ValidationError,
    AuthenticationError,
    RateLimitError
};
