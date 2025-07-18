/**
 * Performance Monitor - Advanced monitoring and resource optimization
 * Part of the n8n Claude Prompt System
 *
 * Features:
 * - Real-time performance monitoring
 * - Memory usage optimization
 * - Resource consumption tracking
 * - Performance alerts and thresholds
 * - Garbage collection optimization
 * - Request-level resource monitoring
 *
 * @author Bader Abdulrahim
 * @version 1.0.0
 */

const EventEmitter = require('events');
const v8 = require('v8');
const process = require('process');

class PerformanceMonitor extends EventEmitter {
    constructor(options = {}) {
        super();

        this.config = {
            monitoring: {
                interval: options.interval || 5000, // 5 seconds
                memoryThreshold: options.memoryThreshold || 0.8, // 80% of heap limit
                cpuThreshold: options.cpuThreshold || 0.9, // 90% CPU usage
                responseTimeThreshold: options.responseTimeThreshold || 5000, // 5 seconds
                errorRateThreshold: options.errorRateThreshold || 0.1 // 10% error rate
            },
            gc: {
                enabled: options.gc?.enabled ?? true,
                threshold: options.gc?.threshold || 0.7, // 70% heap usage
                interval: options.gc?.interval || 30000, // 30 seconds
                aggressive: options.gc?.aggressive ?? false
            },
            alerts: {
                enabled: options.alerts?.enabled ?? true,
                cooldown: options.alerts?.cooldown || 60000, // 1 minute between same alerts
                channels: options.alerts?.channels || ['console'] // console, webhook, email
            },
            metrics: {
                retention: options.metrics?.retention || 3600000, // 1 hour
                aggregation: options.metrics?.aggregation || 'average' // average, max, min
            }
        };

        this.metrics = {
            system: {
                memory: {
                    used: 0,
                    free: 0,
                    total: 0,
                    percentage: 0,
                    heap: {
                        used: 0,
                        total: 0,
                        limit: 0,
                        percentage: 0
                    }
                },
                cpu: {
                    usage: 0,
                    loadAverage: [0, 0, 0],
                    cores: require('os').cpus().length
                },
                uptime: 0,
                timestamp: Date.now()
            },
            requests: {
                total: 0,
                successful: 0,
                failed: 0,
                avgResponseTime: 0,
                maxResponseTime: 0,
                minResponseTime: Infinity,
                errorRate: 0,
                throughput: 0, // requests per second
                concurrent: 0
            },
            resources: {
                fileDescriptors: 0,
                eventLoopLag: 0,
                gcCount: 0,
                gcDuration: 0
            }
        };

        this.historicalMetrics = [];
        this.activeRequests = new Map();
        this.alertHistory = new Map();
        this.gcStats = {
            count: 0,
            totalDuration: 0,
            lastGC: null
        };

        this.monitoringInterval = null;
        this.gcInterval = null;
        this.startTime = Date.now();

        this.initializeMonitoring();
    }

    /**
     * Initialize performance monitoring
     */
    initializeMonitoring() {
        // Start system monitoring
        this.startSystemMonitoring();

        // Enable GC monitoring if supported
        if (this.config.gc.enabled && global.gc) {
            this.startGCMonitoring();
        }

        // Monitor event loop lag
        this.startEventLoopMonitoring();

        console.log('Performance Monitor initialized');
    }

    /**
     * Start system performance monitoring
     */
    startSystemMonitoring() {
        this.monitoringInterval = setInterval(() => {
            this.collectSystemMetrics();
            this.checkThresholds();
            this.cleanupHistoricalData();
        }, this.config.monitoring.interval);

        // Collect initial metrics
        this.collectSystemMetrics();
    }

    /**
     * Start garbage collection monitoring
     */
    startGCMonitoring() {
        if (this.config.gc.enabled) {
            this.gcInterval = setInterval(() => {
                this.optimizeGarbageCollection();
            }, this.config.gc.interval);
        }

        // Hook into GC events if available
        if (v8.getHeapStatistics) {
            setInterval(() => {
                this.collectGCMetrics();
            }, 10000); // Every 10 seconds
        }
    }

    /**
     * Start event loop lag monitoring
     */
    startEventLoopMonitoring() {
        setInterval(() => {
            const start = process.hrtime.bigint();
            setImmediate(() => {
                const lag = Number(process.hrtime.bigint() - start) / 1000000; // Convert to ms
                this.metrics.resources.eventLoopLag = lag;

                if (lag > 100) { // Alert if lag > 100ms
                    this.emit('alert', {
                        type: 'event_loop_lag',
                        value: lag,
                        threshold: 100,
                        severity: lag > 1000 ? 'critical' : 'warning'
                    });
                }
            });
        }, 5000);
    }

    /**
     * Collect system metrics
     */
    collectSystemMetrics() {
        const memUsage = process.memoryUsage();
        const heapStats = v8.getHeapStatistics();

        // Memory metrics
        this.metrics.system.memory = {
            used: memUsage.rss,
            free: heapStats.heap_size_limit - heapStats.used_heap_size,
            total: heapStats.heap_size_limit,
            percentage: (memUsage.rss / heapStats.heap_size_limit) * 100,
            heap: {
                used: heapStats.used_heap_size,
                total: heapStats.total_heap_size,
                limit: heapStats.heap_size_limit,
                percentage: (heapStats.used_heap_size / heapStats.heap_size_limit) * 100
            }
        };

        // CPU metrics (approximation)
        this.metrics.system.cpu = {
            usage: this.calculateCPUUsage(),
            loadAverage: require('os').loadavg(),
            cores: require('os').cpus().length
        };

        // System uptime
        this.metrics.system.uptime = Date.now() - this.startTime;
        this.metrics.system.timestamp = Date.now();

        // Resource metrics
        this.updateResourceMetrics();

        // Store historical data
        this.storeHistoricalMetrics();

        this.emit('metrics:collected', this.metrics);
    }

    /**
     * Calculate CPU usage (simple approximation)
     */
    calculateCPUUsage() {
        if (!this.lastCpuUsage) {
            this.lastCpuUsage = process.cpuUsage();
            this.lastCpuTime = Date.now();
            return 0;
        }

        const currentUsage = process.cpuUsage(this.lastCpuUsage);
        const currentTime = Date.now();
        const timeDiff = currentTime - this.lastCpuTime;

        const cpuPercent = ((currentUsage.user + currentUsage.system) / 1000) / timeDiff * 100;

        this.lastCpuUsage = process.cpuUsage();
        this.lastCpuTime = currentTime;

        return Math.min(cpuPercent, 100);
    }

    /**
     * Update resource metrics
     */
    updateResourceMetrics() {
        // File descriptors (Unix systems)
        try {
            const fs = require('fs');
            const fdCount = fs.readdirSync('/proc/self/fd').length;
            this.metrics.resources.fileDescriptors = fdCount;
        } catch (error) {
            // Windows or other systems
            this.metrics.resources.fileDescriptors = 0;
        }

        // GC metrics
        this.metrics.resources.gcCount = this.gcStats.count;
        this.metrics.resources.gcDuration = this.gcStats.totalDuration;
    }

    /**
     * Collect garbage collection metrics
     */
    collectGCMetrics() {
        const heapStats = v8.getHeapStatistics();

        // Emit GC metrics
        this.emit('gc:stats', {
            heapUsed: heapStats.used_heap_size,
            heapTotal: heapStats.total_heap_size,
            heapLimit: heapStats.heap_size_limit,
            mallocedMemory: heapStats.malloced_memory,
            peakMallocedMemory: heapStats.peak_malloced_memory
        });
    }

    /**
     * Optimize garbage collection
     */
    optimizeGarbageCollection() {
        const heapUsage = this.metrics.system.memory.heap.percentage / 100;

        if (heapUsage > this.config.gc.threshold) {
            console.log(`Triggering GC: heap usage at ${(heapUsage * 100).toFixed(1)}%`);

            const startTime = Date.now();

            if (global.gc) {
                if (this.config.gc.aggressive && heapUsage > 0.9) {
                    // Aggressive GC for high memory usage
                    global.gc(true); // Full GC
                } else {
                    global.gc(); // Incremental GC
                }

                const gcDuration = Date.now() - startTime;
                this.gcStats.count++;
                this.gcStats.totalDuration += gcDuration;
                this.gcStats.lastGC = Date.now();

                this.emit('gc:triggered', {
                    duration: gcDuration,
                    heapUsageBefore: heapUsage,
                    heapUsageAfter: this.metrics.system.memory.heap.percentage / 100,
                    aggressive: this.config.gc.aggressive && heapUsage > 0.9
                });
            }
        }
    }

    /**
     * Track request performance
     */
    startRequestTracking(requestId, metadata = {}) {
        const request = {
            id: requestId,
            startTime: Date.now(),
            startMemory: process.memoryUsage().rss,
            metadata
        };

        this.activeRequests.set(requestId, request);
        this.metrics.requests.concurrent = this.activeRequests.size;

        this.emit('request:start', request);

        return request;
    }

    /**
     * End request tracking
     */
    endRequestTracking(requestId, success = true, error = null) {
        const request = this.activeRequests.get(requestId);
        if (!request) return null;

        const endTime = Date.now();
        const endMemory = process.memoryUsage().rss;
        const responseTime = endTime - request.startTime;
        const memoryDelta = endMemory - request.startMemory;

        // Update request metrics
        this.metrics.requests.total++;
        if (success) {
            this.metrics.requests.successful++;
        } else {
            this.metrics.requests.failed++;
        }

        // Update response time metrics
        this.updateResponseTimeMetrics(responseTime);

        // Calculate error rate
        this.metrics.requests.errorRate = this.metrics.requests.failed / this.metrics.requests.total;

        // Calculate throughput (requests per second over last minute)
        this.calculateThroughput();

        this.activeRequests.delete(requestId);
        this.metrics.requests.concurrent = this.activeRequests.size;

        const completedRequest = {
            ...request,
            endTime,
            responseTime,
            memoryDelta,
            success,
            error: error?.message
        };

        this.emit('request:end', completedRequest);

        // Check for performance alerts
        this.checkRequestPerformance(completedRequest);

        return completedRequest;
    }

    /**
     * Update response time metrics
     */
    updateResponseTimeMetrics(responseTime) {
        const total = this.metrics.requests.total;
        this.metrics.requests.avgResponseTime =
            (this.metrics.requests.avgResponseTime * (total - 1) + responseTime) / total;

        this.metrics.requests.maxResponseTime = Math.max(
            this.metrics.requests.maxResponseTime,
            responseTime
        );

        this.metrics.requests.minResponseTime = Math.min(
            this.metrics.requests.minResponseTime === Infinity ? responseTime : this.metrics.requests.minResponseTime,
            responseTime
        );
    }

    /**
     * Calculate throughput
     */
    calculateThroughput() {
        const oneMinuteAgo = Date.now() - 60000;
        const recentRequests = this.historicalMetrics.filter(
            metric => metric.timestamp > oneMinuteAgo
        );

        if (recentRequests.length > 0) {
            const totalRequests = recentRequests[recentRequests.length - 1].requests.total -
                                 recentRequests[0].requests.total;
            this.metrics.requests.throughput = totalRequests / 60; // per second
        }
    }

    /**
     * Check performance thresholds and emit alerts
     */
    checkThresholds() {
        const { memory, cpu } = this.metrics.system;
        const { avgResponseTime, errorRate } = this.metrics.requests;

        // Memory threshold
        if (memory.percentage > this.config.monitoring.memoryThreshold * 100) {
            this.emitAlert('memory_threshold', memory.percentage, this.config.monitoring.memoryThreshold * 100);
        }

        // CPU threshold
        if (cpu.usage > this.config.monitoring.cpuThreshold * 100) {
            this.emitAlert('cpu_threshold', cpu.usage, this.config.monitoring.cpuThreshold * 100);
        }

        // Response time threshold
        if (avgResponseTime > this.config.monitoring.responseTimeThreshold) {
            this.emitAlert('response_time_threshold', avgResponseTime, this.config.monitoring.responseTimeThreshold);
        }

        // Error rate threshold
        if (errorRate > this.config.monitoring.errorRateThreshold) {
            this.emitAlert('error_rate_threshold', errorRate * 100, this.config.monitoring.errorRateThreshold * 100);
        }
    }

    /**
     * Check individual request performance
     */
    checkRequestPerformance(request) {
        // Long response time
        if (request.responseTime > this.config.monitoring.responseTimeThreshold) {
            this.emit('alert', {
                type: 'slow_request',
                requestId: request.id,
                responseTime: request.responseTime,
                threshold: this.config.monitoring.responseTimeThreshold,
                severity: 'warning'
            });
        }

        // High memory usage
        if (request.memoryDelta > 50 * 1024 * 1024) { // 50MB
            this.emit('alert', {
                type: 'high_memory_request',
                requestId: request.id,
                memoryDelta: request.memoryDelta,
                severity: 'warning'
            });
        }
    }

    /**
     * Emit alert with cooldown
     */
    emitAlert(type, value, threshold) {
        const now = Date.now();
        const lastAlert = this.alertHistory.get(type);

        if (!lastAlert || now - lastAlert > this.config.alerts.cooldown) {
            const severity = this.calculateSeverity(type, value, threshold);

            this.emit('alert', {
                type,
                value,
                threshold,
                severity,
                timestamp: now
            });

            this.alertHistory.set(type, now);
        }
    }

    /**
     * Calculate alert severity
     */
    calculateSeverity(type, value, threshold) {
        const ratio = value / threshold;

        if (ratio > 1.5) return 'critical';
        if (ratio > 1.2) return 'high';
        if (ratio > 1.0) return 'medium';
        return 'low';
    }

    /**
     * Store historical metrics
     */
    storeHistoricalMetrics() {
        const snapshot = JSON.parse(JSON.stringify(this.metrics));
        snapshot.timestamp = Date.now();

        this.historicalMetrics.push(snapshot);

        // Keep only recent data based on retention period
        const cutoff = Date.now() - this.config.metrics.retention;
        this.historicalMetrics = this.historicalMetrics.filter(
            metric => metric.timestamp > cutoff
        );
    }

    /**
     * Cleanup old historical data
     */
    cleanupHistoricalData() {
        const cutoff = Date.now() - this.config.metrics.retention;
        this.historicalMetrics = this.historicalMetrics.filter(
            metric => metric.timestamp > cutoff
        );
    }

    /**
     * Get performance metrics
     */
    getMetrics() {
        return {
            current: this.metrics,
            historical: this.historicalMetrics,
            alerts: Array.from(this.alertHistory.entries()).map(([type, timestamp]) => ({
                type,
                timestamp,
                age: Date.now() - timestamp
            })),
            gcStats: this.gcStats,
            config: this.config
        };
    }

    /**
     * Get performance recommendations
     */
    getRecommendations() {
        const recommendations = [];
        const { memory, cpu } = this.metrics.system;
        const { avgResponseTime, errorRate } = this.metrics.requests;

        // Memory recommendations
        if (memory.percentage > 70) {
            recommendations.push({
                type: 'memory',
                severity: memory.percentage > 85 ? 'high' : 'medium',
                message: 'High memory usage detected',
                suggestions: [
                    'Enable more aggressive garbage collection',
                    'Reduce cache sizes',
                    'Implement memory pooling',
                    'Review memory leaks'
                ]
            });
        }

        // CPU recommendations
        if (cpu.usage > 80) {
            recommendations.push({
                type: 'cpu',
                severity: cpu.usage > 95 ? 'high' : 'medium',
                message: 'High CPU usage detected',
                suggestions: [
                    'Implement request queuing',
                    'Optimize algorithms',
                    'Scale horizontally',
                    'Use clustering'
                ]
            });
        }

        // Response time recommendations
        if (avgResponseTime > 2000) {
            recommendations.push({
                type: 'response_time',
                severity: avgResponseTime > 5000 ? 'high' : 'medium',
                message: 'Slow response times detected',
                suggestions: [
                    'Implement caching',
                    'Optimize database queries',
                    'Use connection pooling',
                    'Implement request batching'
                ]
            });
        }

        // Error rate recommendations
        if (errorRate > 0.05) {
            recommendations.push({
                type: 'error_rate',
                severity: errorRate > 0.1 ? 'high' : 'medium',
                message: 'High error rate detected',
                suggestions: [
                    'Implement circuit breakers',
                    'Add retry logic',
                    'Improve error handling',
                    'Monitor third-party services'
                ]
            });
        }

        return recommendations;
    }

    /**
     * Middleware for Express.js to track request performance
     */
    expressMiddleware() {
        return (req, res, next) => {
            const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const startTracking = this.startRequestTracking(requestId, {
                method: req.method,
                url: req.url,
                userAgent: req.get('User-Agent'),
                ip: req.ip
            });

            req.performanceTracking = { requestId, startTracking };

            // Override res.end to capture response
            const originalEnd = res.end;
            res.end = function(...args) {
                const success = res.statusCode < 400;
                this.endRequestTracking(requestId, success);
                originalEnd.apply(res, args);
            }.bind(this);

            next();
        };
    }

    /**
     * Health check
     */
    async healthCheck() {
        const metrics = this.getMetrics();
        const recommendations = this.getRecommendations();

        let status = 'healthy';
        if (recommendations.some(r => r.severity === 'high')) {
            status = 'unhealthy';
        } else if (recommendations.some(r => r.severity === 'medium')) {
            status = 'degraded';
        }

        return {
            status,
            metrics: metrics.current,
            recommendations,
            activeRequests: this.metrics.requests.concurrent,
            uptime: this.metrics.system.uptime
        };
    }

    /**
     * Stop monitoring
     */
    stop() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
        }
        if (this.gcInterval) {
            clearInterval(this.gcInterval);
        }

        this.removeAllListeners();
        console.log('Performance Monitor stopped');
    }
}

module.exports = PerformanceMonitor;
