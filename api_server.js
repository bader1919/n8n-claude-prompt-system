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
const config = require('./config/basic-config.json');

class ApiServer {
    constructor() {
        this.app = express();
        this.port = config.application.port || 3000;
        this.errorHandler = new ErrorHandler({
            logLevel: config.monitoring.logLevel || 'info',
            sanitizeErrors: true
        });
        this.templateManager = new TemplateManager();
        this.providers = new Map();
        this.healthMonitor = new HealthMonitor();

        this.initializeProviders();
        this.setupHealthChecks();
        this.setupMiddleware();
        this.setupRoutes();
        this.setupErrorHandling();
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
    initializeProviders() {
        // Initialize Claude provider if API key is available
        const claudeApiKey = process.env.ANTHROPIC_API_KEY;
        if (claudeApiKey) {
            this.providers.set('claude', new ClaudeProvider(claudeApiKey));
            console.log('Claude provider initialized');
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

        // Rate limiting - disable in test environment
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

        // Authentication middleware
        if (config.security.enableAuthentication) {
            this.app.use('/api/', this.authenticationMiddleware.bind(this));
        }
    }

    /**
     * Authentication middleware
     */
    authenticationMiddleware(req, res, next) {
        // Skip authentication for health checks - note that the path is relative to /api/
        if (req.path === '/health' || req.path === '/metrics') {
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

        res.json({
            success: true,
            metrics: {
                ...healthMetrics,
                templates: templateStats,
                providers: Array.from(this.providers.keys()),
                timestamp: new Date().toISOString()
            }
        });
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
        });
    }
}

// Start server if this file is run directly
if (require.main === module) {
    const server = new ApiServer();
    server.start();
}

module.exports = ApiServer;
