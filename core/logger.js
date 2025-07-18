/**
 * Comprehensive Logging Service
 * Part of the n8n Claude Prompt System
 *
 * Features:
 * - Structured JSON logging with Winston
 * - Multiple log levels with filtering
 * - Request correlation IDs
 * - Performance metrics logging
 * - Security event logging
 * - GDPR-compliant data sanitization
 * - Log rotation and retention
 * - Integration-ready for external monitoring
 *
 * @author Bader Abdulrahim
 * @version 1.0.0
 */

const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class Logger {
    constructor(options = {}) {
        this.config = {
            level: options.level || process.env.LOG_LEVEL || 'info',
            environment: options.environment || process.env.NODE_ENV || 'development',
            logDir: options.logDir || './logs',
            maxFiles: options.maxFiles || '30d',
            maxSize: options.maxSize || '100m',
            enableConsole: options.enableConsole !== false,
            enableFile: options.enableFile !== false,
            enableRotation: options.enableRotation !== false,
            serviceName: options.serviceName || 'n8n-claude-prompt-system',
            version: options.version || '1.0.0'
        };

        this.sensitiveFields = [
            'password', 'secret', 'token', 'key', 'apikey', 'api_key',
            'authorization', 'auth', 'bearer', 'cookie', 'session',
            'x-api-key', 'anthropic_api_key', 'openai_api_key'
        ];

        this.logger = this.createLogger();
        this.correlationStore = new Map();
    }

    /**
     * Create Winston logger instance with transports
     */
    createLogger() {
        const logFormat = winston.format.combine(
            winston.format.timestamp({
                format: 'YYYY-MM-DD HH:mm:ss.SSS'
            }),
            winston.format.errors({ stack: true }),
            winston.format.json(),
            winston.format.printf((info) => {
                const log = {
                    timestamp: info.timestamp,
                    level: info.level,
                    service: this.config.serviceName,
                    version: this.config.version,
                    environment: this.config.environment,
                    message: info.message,
                    ...info
                };

                // Remove duplicate fields
                delete log.timestamp;
                delete log.level;

                return JSON.stringify({
                    timestamp: info.timestamp,
                    level: info.level,
                    ...log
                });
            })
        );

        const transports = [];

        // Console transport for development
        if (this.config.enableConsole) {
            transports.push(new winston.transports.Console({
                level: this.config.level,
                format: this.config.environment === 'development' 
                    ? winston.format.combine(
                        winston.format.colorize(),
                        winston.format.simple()
                    )
                    : logFormat
            }));
        }

        // File transports for production
        if (this.config.enableFile) {
            // Application logs with rotation
            if (this.config.enableRotation) {
                transports.push(new DailyRotateFile({
                    filename: path.join(this.config.logDir, 'application-%DATE%.log'),
                    datePattern: 'YYYY-MM-DD',
                    maxFiles: this.config.maxFiles,
                    maxSize: this.config.maxSize,
                    level: this.config.level,
                    format: logFormat
                }));

                // Error logs separate file
                transports.push(new DailyRotateFile({
                    filename: path.join(this.config.logDir, 'error-%DATE%.log'),
                    datePattern: 'YYYY-MM-DD',
                    maxFiles: this.config.maxFiles,
                    maxSize: this.config.maxSize,
                    level: 'error',
                    format: logFormat
                }));

                // Security logs separate file
                transports.push(new DailyRotateFile({
                    filename: path.join(this.config.logDir, 'security-%DATE%.log'),
                    datePattern: 'YYYY-MM-DD',
                    maxFiles: this.config.maxFiles,
                    maxSize: this.config.maxSize,
                    level: 'warn',
                    format: logFormat
                }));
            } else {
                transports.push(new winston.transports.File({
                    filename: path.join(this.config.logDir, 'application.log'),
                    level: this.config.level,
                    format: logFormat
                }));
            }
        }

        return winston.createLogger({
            level: this.config.level,
            format: logFormat,
            transports,
            exitOnError: false
        });
    }

    /**
     * Generate correlation ID for request tracing
     */
    generateCorrelationId() {
        return `req_${Date.now()}_${uuidv4().split('-')[0]}`;
    }

    /**
     * Set correlation ID for current context
     */
    setCorrelationId(correlationId, context = {}) {
        this.correlationStore.set(correlationId, {
            ...context,
            createdAt: new Date().toISOString()
        });
        return correlationId;
    }

    /**
     * Get correlation context
     */
    getCorrelationContext(correlationId) {
        return this.correlationStore.get(correlationId) || {};
    }

    /**
     * Clean up old correlation IDs (prevent memory leaks)
     */
    cleanupCorrelations() {
        const now = Date.now();
        for (const [id, context] of this.correlationStore.entries()) {
            const age = now - new Date(context.createdAt).getTime();
            if (age > 300000) { // 5 minutes
                this.correlationStore.delete(id);
            }
        }
    }

    /**
     * Sanitize sensitive data for GDPR compliance
     */
    sanitizeData(data) {
        if (!data || typeof data !== 'object') {
            return data;
        }

        const sanitized = Array.isArray(data) ? [] : {};

        for (const [key, value] of Object.entries(data)) {
            const lowerKey = key.toLowerCase();
            
            // Check if field is sensitive
            if (this.sensitiveFields.some(field => lowerKey.includes(field))) {
                sanitized[key] = '[REDACTED]';
            } else if (typeof value === 'object' && value !== null) {
                sanitized[key] = this.sanitizeData(value);
            } else if (typeof value === 'string' && value.length > 1000) {
                // Truncate very long strings but preserve structure
                sanitized[key] = value.substring(0, 1000) + '...[TRUNCATED]';
            } else {
                sanitized[key] = value;
            }
        }

        return sanitized;
    }

    /**
     * Create log entry with common fields
     */
    createLogEntry(level, message, metadata = {}) {
        const correlationId = metadata.correlationId || metadata.requestId;
        const correlationContext = correlationId ? this.getCorrelationContext(correlationId) : {};

        return {
            message,
            correlationId,
            ...correlationContext,
            ...this.sanitizeData(metadata)
        };
    }

    /**
     * Debug level logging
     */
    debug(message, metadata = {}) {
        this.logger.debug(this.createLogEntry('debug', message, metadata));
    }

    /**
     * Info level logging
     */
    info(message, metadata = {}) {
        this.logger.info(this.createLogEntry('info', message, metadata));
    }

    /**
     * Warning level logging
     */
    warn(message, metadata = {}) {
        this.logger.warn(this.createLogEntry('warn', message, metadata));
    }

    /**
     * Error level logging
     */
    error(message, error = null, metadata = {}) {
        const errorData = error ? {
            error: {
                name: error.name,
                message: error.message,
                stack: error.stack,
                code: error.code
            }
        } : {};

        this.logger.error(this.createLogEntry('error', message, {
            ...errorData,
            ...metadata
        }));
    }

    /**
     * Security event logging
     */
    security(event, details = {}) {
        this.logger.warn(this.createLogEntry('warn', `Security Event: ${event}`, {
            eventType: 'security',
            securityEvent: event,
            ...details
        }));
    }

    /**
     * Authentication logging
     */
    auth(event, details = {}) {
        this.logger.info(this.createLogEntry('info', `Authentication: ${event}`, {
            eventType: 'authentication',
            authEvent: event,
            ...details
        }));
    }

    /**
     * API request logging
     */
    apiRequest(req, details = {}) {
        const sanitizedHeaders = this.sanitizeData(req.headers);
        const sanitizedBody = this.sanitizeData(req.body);
        const sanitizedQuery = this.sanitizeData(req.query);

        this.logger.info(this.createLogEntry('info', 'API Request', {
            eventType: 'api_request',
            method: req.method,
            url: req.url,
            path: req.path,
            userAgent: req.headers['user-agent'],
            ip: req.ip || req.connection?.remoteAddress,
            headers: sanitizedHeaders,
            body: sanitizedBody,
            query: sanitizedQuery,
            contentLength: req.headers['content-length'],
            ...details
        }));
    }

    /**
     * API response logging
     */
    apiResponse(req, res, responseTime, details = {}) {
        this.logger.info(this.createLogEntry('info', 'API Response', {
            eventType: 'api_response',
            method: req.method,
            url: req.url,
            path: req.path,
            statusCode: res.statusCode,
            responseTime: `${responseTime}ms`,
            contentLength: res.get('content-length'),
            success: res.statusCode < 400,
            ...details
        }));
    }

    /**
     * Performance metrics logging
     */
    performance(metric, value, unit = 'ms', metadata = {}) {
        this.logger.info(this.createLogEntry('info', `Performance Metric: ${metric}`, {
            eventType: 'performance',
            metric,
            value,
            unit,
            ...metadata
        }));
    }

    /**
     * Health check logging
     */
    health(service, status, details = {}) {
        const level = status === 'healthy' ? 'info' : status === 'degraded' ? 'warn' : 'error';
        this.logger[level](this.createLogEntry(level, `Health Check: ${service}`, {
            eventType: 'health_check',
            service,
            status,
            ...details
        }));
    }

    /**
     * Business logic logging
     */
    business(event, details = {}) {
        this.logger.info(this.createLogEntry('info', `Business Event: ${event}`, {
            eventType: 'business',
            businessEvent: event,
            ...details
        }));
    }

    /**
     * Express middleware for request logging
     */
    requestLoggingMiddleware() {
        return (req, res, next) => {
            const startTime = Date.now();
            const correlationId = req.headers['x-correlation-id'] || this.generateCorrelationId();
            
            // Store correlation ID in request
            req.correlationId = correlationId;
            res.setHeader('x-correlation-id', correlationId);

            // Set correlation context
            this.setCorrelationId(correlationId, {
                method: req.method,
                url: req.url,
                userAgent: req.headers['user-agent'],
                ip: req.ip
            });

            // Log incoming request
            this.apiRequest(req, { correlationId });

            // Track response when finished
            res.on('finish', () => {
                const responseTime = Date.now() - startTime;
                this.apiResponse(req, res, responseTime, { correlationId });
            });

            next();
        };
    }

    /**
     * Express middleware for error logging
     */
    errorLoggingMiddleware() {
        return (error, req, res, next) => {
            this.error('Express Error Handler', error, {
                correlationId: req.correlationId,
                method: req.method,
                url: req.url,
                userAgent: req.headers['user-agent'],
                ip: req.ip
            });

            next(error);
        };
    }

    /**
     * Cleanup resources
     */
    cleanup() {
        this.cleanupCorrelations();
        if (this.logger) {
            this.logger.end();
        }
    }

    /**
     * Get current configuration
     */
    getConfig() {
        return { ...this.config };
    }

    /**
     * Update log level dynamically
     */
    setLogLevel(level) {
        this.config.level = level;
        this.logger.level = level;
        this.info('Log level updated', { newLevel: level });
    }
}

// Create singleton instance
const logger = new Logger();

// Setup periodic cleanup
setInterval(() => {
    logger.cleanupCorrelations();
}, 60000); // Every minute

module.exports = Logger;
module.exports.logger = logger;