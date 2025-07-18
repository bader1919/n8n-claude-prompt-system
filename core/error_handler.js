/**
 * Advanced Error Handling and Logging System
 * Provides comprehensive error catching, logging, and recovery mechanisms
 */
class ErrorHandler {
    constructor(config = {}) {
        this.logLevel = config.logLevel || 'INFO';
        this.enableRetry = config.enableRetry !== false;
        this.maxRetries = config.maxRetries || 3;
        this.retryDelay = config.retryDelay || 1000;
        this.enableMetrics = config.enableMetrics !== false;
        this.metrics = {
            totalErrors: 0,
            errorsByType: {},
            errorsByProvider: {},
            retrySuccess: 0,
            retryFailure: 0
        };
    }

    /**
     * Wrap async function with error handling and retry logic
     * @param {Function} asyncFunction - Function to wrap
     * @param {Object} context - Context information for logging
     * @returns {Function} - Wrapped function
     */
    wrapAsync(asyncFunction, context = {}) {
        return async (...args) => {
            let lastError;
            let attempt = 0;

            while (attempt <= this.maxRetries) {
                try {
                    const result = await asyncFunction(...args);
                    
                    if (attempt > 0) {
                        this._logRetrySuccess(context, attempt);
                        this.metrics.retrySuccess++;
                    }
                    
                    return result;
                } catch (error) {
                    lastError = error;
                    attempt++;
                    
                    const errorInfo = this._categorizeError(error, context);
                    this._logError(errorInfo, attempt);
                    
                    if (attempt <= this.maxRetries && this._isRetryableError(error)) {
                        this._logRetryAttempt(context, attempt, error);
                        await this._delay(this.retryDelay * attempt); // Exponential backoff
                        continue;
                    }
                    
                    break;
                }
            }

            // All retries failed
            this.metrics.retryFailure++;
            const finalError = this._enhanceError(lastError, context, attempt - 1);
            this._logFinalFailure(finalError);
            throw finalError;
        };
    }

    /**
     * Handle specific error types with custom logic
     * @param {Error} error - The error to handle
     * @param {Object} context - Context information
     * @returns {Object} - Error handling result
     */
    handleError(error, context = {}) {
        const errorInfo = this._categorizeError(error, context);
        this._updateMetrics(errorInfo);
        
        const handling = {
            error: errorInfo,
            shouldRetry: this._isRetryableError(error),
            userMessage: this._generateUserMessage(errorInfo),
            technicalDetails: this._generateTechnicalDetails(errorInfo),
            suggestedActions: this._generateSuggestedActions(errorInfo),
            severity: this._determineSeverity(errorInfo)
        };

        this._logError(errorInfo);
        return handling;
    }

    /**
     * Validate input data and throw descriptive errors
     * @param {Object} data - Data to validate
     * @param {Object} schema - Validation schema
     * @throws {ValidationError} - If validation fails
     */
    validateInput(data, schema) {
        const errors = [];

        // Required fields validation
        if (schema.required) {
            for (const field of schema.required) {
                if (!data.hasOwnProperty(field) || data[field] === null || data[field] === undefined) {
                    errors.push(`Required field '${field}' is missing`);
                } else if (typeof data[field] === 'string' && data[field].trim() === '') {
                    errors.push(`Required field '${field}' cannot be empty`);
                }
            }
        }

        // Type validation
        if (schema.fields) {
            for (const [field, fieldSchema] of Object.entries(schema.fields)) {
                if (data.hasOwnProperty(field) && data[field] !== null) {
                    const value = data[field];
                    
                    if (fieldSchema.type && typeof value !== fieldSchema.type) {
                        errors.push(`Field '${field}' must be of type ${fieldSchema.type}, got ${typeof value}`);
                    }
                    
                    if (fieldSchema.enum && !fieldSchema.enum.includes(value)) {
                        errors.push(`Field '${field}' must be one of: ${fieldSchema.enum.join(', ')}`);
                    }
                    
                    if (fieldSchema.minLength && typeof value === 'string' && value.length < fieldSchema.minLength) {
                        errors.push(`Field '${field}' must be at least ${fieldSchema.minLength} characters long`);
                    }
                    
                    if (fieldSchema.pattern && typeof value === 'string' && !new RegExp(fieldSchema.pattern).test(value)) {
                        errors.push(`Field '${field}' does not match required pattern`);
                    }
                }
            }
        }

        if (errors.length > 0) {
            const validationError = new Error(`Validation failed: ${errors.join(', ')}`);
            validationError.name = 'ValidationError';
            validationError.type = 'VALIDATION_ERROR';
            validationError.details = errors;
            throw validationError;
        }
    }

    /**
     * Get error metrics and statistics
     * @returns {Object} - Error metrics
     */
    getMetrics() {
        return {
            ...this.metrics,
            errorRate: this.metrics.totalErrors > 0 ? 
                (this.metrics.retryFailure / this.metrics.totalErrors * 100).toFixed(2) + '%' : '0%',
            retrySuccessRate: this.metrics.retrySuccess + this.metrics.retryFailure > 0 ?
                (this.metrics.retrySuccess / (this.metrics.retrySuccess + this.metrics.retryFailure) * 100).toFixed(2) + '%' : '0%'
        };
    }

    /**
     * Reset error metrics
     */
    resetMetrics() {
        this.metrics = {
            totalErrors: 0,
            errorsByType: {},
            errorsByProvider: {},
            retrySuccess: 0,
            retryFailure: 0
        };
    }

    // Private methods
    _categorizeError(error, context) {
        const errorInfo = {
            name: error.name || 'UnknownError',
            message: error.message || 'Unknown error occurred',
            stack: error.stack,
            context: context,
            timestamp: new Date().toISOString(),
            type: this._determineErrorType(error),
            provider: context.provider || 'unknown'
        };

        return errorInfo;
    }

    _determineErrorType(error) {
        if (error.name === 'ValidationError' || error.type === 'VALIDATION_ERROR') {
            return 'VALIDATION_ERROR';
        }
        
        if (error.message.includes('API error') || error.message.includes('401') || error.message.includes('403')) {
            return 'API_AUTHENTICATION_ERROR';
        }
        
        if (error.message.includes('429')) {
            return 'RATE_LIMIT_ERROR';
        }
        
        if (error.message.includes('timeout') || error.message.includes('ETIMEDOUT')) {
            return 'TIMEOUT_ERROR';
        }
        
        if (error.message.includes('Network') || error.message.includes('fetch')) {
            return 'NETWORK_ERROR';
        }
        
        if (error.message.includes('Template not found') || error.message.includes('404')) {
            return 'TEMPLATE_NOT_FOUND';
        }
        
        if (error.message.includes('Provider Error')) {
            return 'PROVIDER_ERROR';
        }
        
        return 'UNKNOWN_ERROR';
    }

    _isRetryableError(error) {
        const retryableTypes = [
            'TIMEOUT_ERROR',
            'NETWORK_ERROR',
            'RATE_LIMIT_ERROR',
            'PROVIDER_ERROR'
        ];
        
        const errorType = this._determineErrorType(error);
        return retryableTypes.includes(errorType);
    }

    _enhanceError(error, context, attemptCount) {
        const enhanced = new Error(error.message);
        enhanced.name = error.name;
        enhanced.originalError = error;
        enhanced.context = context;
        enhanced.attemptCount = attemptCount;
        enhanced.type = this._determineErrorType(error);
        enhanced.timestamp = new Date().toISOString();
        
        return enhanced;
    }

    _generateUserMessage(errorInfo) {
        const messages = {
            'VALIDATION_ERROR': 'Please check your input data and ensure all required fields are provided correctly.',
            'API_AUTHENTICATION_ERROR': 'Authentication failed. Please verify your API key is correct and has the necessary permissions.',
            'RATE_LIMIT_ERROR': 'Service is temporarily busy. Please try again in a few moments.',
            'TIMEOUT_ERROR': 'Request timed out. Please check your network connection and try again.',
            'NETWORK_ERROR': 'Network connection issue. Please check your internet connection.',
            'TEMPLATE_NOT_FOUND': 'The requested template could not be found. Please verify the template name and category.',
            'PROVIDER_ERROR': 'There was an issue with the AI service. Please try again later.',
            'UNKNOWN_ERROR': 'An unexpected error occurred. Please contact support if the issue persists.'
        };
        
        return messages[errorInfo.type] || messages['UNKNOWN_ERROR'];
    }

    _generateTechnicalDetails(errorInfo) {
        return {
            type: errorInfo.type,
            message: errorInfo.message,
            provider: errorInfo.provider,
            timestamp: errorInfo.timestamp,
            context: errorInfo.context
        };
    }

    _generateSuggestedActions(errorInfo) {
        const actions = {
            'VALIDATION_ERROR': [
                'Check that all required fields are provided',
                'Verify field types match expected formats',
                'Review the template schema documentation'
            ],
            'API_AUTHENTICATION_ERROR': [
                'Verify API key is set correctly in environment variables',
                'Check API key has not expired',
                'Ensure API key has necessary permissions'
            ],
            'RATE_LIMIT_ERROR': [
                'Wait a few moments before retrying',
                'Consider implementing request queuing',
                'Review API rate limits for your plan'
            ],
            'TIMEOUT_ERROR': [
                'Check network connectivity',
                'Try reducing the request size',
                'Consider increasing timeout settings'
            ],
            'TEMPLATE_NOT_FOUND': [
                'Verify template name spelling',
                'Check template category is correct',
                'Ensure template exists in the repository'
            ]
        };
        
        return actions[errorInfo.type] || ['Contact technical support for assistance'];
    }

    _determineSeverity(errorInfo) {
        const severityMap = {
            'VALIDATION_ERROR': 'LOW',
            'TEMPLATE_NOT_FOUND': 'LOW',
            'API_AUTHENTICATION_ERROR': 'HIGH',
            'RATE_LIMIT_ERROR': 'MEDIUM',
            'TIMEOUT_ERROR': 'MEDIUM',
            'NETWORK_ERROR': 'MEDIUM',
            'PROVIDER_ERROR': 'HIGH',
            'UNKNOWN_ERROR': 'HIGH'
        };
        
        return severityMap[errorInfo.type] || 'MEDIUM';
    }

    _updateMetrics(errorInfo) {
        if (!this.enableMetrics) return;
        
        this.metrics.totalErrors++;
        
        if (!this.metrics.errorsByType[errorInfo.type]) {
            this.metrics.errorsByType[errorInfo.type] = 0;
        }
        this.metrics.errorsByType[errorInfo.type]++;
        
        if (!this.metrics.errorsByProvider[errorInfo.provider]) {
            this.metrics.errorsByProvider[errorInfo.provider] = 0;
        }
        this.metrics.errorsByProvider[errorInfo.provider]++;
    }

    _logError(errorInfo, attempt = 0) {
        const logData = {
            level: 'ERROR',
            timestamp: errorInfo.timestamp,
            type: errorInfo.type,
            message: errorInfo.message,
            provider: errorInfo.provider,
            attempt: attempt,
            context: errorInfo.context
        };
        
        if (this.logLevel === 'DEBUG' || this.logLevel === 'INFO') {
            console.error('[ERROR]', JSON.stringify(logData, null, 2));
        }
    }

    _logRetryAttempt(context, attempt, error) {
        if (this.logLevel === 'DEBUG') {
            console.log(`[RETRY] Attempt ${attempt}/${this.maxRetries} failed: ${error.message}`);
        }
    }

    _logRetrySuccess(context, attempt) {
        if (this.logLevel === 'DEBUG' || this.logLevel === 'INFO') {
            console.log(`[RETRY_SUCCESS] Succeeded on attempt ${attempt}`);
        }
    }

    _logFinalFailure(error) {
        console.error(`[FINAL_FAILURE] All retry attempts failed: ${error.message}`);
    }

    async _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = ErrorHandler;
