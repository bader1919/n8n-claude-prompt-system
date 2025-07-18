/**
 * Comprehensive Monitoring Service
 * Part of the n8n Claude Prompt System
 *
 * Features:
 * - System resource monitoring (CPU, memory, disk)
 * - Performance metrics collection
 * - Error rate tracking and alerting
 * - Provider usage monitoring
 * - Security event aggregation
 * - Health status reporting
 *
 * @author Bader Abdulrahim
 * @version 1.0.0
 */

const os = require('os');
const fs = require('fs').promises;
const { logger } = require('./logger');

class MonitoringService {
    constructor(options = {}) {
        this.config = {
            metricsInterval: options.metricsInterval || 60000, // 1 minute
            alertThresholds: {
                errorRate: options.errorRateThreshold || 5.0, // 5%
                responseTime: options.responseTimeThreshold || 5000, // 5 seconds
                memoryUsage: options.memoryThreshold || 85, // 85%
                cpuUsage: options.cpuThreshold || 80, // 80%
                diskUsage: options.diskThreshold || 90 // 90%
            },
            retentionPeriod: options.retentionPeriod || 24 * 60 * 60 * 1000, // 24 hours
            enableAlerting: options.enableAlerting !== false
        };

        this.metrics = {
            requests: {
                total: 0,
                successful: 0,
                failed: 0,
                byEndpoint: new Map(),
                byMethod: new Map(),
                responseTimes: []
            },
            security: {
                authFailures: 0,
                rateLimitTriggers: 0,
                inputValidationFailures: 0,
                suspiciousRequests: 0
            },
            providers: {
                usage: new Map(),
                errors: new Map(),
                responseTimes: new Map(),
                costs: new Map()
            },
            system: {
                uptime: process.uptime(),
                startTime: Date.now(),
                errors: [],
                alerts: []
            }
        };

        this.isRunning = false;
        this.monitoringInterval = null;
    }

    /**
     * Start monitoring service
     */
    start() {
        if (this.isRunning) return;

        this.isRunning = true;
        this.monitoringInterval = setInterval(() => {
            this.collectSystemMetrics();
            this.checkAlertThresholds();
            this.cleanupOldMetrics();
        }, this.config.metricsInterval);

        logger.info('Monitoring service started', {
            eventType: 'system_start',
            metricsInterval: this.config.metricsInterval,
            alerting: this.config.enableAlerting
        });
    }

    /**
     * Stop monitoring service
     */
    stop() {
        if (!this.isRunning) return;

        this.isRunning = false;
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
        }

        logger.info('Monitoring service stopped', {
            eventType: 'system_stop'
        });
    }

    /**
     * Collect system resource metrics
     */
    async collectSystemMetrics() {
        try {
            const memoryUsage = process.memoryUsage();
            const systemMemory = {
                total: os.totalmem(),
                free: os.freemem(),
                used: os.totalmem() - os.freemem()
            };

            const cpuUsage = process.cpuUsage();
            const loadAverage = os.loadavg();

            // Get disk usage if available
            let diskUsage = null;
            try {
                const stats = await fs.stat('./');
                // Note: Disk usage calculation is platform-specific
                diskUsage = {
                    // This is a simplified version - in production you'd want proper disk monitoring
                    available: true,
                    timestamp: Date.now()
                };
            } catch (error) {
                logger.debug('Could not collect disk metrics', { error: error.message });
            }

            const systemMetrics = {
                timestamp: Date.now(),
                uptime: process.uptime(),
                memory: {
                    process: {
                        rss: memoryUsage.rss,
                        heapTotal: memoryUsage.heapTotal,
                        heapUsed: memoryUsage.heapUsed,
                        external: memoryUsage.external,
                        arrayBuffers: memoryUsage.arrayBuffers
                    },
                    system: {
                        total: systemMemory.total,
                        free: systemMemory.free,
                        used: systemMemory.used,
                        usagePercent: ((systemMemory.used / systemMemory.total) * 100).toFixed(2)
                    }
                },
                cpu: {
                    user: cpuUsage.user,
                    system: cpuUsage.system,
                    loadAverage: loadAverage
                },
                disk: diskUsage,
                platform: {
                    type: os.type(),
                    platform: os.platform(),
                    arch: os.arch(),
                    release: os.release(),
                    hostname: os.hostname()
                }
            };

            logger.performance('system_metrics', systemMetrics.memory.system.usagePercent, '%', {
                systemMetrics,
                eventType: 'system_metrics'
            });

            return systemMetrics;
        } catch (error) {
            logger.error('Error collecting system metrics', error);
            return null;
        }
    }

    /**
     * Track API request metrics
     */
    trackRequest(method, endpoint, statusCode, responseTime, metadata = {}) {
        this.metrics.requests.total++;

        if (statusCode < 400) {
            this.metrics.requests.successful++;
        } else {
            this.metrics.requests.failed++;
        }

        // Track by endpoint
        const endpointKey = `${method} ${endpoint}`;
        if (!this.metrics.requests.byEndpoint.has(endpointKey)) {
            this.metrics.requests.byEndpoint.set(endpointKey, {
                count: 0,
                errors: 0,
                totalResponseTime: 0,
                avgResponseTime: 0
            });
        }

        const endpointStats = this.metrics.requests.byEndpoint.get(endpointKey);
        endpointStats.count++;
        endpointStats.totalResponseTime += responseTime;
        endpointStats.avgResponseTime = endpointStats.totalResponseTime / endpointStats.count;

        if (statusCode >= 400) {
            endpointStats.errors++;
        }

        // Track by method
        if (!this.metrics.requests.byMethod.has(method)) {
            this.metrics.requests.byMethod.set(method, { count: 0, errors: 0 });
        }
        const methodStats = this.metrics.requests.byMethod.get(method);
        methodStats.count++;
        if (statusCode >= 400) {
            methodStats.errors++;
        }

        // Store response time
        this.metrics.requests.responseTimes.push({
            timestamp: Date.now(),
            responseTime,
            endpoint: endpointKey,
            statusCode
        });

        // Keep only recent response times
        const cutoff = Date.now() - this.config.retentionPeriod;
        this.metrics.requests.responseTimes = this.metrics.requests.responseTimes
            .filter(rt => rt.timestamp > cutoff);

        logger.performance('api_request', responseTime, 'ms', {
            method,
            endpoint,
            statusCode,
            success: statusCode < 400,
            ...metadata
        });
    }

    /**
     * Track security events
     */
    trackSecurityEvent(eventType, details = {}) {
        switch (eventType) {
        case 'auth_failure':
            this.metrics.security.authFailures++;
            break;
        case 'rate_limit':
            this.metrics.security.rateLimitTriggers++;
            break;
        case 'input_validation_failure':
            this.metrics.security.inputValidationFailures++;
            break;
        case 'suspicious_request':
            this.metrics.security.suspiciousRequests++;
            break;
        }

        logger.security(`Security Event: ${eventType}`, {
            eventType: 'security_metric',
            securityEventType: eventType,
            totalAuthFailures: this.metrics.security.authFailures,
            totalRateLimitTriggers: this.metrics.security.rateLimitTriggers,
            ...details
        });
    }

    /**
     * Track provider usage and performance
     */
    trackProviderUsage(provider, operation, success, responseTime, cost = 0, metadata = {}) {
        // Initialize provider metrics if not exists
        if (!this.metrics.providers.usage.has(provider)) {
            this.metrics.providers.usage.set(provider, { requests: 0, successes: 0, failures: 0 });
            this.metrics.providers.errors.set(provider, []);
            this.metrics.providers.responseTimes.set(provider, []);
            this.metrics.providers.costs.set(provider, { total: 0, requests: 0, average: 0 });
        }

        const usage = this.metrics.providers.usage.get(provider);
        const responseTimes = this.metrics.providers.responseTimes.get(provider);
        const costs = this.metrics.providers.costs.get(provider);

        usage.requests++;
        if (success) {
            usage.successes++;
        } else {
            usage.failures++;
            const errors = this.metrics.providers.errors.get(provider);
            errors.push({
                timestamp: Date.now(),
                operation,
                ...metadata
            });
        }

        responseTimes.push({
            timestamp: Date.now(),
            responseTime,
            operation,
            success
        });

        if (cost > 0) {
            costs.total += cost;
            costs.requests++;
            costs.average = costs.total / costs.requests;
        }

        logger.business('provider_usage', {
            provider,
            operation,
            success,
            responseTime,
            cost,
            totalRequests: usage.requests,
            successRate: ((usage.successes / usage.requests) * 100).toFixed(2),
            avgResponseTime: responseTimes.length > 0 
                ? (responseTimes.reduce((sum, rt) => sum + rt.responseTime, 0) / responseTimes.length).toFixed(2)
                : 0,
            ...metadata
        });
    }

    /**
     * Check alert thresholds and trigger alerts
     */
    checkAlertThresholds() {
        if (!this.config.enableAlerting) return;

        const now = Date.now();
        const alerts = [];

        // Check error rate
        if (this.metrics.requests.total > 0) {
            const errorRate = (this.metrics.requests.failed / this.metrics.requests.total) * 100;
            if (errorRate > this.config.alertThresholds.errorRate) {
                alerts.push({
                    type: 'error_rate',
                    severity: 'warning',
                    threshold: this.config.alertThresholds.errorRate,
                    current: errorRate.toFixed(2),
                    message: `Error rate ${errorRate.toFixed(2)}% exceeds threshold ${this.config.alertThresholds.errorRate}%`
                });
            }
        }

        // Check average response time
        const recentResponseTimes = this.metrics.requests.responseTimes
            .filter(rt => rt.timestamp > now - 300000) // Last 5 minutes
            .map(rt => rt.responseTime);

        if (recentResponseTimes.length > 0) {
            const avgResponseTime = recentResponseTimes.reduce((sum, rt) => sum + rt, 0) / recentResponseTimes.length;
            if (avgResponseTime > this.config.alertThresholds.responseTime) {
                alerts.push({
                    type: 'response_time',
                    severity: 'warning',
                    threshold: this.config.alertThresholds.responseTime,
                    current: avgResponseTime.toFixed(2),
                    message: `Average response time ${avgResponseTime.toFixed(2)}ms exceeds threshold ${this.config.alertThresholds.responseTime}ms`
                });
            }
        }

        // Check security events
        const recentSecurityEvents = [
            this.metrics.security.authFailures,
            this.metrics.security.rateLimitTriggers,
            this.metrics.security.suspiciousRequests
        ].reduce((sum, count) => sum + count, 0);

        if (recentSecurityEvents > 10) { // Threshold for security events
            alerts.push({
                type: 'security_events',
                severity: 'critical',
                threshold: 10,
                current: recentSecurityEvents,
                message: `High number of security events detected: ${recentSecurityEvents}`
            });
        }

        // Log alerts
        for (const alert of alerts) {
            this.metrics.system.alerts.push({
                ...alert,
                timestamp: now
            });

            logger.warn(`Alert: ${alert.message}`, {
                eventType: 'alert',
                alertType: alert.type,
                severity: alert.severity,
                threshold: alert.threshold,
                current: alert.current
            });
        }

        // Clean up old alerts
        this.metrics.system.alerts = this.metrics.system.alerts
            .filter(alert => alert.timestamp > now - this.config.retentionPeriod);
    }

    /**
     * Clean up old metrics to prevent memory leaks
     */
    cleanupOldMetrics() {
        const cutoff = Date.now() - this.config.retentionPeriod;

        // Clean up response times
        this.metrics.requests.responseTimes = this.metrics.requests.responseTimes
            .filter(rt => rt.timestamp > cutoff);

        // Clean up provider metrics
        for (const [provider, responseTimes] of this.metrics.providers.responseTimes.entries()) {
            this.metrics.providers.responseTimes.set(provider, 
                responseTimes.filter(rt => rt.timestamp > cutoff));
        }

        for (const [provider, errors] of this.metrics.providers.errors.entries()) {
            this.metrics.providers.errors.set(provider, 
                errors.filter(error => error.timestamp > cutoff));
        }

        // Clean up system errors
        this.metrics.system.errors = this.metrics.system.errors
            .filter(error => error.timestamp > cutoff);
    }

    /**
     * Get comprehensive metrics report
     */
    getMetrics() {
        const now = Date.now();
        const uptime = process.uptime();

        // Calculate error rate
        const errorRate = this.metrics.requests.total > 0 
            ? ((this.metrics.requests.failed / this.metrics.requests.total) * 100).toFixed(2)
            : 0;

        // Calculate average response time
        const recentResponseTimes = this.metrics.requests.responseTimes
            .filter(rt => rt.timestamp > now - 300000) // Last 5 minutes
            .map(rt => rt.responseTime);
        
        const avgResponseTime = recentResponseTimes.length > 0
            ? (recentResponseTimes.reduce((sum, rt) => sum + rt, 0) / recentResponseTimes.length).toFixed(2)
            : 0;

        // Provider statistics
        const providerStats = {};
        for (const [provider, usage] of this.metrics.providers.usage.entries()) {
            const responseTimes = this.metrics.providers.responseTimes.get(provider) || [];
            const costs = this.metrics.providers.costs.get(provider) || { total: 0, average: 0 };
            const recentResponseTimes = responseTimes
                .filter(rt => rt.timestamp > now - 300000)
                .map(rt => rt.responseTime);

            providerStats[provider] = {
                requests: usage.requests,
                successes: usage.successes,
                failures: usage.failures,
                successRate: usage.requests > 0 ? ((usage.successes / usage.requests) * 100).toFixed(2) : 0,
                avgResponseTime: recentResponseTimes.length > 0 
                    ? (recentResponseTimes.reduce((sum, rt) => sum + rt, 0) / recentResponseTimes.length).toFixed(2)
                    : 0,
                totalCost: costs.total,
                avgCost: costs.average
            };
        }

        return {
            timestamp: new Date().toISOString(),
            uptime: {
                seconds: uptime,
                human: this.formatUptime(uptime)
            },
            requests: {
                total: this.metrics.requests.total,
                successful: this.metrics.requests.successful,
                failed: this.metrics.requests.failed,
                errorRate: `${errorRate}%`,
                avgResponseTime: `${avgResponseTime}ms`,
                byEndpoint: Object.fromEntries(this.metrics.requests.byEndpoint),
                byMethod: Object.fromEntries(this.metrics.requests.byMethod)
            },
            security: {
                authFailures: this.metrics.security.authFailures,
                rateLimitTriggers: this.metrics.security.rateLimitTriggers,
                inputValidationFailures: this.metrics.security.inputValidationFailures,
                suspiciousRequests: this.metrics.security.suspiciousRequests
            },
            providers: providerStats,
            alerts: {
                active: this.metrics.system.alerts.filter(alert => 
                    alert.timestamp > now - 3600000 // Last hour
                ).length,
                recent: this.metrics.system.alerts.slice(-5) // Last 5 alerts
            }
        };
    }

    /**
     * Get health status based on metrics
     */
    getHealthStatus() {
        const metrics = this.getMetrics();
        const now = Date.now();
        
        let status = 'healthy';
        let issues = [];

        // Check error rate
        const errorRate = parseFloat(metrics.requests.errorRate);
        if (errorRate > this.config.alertThresholds.errorRate) {
            status = 'degraded';
            issues.push(`High error rate: ${metrics.requests.errorRate}`);
        }

        // Check response time
        const avgResponseTime = parseFloat(metrics.requests.avgResponseTime);
        if (avgResponseTime > this.config.alertThresholds.responseTime) {
            status = 'degraded';
            issues.push(`High response time: ${metrics.requests.avgResponseTime}`);
        }

        // Check for recent critical alerts
        const criticalAlerts = this.metrics.system.alerts.filter(alert => 
            alert.severity === 'critical' && alert.timestamp > now - 300000 // Last 5 minutes
        );
        
        if (criticalAlerts.length > 0) {
            status = 'critical';
            issues.push(`${criticalAlerts.length} critical alerts in last 5 minutes`);
        }

        return {
            status,
            timestamp: new Date().toISOString(),
            issues,
            metrics
        };
    }

    /**
     * Format uptime in human readable format
     */
    formatUptime(seconds) {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);

        const parts = [];
        if (days > 0) parts.push(`${days}d`);
        if (hours > 0) parts.push(`${hours}h`);
        if (minutes > 0) parts.push(`${minutes}m`);
        parts.push(`${secs}s`);

        return parts.join(' ');
    }

    /**
     * Express middleware for request monitoring
     */
    requestMonitoringMiddleware() {
        return (req, res, next) => {
            const startTime = Date.now();

            // Track response when finished
            res.on('finish', () => {
                const responseTime = Date.now() - startTime;
                
                this.trackRequest(
                    req.method,
                    req.route?.path || req.path,
                    res.statusCode,
                    responseTime,
                    {
                        correlationId: req.correlationId,
                        userAgent: req.headers['user-agent'],
                        contentLength: res.get('content-length')
                    }
                );
            });

            next();
        };
    }

    /**
     * Get current configuration
     */
    getConfig() {
        return { ...this.config };
    }

    /**
     * Update configuration
     */
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        logger.info('Monitoring configuration updated', { newConfig });
    }
}

module.exports = MonitoringService;