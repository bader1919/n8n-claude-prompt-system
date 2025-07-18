/**
 * API Server - Express.js server with authentication and security
 * Part of the n8n Claude Prompt System
 *
 * Features:
 * - Authentication middleware
 * - Rate limiting and security headers
 * - Template management endpoints
 * - Health checks and monitoring
 * - Input validation and sanitization
 *
 * @author Bader Abdulrahim
 * @version 1.0.0
 */

const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const { body, validationResult } = require('express-validator');
require('dotenv').config();

const TemplateManager = require('./core/template_manager');
const { ErrorHandler, ValidationError, AuthenticationError } = require('./core/error_handler');
const HealthMonitor = require('./core/health_monitor');
const ClaudeProvider = require('./providers/claude_provider');
const CacheManager = require('./core/cache_manager');
const ConnectionPoolManager = require('./core/connection_pool');
const PerformanceMonitor = require('./core/performance_monitor');
const config = require('./config/basic-config.json');

class ApiServer {
    constructor() {
        this.app = express();
        this.port = config.application.port || 3000;
        this.errorHandler = new ErrorHandler({
            logLevel: config.monitoring.logLevel || 'info',
            sanitizeErrors: true
        });

        // Initialize performance components
        this.cacheManager = new CacheManager({
            redis: { enabled: process.env.REDIS_ENABLED !== 'false' }
        });
        this.connectionPool = new ConnectionPoolManager({
            maxSockets: 50,
            timeout: 30000,
            batching: { enabled: true, maxBatchSize: 10 }
        });
        this.performanceMonitor = new PerformanceMonitor({
            interval: 5000,
            gc: { enabled: true, threshold: 0.7 }
        });

        this.templateManager = new TemplateManager();
        this.providers = new Map();
        this.healthMonitor = new HealthMonitor();

        this.initializeProviders();
        this.setupHealthChecks();
        this.setupMiddleware();
        this.setupRoutes();
        this.setupErrorHandling();
        this.setupPerformanceMonitoring();
    }

    /**
     * Setup health checks for monitoring
     */
    setupHealthChecks() {
        // Register template manager health check
        this.healthMonitor.registerService('templateManager', async () => {
            try {
                const stats = this.templateManager.getTemplateStats();
                return { healthy: true, templates: stats.totalTemplates };
            } catch (error) {
                return { healthy: false, error: error.message };
            }
        }, { critical: true });

        // Register provider health checks
        for (const [name, provider] of this.providers.entries()) {
            this.healthMonitor.registerService(`provider_${name}`, async () => {
                if (provider.testConnection) {
                    const result = await provider.testConnection();
                    return { healthy: result.success, ...result };
                }
                return { healthy: true };
            }, { critical: name === config.providers.defaultProvider });
        }

        // Start monitoring
        this.healthMonitor.start();
    }
    /**
     * Setup performance monitoring
     */
    setupPerformanceMonitoring() {
        // Listen to performance alerts
        this.performanceMonitor.on('alert', (alert) => {
            console.warn(`Performance Alert [${alert.severity}]: ${alert.type} - ${alert.value} (threshold: ${alert.threshold})`);

            // Take action based on alert type
            this.handlePerformanceAlert(alert);
        });

        // Listen to cache events
        this.cacheManager.on('cache:hit', (event) => {
            console.log(`Cache hit: ${event.key} from ${event.source} (age: ${event.age}ms)`);
        });

        this.cacheManager.on('cache:miss', (event) => {
            console.log(`Cache miss: ${event.key}`);
        });

        // Listen to connection pool events
        this.connectionPool.on('circuit_breaker:open', (event) => {
            console.warn(`Circuit breaker opened for ${event.hostKey} after ${event.failureCount} failures`);
        });

        this.connectionPool.on('batch:complete', (event) => {
            console.log(`Batch completed: ${event.size} requests processed`);
        });
    }

    /**
     * Handle performance alerts
     */
    handlePerformanceAlert(alert) {
        switch (alert.type) {
        case 'memory_threshold':
            if (alert.severity === 'critical') {
                // Trigger aggressive garbage collection
                if (global.gc) global.gc(true);
                // Clear some caches
                this.cacheManager.clear('*', { type: 'api_response' });
            }
            break;

        case 'response_time_threshold':
            // Increase cache TTL for frequently accessed content
            break;

        case 'error_rate_threshold':
            // Implement circuit breaker for external services
            break;
        }
    }

    initializeProviders() {
        // Initialize Claude provider if API key is available
        const claudeApiKey = process.env.ANTHROPIC_API_KEY;
        if (claudeApiKey) {
            this.providers.set('claude', new ClaudeProvider(claudeApiKey, {
                cacheManager: this.cacheManager,
                connectionPool: this.connectionPool
            }));
            console.log('Claude provider initialized with performance optimizations');
        } else {
            console.warn('ANTHROPIC_API_KEY not found, Claude provider disabled');
        }
    }

    /**
     * Setup Express middleware
     */
    setupMiddleware() {
        // Security headers
        if (config.security.headers.enableHelmet) {
            this.app.use(helmet({
                hsts: config.security.headers.enableHsts,
                xssFilter: config.security.headers.enableXssFilter,
                noSniff: config.security.headers.enableNoSniff,
                frameguard: config.security.headers.enableFrameGuard
            }));
        }

        // CORS
        if (config.security.enableCors) {
            this.app.use(cors({
                origin: config.security.allowedOrigins,
                credentials: true
            }));
        }

        // Rate limiting (disabled in test environment)
        if (config.security.enableRateLimiting && process.env.NODE_ENV !== 'test') {
            const limiter = rateLimit({
                windowMs: config.security.rateLimits.windowMs,
                max: config.security.rateLimits.maxRequests,
                message: {
                    error: true,
                    message: 'Rate limit exceeded',
                    type: 'rate_limit_error'
                }
            });

            // More restrictive rate limit for generation endpoints
            const generateLimiter = rateLimit({
                windowMs: config.security.rateLimits.windowMs,
                max: config.security.rateLimits.generateRequests,
                message: {
                    error: true,
                    message: 'Generation rate limit exceeded',
                    type: 'rate_limit_error'
                }
            });

            this.app.use('/api/', limiter);
            this.app.use('/api/generate', generateLimiter);
        }

        // Body parsing
        this.app.use(express.json({ limit: '10mb' }));
        this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

        // Request tracking middleware
        this.app.locals.healthMonitor = this.healthMonitor;
        this.app.use(this.healthMonitor.requestTrackingMiddleware());

        // Performance monitoring middleware
        this.app.use(this.performanceMonitor.expressMiddleware());

        // Request validation middleware
        if (config.security.enableInputSanitization) {
            this.app.use(this.errorHandler.validationMiddleware());
        }

        // Default route (before authentication middleware)
        this.app.get('/', (req, res) => {
            res.json({
                name: 'n8n Claude Prompt System',
                version: '1.0.0',
                status: 'running',
                endpoints: {
                    health: '/api/health',
                    templates: '/api/templates',
                    generate: '/api/generate',
                    providers: '/api/providers',
                    metrics: '/api/metrics'
                }
            });
        });

        // Authentication middleware (disabled in test environment)
        if (config.security.enableAuthentication && process.env.NODE_ENV !== 'test') {
            this.app.use('/api/', this.authenticationMiddleware.bind(this));
        }
    }

    /**
     * Authentication middleware
     */
    authenticationMiddleware(req, res, next) {
        // Skip authentication for health checks and metrics
        if (req.path === '/api/health' || req.path === '/api/metrics') {
            return next();
        }

        const apiKey = req.headers['x-api-key'] || req.headers.authorization?.replace('Bearer ', '');

        if (!apiKey) {
            return next(new AuthenticationError('API key required'));
        }

        // Basic API key validation (in production, use proper key management)
        const validApiKeys = process.env.API_KEYS?.split(',') || ['test-api-key'];

        if (!validApiKeys.includes(apiKey)) {
            return next(new AuthenticationError('Invalid API key'));
        }

        // Add user context to request
        req.user = { apiKey, authenticated: true };
        next();
    }

    /**
     * Setup API routes
     */
    setupRoutes() {
        // Health check endpoint
        this.app.get('/api/health', this.healthCheck.bind(this));

        // Additional health endpoints
        this.app.get('/api/health/ready', this.readinessCheck.bind(this));
        this.app.get('/api/health/live', this.livenessCheck.bind(this));

        // Template management endpoints
        this.app.get('/api/templates', this.getTemplates.bind(this));
        this.app.get('/api/templates/:category', this.getTemplatesByCategory.bind(this));
        this.app.get('/api/templates/:category/:name', this.getTemplate.bind(this));

        // Generation endpoint with validation
        this.app.post('/api/generate', [
            body('template').notEmpty().withMessage('Template is required'),
            body('variables').optional().isObject().withMessage('Variables must be an object'),
            body('provider').optional().isString().withMessage('Provider must be a string'),
            body('options').optional().isObject().withMessage('Options must be an object')
        ], this.generateCompletion.bind(this));

        // Provider endpoints
        this.app.get('/api/providers', this.getProviders.bind(this));
        this.app.post('/api/providers/:provider/test', this.testProvider.bind(this));

        // Metrics endpoint
        this.app.get('/api/metrics', this.getMetrics.bind(this));

        // Performance endpoints
        this.app.get('/api/performance', this.getPerformanceMetrics.bind(this));
        this.app.get('/api/cache/stats', this.getCacheStats.bind(this));
        this.app.post('/api/cache/clear', this.clearCache.bind(this));
        this.app.post('/api/cache/warm', this.warmCache.bind(this));

        // Batch generation endpoint
        this.app.post('/api/generate/batch', [
            body('requests').isArray().withMessage('Requests must be an array'),
            body('requests.*.template').notEmpty().withMessage('Each request must have a template'),
            body('options').optional().isObject().withMessage('Options must be an object')
        ], this.generateBatchCompletion.bind(this));

        // Remove the duplicate default route from here
    }

    /**
     * Health check endpoint
     */
    async healthCheck(req, res) {
        try {
            const health = this.healthMonitor.getHealthStatus();
            const statusCode = health.status === 'healthy' ? 200 :
                health.status === 'degraded' ? 200 : 503;

            res.status(statusCode).json(health);
        } catch (error) {
            res.status(500).json({
                status: 'unhealthy',
                error: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * Readiness check endpoint (for load balancers)
     */
    readinessCheck(req, res) {
        const readiness = this.healthMonitor.getReadinessStatus();
        const statusCode = readiness.ready ? 200 : 503;
        res.status(statusCode).json(readiness);
    }

    /**
     * Liveness check endpoint (for container orchestration)
     */
    livenessCheck(req, res) {
        const liveness = this.healthMonitor.getLivenessStatus();
        res.status(200).json(liveness);
    }

    /**
     * Get all templates
     */
    async getTemplates(req, res, next) {
        try {
            const templates = this.templateManager.getAllTemplates();
            res.json({
                success: true,
                templates,
                count: templates.length
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Get templates by category
     */
    async getTemplatesByCategory(req, res, next) {
        try {
            const { category } = req.params;
            const templates = this.templateManager.getTemplatesByCategory(category);
            res.json({
                success: true,
                category,
                templates,
                count: templates.length
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Get specific template
     */
    async getTemplate(req, res, next) {
        try {
            const { category, name } = req.params;
            const templateKey = `${category}/${name}`;
            const template = await this.templateManager.getTemplate(templateKey);

            if (!template) {
                return res.status(404).json({
                    error: true,
                    message: 'Template not found'
                });
            }

            res.json({
                success: true,
                template
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Generate completion
     */
    async generateCompletion(req, res, next) {
        try {
            // Validate request
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                throw new ValidationError('Validation failed', errors.array());
            }

            const { template, variables = {}, provider = 'claude', options = {} } = req.body;

            // Get provider
            const providerInstance = this.providers.get(provider);
            if (!providerInstance) {
                throw new ValidationError(`Provider '${provider}' not available`);
            }

            // Get template content
            const templateData = await this.templateManager.getTemplate(template);
            if (!templateData) {
                throw new ValidationError(`Template '${template}' not found`);
            }

            // Replace variables in template
            let prompt = templateData.content;
            for (const [key, value] of Object.entries(variables)) {
                const placeholder = `{{${key}}}`;
                prompt = prompt.replace(new RegExp(placeholder, 'g'), value);
            }

            // Generate completion
            const startTime = Date.now();
            const result = await providerInstance.generateCompletion(prompt, options);
            const responseTime = Date.now() - startTime;

            // Update template usage
            await this.templateManager.updateTemplateUsage(template, {
                success: true,
                responseTime,
                tokensUsed: result.usage?.totalTokens || 0,
                cost: result.cost || 0
            });

            res.json({
                success: true,
                result: {
                    content: result.content,
                    template,
                    provider,
                    usage: result.usage,
                    cost: result.cost,
                    responseTime,
                    model: result.model
                }
            });

        } catch (error) {
            // Update template usage for failed generation
            if (req.body.template) {
                await this.templateManager.updateTemplateUsage(req.body.template, {
                    success: false,
                    responseTime: 0,
                    tokensUsed: 0,
                    cost: 0
                });
            }
            next(error);
        }
    }

    /**
     * Get available providers
     */
    getProviders(req, res) {
        const providers = Array.from(this.providers.entries()).map(([name, provider]) => ({
            name,
            models: provider.getAvailableModels ? provider.getAvailableModels() : [],
            available: true
        }));

        res.json({
            success: true,
            providers,
            default: config.providers.defaultProvider
        });
    }

    /**
     * Test provider connection
     */
    async testProvider(req, res, next) {
        try {
            const { provider } = req.params;
            const providerInstance = this.providers.get(provider);

            if (!providerInstance) {
                throw new ValidationError(`Provider '${provider}' not available`);
            }

            const result = await providerInstance.testConnection();
            res.json({
                success: true,
                provider,
                test: result
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Get system metrics
     */
    getMetrics(req, res) {
        const templateStats = this.templateManager.getTemplateStats();
        const healthMetrics = this.healthMonitor.getMetrics();
        const performanceMetrics = this.performanceMonitor.getMetrics();
        const cacheMetrics = this.cacheManager.getMetrics();
        const connectionMetrics = this.connectionPool.getMetrics();

        res.json({
            success: true,
            metrics: {
                ...healthMetrics,
                performance: performanceMetrics.current,
                cache: cacheMetrics,
                connectionPool: connectionMetrics,
                memory: healthMetrics.system?.memory || {},
                templates: templateStats,
                providers: Array.from(this.providers.keys()),
                timestamp: new Date().toISOString()
            }
        });
    }

    /**
     * Get detailed performance metrics
     */
    async getPerformanceMetrics(req, res, next) {
        try {
            const performanceMetrics = this.performanceMonitor.getMetrics();
            const recommendations = this.performanceMonitor.getRecommendations();
            const healthStatus = await this.performanceMonitor.healthCheck();

            res.json({
                success: true,
                performance: {
                    current: performanceMetrics.current,
                    historical: performanceMetrics.historical.slice(-10), // Last 10 snapshots
                    recommendations,
                    health: healthStatus,
                    alerts: performanceMetrics.alerts,
                    gcStats: performanceMetrics.gcStats
                }
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Get cache statistics
     */
    async getCacheStats(req, res, next) {
        try {
            const cacheMetrics = this.cacheManager.getMetrics();
            const cacheHealth = await this.cacheManager.healthCheck();

            res.json({
                success: true,
                cache: {
                    metrics: cacheMetrics,
                    health: cacheHealth,
                    policies: this.cacheManager.ttlPolicies
                }
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Clear cache
     */
    async clearCache(req, res, next) {
        try {
            const { pattern, type } = req.body;
            await this.cacheManager.clear(pattern, { type });

            res.json({
                success: true,
                message: 'Cache cleared successfully',
                pattern: pattern || 'all',
                type: type || 'all'
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Warm cache
     */
    async warmCache(req, res, next) {
        try {
            const { data, options = {} } = req.body;

            if (!data || typeof data !== 'object') {
                throw new ValidationError('Cache data must be provided as an object');
            }

            const successful = await this.cacheManager.warmCache(data, options);

            res.json({
                success: true,
                message: 'Cache warming completed',
                itemsWarmed: successful,
                totalItems: Object.keys(data).length
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Generate batch completions
     */
    async generateBatchCompletion(req, res, next) {
        try {
            // Validate request
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                throw new ValidationError('Validation failed', errors.array());
            }

            const { requests, options = {} } = req.body;
            const provider = options.provider || 'claude';

            // Get provider
            const providerInstance = this.providers.get(provider);
            if (!providerInstance) {
                throw new ValidationError(`Provider '${provider}' not available`);
            }

            // Check if provider supports batching
            if (!providerInstance.batchCompletions) {
                throw new ValidationError(`Provider '${provider}' does not support batch processing`);
            }

            // Prepare batch requests
            const batchRequests = await Promise.all(
                requests.map(async (request, index) => {
                    const { template, variables = {}, options: requestOptions = {} } = request;

                    // Get template content
                    const templateData = await this.templateManager.getTemplate(template);
                    if (!templateData) {
                        throw new ValidationError(`Template '${template}' not found`);
                    }

                    // Replace variables in template
                    let prompt = templateData.content;
                    for (const [key, value] of Object.entries(variables)) {
                        const placeholder = `{{${key}}}`;
                        prompt = prompt.replace(new RegExp(placeholder, 'g'), value);
                    }

                    return {
                        prompt,
                        options: { ...options, ...requestOptions },
                        originalIndex: index,
                        template
                    };
                })
            );

            // Execute batch
            const startTime = Date.now();
            const batchResult = await providerInstance.batchCompletions(batchRequests, options);
            const totalTime = Date.now() - startTime;

            // Update template usage for each request
            const updatePromises = batchRequests.map(async (request, index) => {
                const result = batchResult.results[index];
                await this.templateManager.updateTemplateUsage(request.template, {
                    success: result.success,
                    responseTime: totalTime / batchRequests.length,
                    tokensUsed: result.success ? result.result.usage?.totalTokens || 0 : 0,
                    cost: result.success ? result.result.cost || 0 : 0
                });
            });

            await Promise.allSettled(updatePromises);

            res.json({
                success: true,
                batch: {
                    results: batchResult.results.map(result => ({
                        success: result.success,
                        content: result.success ? result.result.content : null,
                        error: result.success ? null : result.error,
                        usage: result.success ? result.result.usage : null,
                        cost: result.success ? result.result.cost : null,
                        cached: result.success ? result.result.cached : false
                    })),
                    summary: {
                        ...batchResult.summary,
                        provider,
                        totalTime
                    }
                }
            });

        } catch (error) {
            next(error);
        }
    }

    /**
     * Setup error handling
     */
    setupErrorHandling() {
        // 404 handler
        this.app.use('*', (req, res) => {
            res.status(404).json({
                error: true,
                message: 'Endpoint not found',
                type: 'not_found_error'
            });
        });

        // Global error handler
        this.app.use(this.errorHandler.expressMiddleware());
    }

    /**
     * Start the server
     */
    start() {
        this.app.listen(this.port, config.application.host, () => {
            console.log(`n8n Claude Prompt System API server running on ${config.application.host}:${this.port}`);
            console.log(`Health check: http://${config.application.host}:${this.port}/api/health`);
            console.log(`API docs: http://${config.application.host}:${this.port}/`);
            console.log(`Performance metrics: http://${config.application.host}:${this.port}/api/performance`);
        });
    }

    /**
     * Graceful shutdown
     */
    async shutdown() {
        console.log('Shutting down server...');

        // Close performance components
        if (this.performanceMonitor) {
            this.performanceMonitor.stop();
        }

        if (this.cacheManager) {
            await this.cacheManager.close();
        }

        if (this.connectionPool) {
            await this.connectionPool.close();
        }

        // Close providers
        for (const [, provider] of this.providers.entries()) {
            if (provider.close) {
                await provider.close();
            }
        }

        console.log('Server shutdown complete');
    }
}

// Start server if this file is run directly
if (require.main === module) {
    const server = new ApiServer();
    server.start();

    // Graceful shutdown
    process.on('SIGTERM', async () => {
        console.log('SIGTERM received, shutting down gracefully');
        await server.shutdown();
        process.exit(0);
    });

    process.on('SIGINT', async () => {
        console.log('SIGINT received, shutting down gracefully');
        await server.shutdown();
        process.exit(0);
    });
}

module.exports = ApiServer;
