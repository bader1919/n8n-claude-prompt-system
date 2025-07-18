/**
 * Health Check and Monitoring System
 * Part of the n8n Claude Prompt System
 *
 * Features:
 * - System health monitoring
 * - Performance metrics tracking
 * - Service availability checks
 * - Resource usage monitoring
 *
 * @author Bader Abdulrahim
 * @version 1.0.0
 */

class HealthMonitor {
    constructor(options = {}) {
        this.checkInterval = options.checkInterval || 30000; // 30 seconds
        this.services = new Map();
        this.metrics = {
            requestCount: 0,
            errorCount: 0,
            responseTime: [],
            uptime: process.uptime(),
            startTime: Date.now()
        };

        this.startTime = Date.now();
        this.isRunning = false;
    }

    /**
     * Start health monitoring
     */
    start() {
        if (this.isRunning) return;

        this.isRunning = true;
        this.monitoringInterval = setInterval(() => {
            this.performHealthChecks();
        }, this.checkInterval);

        console.log('Health monitoring started');
    }

    /**
     * Stop health monitoring
     */
    stop() {
        if (!this.isRunning) return;

        this.isRunning = false;
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
        }

        console.log('Health monitoring stopped');
    }

    /**
     * Register a service for monitoring
     */
    registerService(name, checkFunction, options = {}) {
        this.services.set(name, {
            name,
            checkFunction,
            critical: options.critical || false,
            timeout: options.timeout || 5000,
            lastCheck: null,
            status: 'unknown',
            responseTime: 0,
            errorCount: 0,
            totalChecks: 0
        });
    }

    /**
     * Perform health checks on all registered services
     */
    async performHealthChecks() {
        const checkPromises = Array.from(this.services.values()).map(service =>
            this.checkService(service)
        );

        await Promise.allSettled(checkPromises);
    }

    /**
     * Check health of a specific service
     */
    async checkService(service) {
        const startTime = Date.now();
        service.totalChecks++;

        try {
            const result = await Promise.race([
                service.checkFunction(),
                this.timeout(service.timeout)
            ]);

            service.status = result?.healthy !== false ? 'healthy' : 'unhealthy';
            service.responseTime = Date.now() - startTime;
            service.lastCheck = new Date().toISOString();
            service.lastError = null;

        } catch (error) {
            service.status = 'unhealthy';
            service.responseTime = Date.now() - startTime;
            service.lastCheck = new Date().toISOString();
            service.lastError = error.message;
            service.errorCount++;

            if (service.critical) {
                console.error(`Critical service ${service.name} is unhealthy:`, error.message);
            }
        }
    }

    /**
     * Create timeout promise
     */
    timeout(ms) {
        return new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Health check timeout')), ms);
        });
    }

    /**
     * Get current health status
     */
    getHealthStatus() {
        const services = {};
        const overallStatus = this.calculateOverallStatus();

        for (const [name, service] of this.services.entries()) {
            services[name] = {
                status: service.status,
                lastCheck: service.lastCheck,
                responseTime: service.responseTime,
                errorCount: service.errorCount,
                totalChecks: service.totalChecks,
                lastError: service.lastError
            };
        }

        return {
            status: overallStatus,
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            version: process.version,
            services,
            system: this.getSystemMetrics()
        };
    }

    /**
     * Calculate overall system status
     */
    calculateOverallStatus() {
        const services = Array.from(this.services.values());

        if (services.length === 0) return 'healthy'; // No services registered is healthy

        const criticalServices = services.filter(s => s.critical);
        const unhealthyCritical = criticalServices.filter(s => s.status === 'unhealthy');

        if (unhealthyCritical.length > 0) return 'critical';

        const unhealthyServices = services.filter(s => s.status === 'unhealthy');
        const unknownServices = services.filter(s => s.status === 'unknown');

        if (unhealthyServices.length > 0) return 'degraded';
        // If all services are just unknown (not checked yet), consider healthy for basic operation
        if (unknownServices.length === services.length) return 'healthy';
        if (unknownServices.length > 0) return 'unknown';

        return 'healthy';
    }

    /**
     * Get system metrics
     */
    getSystemMetrics() {
        const memoryUsage = process.memoryUsage();

        return {
            memory: {
                rss: memoryUsage.rss,
                heapTotal: memoryUsage.heapTotal,
                heapUsed: memoryUsage.heapUsed,
                external: memoryUsage.external
            },
            cpu: process.cpuUsage(),
            uptime: process.uptime(),
            version: process.version,
            platform: process.platform,
            arch: process.arch
        };
    }

    /**
     * Track request metrics
     */
    trackRequest(responseTime, success = true) {
        this.metrics.requestCount++;
        if (!success) {
            this.metrics.errorCount++;
        }

        this.metrics.responseTime.push(responseTime);

        // Keep only last 1000 response times
        if (this.metrics.responseTime.length > 1000) {
            this.metrics.responseTime = this.metrics.responseTime.slice(-1000);
        }
    }

    /**
     * Get performance metrics
     */
    getMetrics() {
        const responseTimes = this.metrics.responseTime;
        const avgResponseTime = responseTimes.length > 0
            ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
            : 0;

        const errorRate = this.metrics.requestCount > 0
            ? (this.metrics.errorCount / this.metrics.requestCount) * 100
            : 0;

        return {
            requests: {
                total: this.metrics.requestCount,
                errors: this.metrics.errorCount,
                errorRate: errorRate.toFixed(2) + '%'
            },
            performance: {
                avgResponseTime: Math.round(avgResponseTime),
                recentResponseTimes: responseTimes.slice(-10)
            },
            uptime: {
                seconds: process.uptime(),
                since: new Date(this.startTime).toISOString()
            },
            system: this.getSystemMetrics()
        };
    }

    /**
     * Get readiness status (for load balancers)
     */
    getReadinessStatus() {
        const status = this.calculateOverallStatus();
        return {
            ready: status === 'healthy' || status === 'degraded',
            status,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Get liveness status (for container orchestration)
     */
    getLivenessStatus() {
        // Simple liveness check - process is running
        return {
            alive: true,
            uptime: process.uptime(),
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Express middleware to track request metrics
     */
    requestTrackingMiddleware() {
        return (req, res, next) => {
            const startTime = Date.now();

            // Track response
            const originalSend = res.send;
            res.send = function(data) {
                const responseTime = Date.now() - startTime;
                const success = res.statusCode < 400;

                // Access the health monitor instance through closure
                if (req.app.locals.healthMonitor) {
                    req.app.locals.healthMonitor.trackRequest(responseTime, success);
                }

                return originalSend.call(this, data);
            };

            next();
        };
    }
}

module.exports = HealthMonitor;
