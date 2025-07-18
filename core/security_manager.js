/**
 * Security Headers and CORS Configuration
 * Part of the n8n Claude Prompt System
 *
 * Features:
 * - Enhanced security headers
 * - Advanced CORS configuration
 * - Content Security Policy
 * - Security monitoring and reporting
 *
 * @author Bader Abdulrahim
 * @version 1.0.0
 */

const helmet = require('helmet');

class SecurityManager {
    constructor(options = {}) {
        this.config = options.config || {};
        this.environment = options.environment || 'development';
        this.securityViolations = [];
        this.maxViolations = 1000; // Keep last 1000 violations
    }

    /**
     * Get helmet configuration with enhanced security headers
     */
    getHelmetConfig() {
        const isDevelopment = this.environment === 'development';
        const isProduction = this.environment === 'production';

        return {
            // Content Security Policy
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: ["'self'"],
                    scriptSrc: [
                        "'self'",
                        "'unsafe-inline'", // Only in development
                        ...(isDevelopment ? ["'unsafe-eval'"] : [])
                    ],
                    styleSrc: ["'self'", "'unsafe-inline'"],
                    imgSrc: ["'self'", "data:", "https:"],
                    connectSrc: [
                        "'self'",
                        "https://api.anthropic.com",
                        "https://api.openai.com",
                        ...(isDevelopment ? ["ws:", "wss:"] : [])
                    ],
                    fontSrc: ["'self'"],
                    objectSrc: ["'none'"],
                    mediaSrc: ["'self'"],
                    frameSrc: ["'none'"],
                    workerSrc: ["'self'"],
                    upgradeInsecureRequests: isProduction ? [] : null
                }
            },

            // HTTP Strict Transport Security
            hsts: {
                maxAge: 31536000, // 1 year
                includeSubDomains: true,
                preload: isProduction
            },

            // X-Frame-Options
            frameguard: {
                action: 'deny'
            },

            // X-Content-Type-Options
            noSniff: true,

            // X-XSS-Protection
            xssFilter: true,

            // Referrer Policy
            referrerPolicy: {
                policy: ['same-origin']
            },

            // Feature Policy / Permissions Policy
            permittedCrossDomainPolicies: false,

            // Hide X-Powered-By header
            hidePoweredBy: true,

            // DNS Prefetch Control
            dnsPrefetchControl: {
                allow: false
            },

            // Don't infer MIME type
            noSniff: true,

            // Origin Agent Cluster
            originAgentCluster: true,

            // Cross-Origin Embedder Policy
            crossOriginEmbedderPolicy: isProduction ? { policy: 'require-corp' } : false,

            // Cross-Origin Opener Policy
            crossOriginOpenerPolicy: {
                policy: 'same-origin'
            },

            // Cross-Origin Resource Policy
            crossOriginResourcePolicy: {
                policy: 'same-origin'
            }
        };
    }

    /**
     * Get CORS configuration
     */
    getCorsConfig() {
        const allowedOrigins = this.config.allowedOrigins || [
            'http://localhost:5678',
            'http://localhost:3000'
        ];

        return {
            origin: (origin, callback) => {
                // Allow requests with no origin (mobile apps, Postman, etc.)
                if (!origin) return callback(null, true);

                if (allowedOrigins.includes(origin)) {
                    callback(null, true);
                } else {
                    this.logSecurityViolation('cors_violation', {
                        origin,
                        allowedOrigins,
                        timestamp: new Date().toISOString()
                    });
                    callback(new Error(`Origin ${origin} not allowed by CORS`));
                }
            },
            credentials: true,
            optionsSuccessStatus: 200,
            maxAge: 86400, // 24 hours
            allowedHeaders: [
                'Origin',
                'X-Requested-With',
                'Content-Type',
                'Accept',
                'Authorization',
                'X-API-Key',
                'X-Client-Version',
                'X-Request-ID'
            ],
            exposedHeaders: [
                'X-Request-ID',
                'X-Rate-Limit-Remaining',
                'X-Rate-Limit-Reset',
                'Retry-After'
            ]
        };
    }

    /**
     * Security middleware for additional headers
     */
    securityMiddleware() {
        return (req, res, next) => {
            // Add request ID for tracking
            if (!req.headers['x-request-id']) {
                req.requestId = this.generateRequestId();
                res.set('X-Request-ID', req.requestId);
            }

            // Add security headers not covered by helmet
            res.set({
                'X-Content-Type-Options': 'nosniff',
                'X-Frame-Options': 'DENY',
                'X-XSS-Protection': '1; mode=block',
                'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
                'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0',
                'Surrogate-Control': 'no-store'
            });

            // Add rate limiting headers if available
            if (req.rateLimit) {
                res.set({
                    'X-Rate-Limit-Limit': req.rateLimit.limit,
                    'X-Rate-Limit-Remaining': req.rateLimit.remaining,
                    'X-Rate-Limit-Reset': new Date(req.rateLimit.resetTime).toISOString()
                });
            }

            // Security monitoring
            this.monitorRequest(req);

            next();
        };
    }

    /**
     * Monitor requests for security violations
     */
    monitorRequest(req) {
        const suspiciousPatterns = [
            // SQL injection patterns
            /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION)\b)/i,
            // XSS patterns
            /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
            // Path traversal
            /\.\.[\/\\]/,
            // Command injection
            /[;&|`$]/
        ];

        const checkString = JSON.stringify(req.body || '') + JSON.stringify(req.query || '');
        
        for (const pattern of suspiciousPatterns) {
            if (pattern.test(checkString)) {
                this.logSecurityViolation('suspicious_pattern', {
                    pattern: pattern.source,
                    url: req.url,
                    method: req.method,
                    userAgent: req.headers['user-agent'],
                    ip: req.ip,
                    timestamp: new Date().toISOString()
                });
                break;
            }
        }

        // Check for abnormally large requests
        if (req.headers['content-length'] && parseInt(req.headers['content-length']) > 50 * 1024 * 1024) {
            this.logSecurityViolation('large_request', {
                contentLength: req.headers['content-length'],
                url: req.url,
                ip: req.ip,
                timestamp: new Date().toISOString()
            });
        }

        // Check for missing user agent (possible bot)
        if (!req.headers['user-agent']) {
            this.logSecurityViolation('missing_user_agent', {
                url: req.url,
                ip: req.ip,
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * Log security violations
     */
    logSecurityViolation(type, details) {
        const violation = {
            type,
            details,
            timestamp: new Date().toISOString(),
            id: this.generateRequestId()
        };

        this.securityViolations.push(violation);

        // Keep only the last maxViolations
        if (this.securityViolations.length > this.maxViolations) {
            this.securityViolations.shift();
        }

        // Log to console (in production, send to monitoring service)
        console.warn(`[SECURITY] ${type}:`, details);
    }

    /**
     * Generate unique request ID
     */
    generateRequestId() {
        return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Get security metrics
     */
    getSecurityMetrics() {
        const now = Date.now();
        const last24h = now - (24 * 60 * 60 * 1000);
        const lastHour = now - (60 * 60 * 1000);

        const recentViolations = this.securityViolations.filter(
            v => new Date(v.timestamp).getTime() > last24h
        );

        const recentViolationsLastHour = this.securityViolations.filter(
            v => new Date(v.timestamp).getTime() > lastHour
        );

        const violationsByType = {};
        recentViolations.forEach(v => {
            violationsByType[v.type] = (violationsByType[v.type] || 0) + 1;
        });

        return {
            totalViolations: this.securityViolations.length,
            violationsLast24h: recentViolations.length,
            violationsLastHour: recentViolationsLastHour.length,
            violationsByType,
            isSecure: recentViolationsLastHour.length < 10, // Threshold for concern
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Get recent security violations for reporting
     */
    getRecentViolations(limit = 50) {
        return this.securityViolations
            .slice(-limit)
            .reverse(); // Most recent first
    }

    /**
     * Clear old security violations
     */
    clearOldViolations(olderThanDays = 7) {
        const cutoffTime = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
        
        this.securityViolations = this.securityViolations.filter(
            v => new Date(v.timestamp).getTime() > cutoffTime
        );
    }

    /**
     * Content Security Policy violation reporting endpoint
     */
    cspReportHandler() {
        return (req, res) => {
            try {
                const report = req.body;
                
                this.logSecurityViolation('csp_violation', {
                    report,
                    userAgent: req.headers['user-agent'],
                    ip: req.ip,
                    timestamp: new Date().toISOString()
                });

                res.status(204).end();
            } catch (error) {
                console.error('Error handling CSP report:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        };
    }
}

module.exports = SecurityManager;