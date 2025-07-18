/**
 * Connection Pool Manager - HTTP connection pooling and request optimization
 * Part of the n8n Claude Prompt System
 *
 * Features:
 * - HTTP/HTTPS connection pooling
 * - Request batching and queuing
 * - Smart retry logic with exponential backoff
 * - Request deduplication
 * - Circuit breaker pattern
 * - Performance monitoring
 *
 * @author Bader Abdulrahim
 * @version 1.0.0
 */

const axios = require('axios');
const https = require('https');
const http = require('http');
const EventEmitter = require('events');

class ConnectionPoolManager extends EventEmitter {
    constructor(options = {}) {
        super();

        this.config = {
            pool: {
                maxSockets: options.maxSockets || 50,
                maxFreeSockets: options.maxFreeSockets || 10,
                timeout: options.timeout || 30000,
                freeSocketTimeout: options.freeSocketTimeout || 4000,
                keepAlive: options.keepAlive ?? true,
                keepAliveMsecs: options.keepAliveMsecs || 1000
            },
            retry: {
                maxRetries: options.maxRetries || 3,
                baseDelay: options.baseDelay || 1000,
                maxDelay: options.maxDelay || 10000,
                factor: options.factor || 2,
                jitter: options.jitter ?? true
            },
            circuitBreaker: {
                failureThreshold: options.failureThreshold || 5,
                resetTimeout: options.resetTimeout || 60000,
                monitoringWindow: options.monitoringWindow || 300000 // 5 minutes
            },
            batching: {
                enabled: options.batching?.enabled ?? true,
                maxBatchSize: options.batching?.maxBatchSize || 10,
                batchTimeout: options.batching?.batchTimeout || 100,
                maxConcurrent: options.batching?.maxConcurrent || 5
            },
            compression: options.compression ?? true,
            deduplication: options.deduplication ?? true
        };

        this.httpAgent = null;
        this.httpsAgent = null;
        this.axiosInstance = null;
        this.circuitBreakers = new Map();
        this.requestQueue = [];
        this.activeRequests = new Map();
        this.batchQueue = [];
        this.batchTimer = null;
        this.metrics = {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            retriedRequests: 0,
            circuitBreakerTrips: 0,
            batchedRequests: 0,
            deduplicatedRequests: 0,
            averageResponseTime: 0,
            connectionPoolStats: {
                activeConnections: 0,
                idleConnections: 0,
                pendingRequests: 0
            }
        };

        this.initializeConnectionPool();
    }

    /**
     * Initialize HTTP/HTTPS connection pools and axios instance
     */
    initializeConnectionPool() {
        // Create HTTP agent with connection pooling
        this.httpAgent = new http.Agent({
            keepAlive: this.config.pool.keepAlive,
            keepAliveMsecs: this.config.pool.keepAliveMsecs,
            maxSockets: this.config.pool.maxSockets,
            maxFreeSockets: this.config.pool.maxFreeSockets,
            timeout: this.config.pool.timeout,
            freeSocketTimeout: this.config.pool.freeSocketTimeout
        });

        // Create HTTPS agent with connection pooling
        this.httpsAgent = new https.Agent({
            keepAlive: this.config.pool.keepAlive,
            keepAliveMsecs: this.config.pool.keepAliveMsecs,
            maxSockets: this.config.pool.maxSockets,
            maxFreeSockets: this.config.pool.maxFreeSockets,
            timeout: this.config.pool.timeout,
            freeSocketTimeout: this.config.pool.freeSocketTimeout
        });

        // Create configured axios instance
        this.axiosInstance = axios.create({
            httpAgent: this.httpAgent,
            httpsAgent: this.httpsAgent,
            timeout: this.config.pool.timeout,
            headers: {
                'Connection': 'keep-alive',
                'Accept-Encoding': this.config.compression ? 'gzip, deflate, br' : 'identity'
            },
            maxRedirects: 3,
            validateStatus: (status) => status < 500 // Don't throw on 4xx errors
        });

        // Add request interceptor for metrics and deduplication
        this.axiosInstance.interceptors.request.use(
            this.requestInterceptor.bind(this),
            this.requestErrorInterceptor.bind(this)
        );

        // Add response interceptor for metrics and retry logic
        this.axiosInstance.interceptors.response.use(
            this.responseInterceptor.bind(this),
            this.responseErrorInterceptor.bind(this)
        );

        console.log('Connection Pool Manager initialized with', this.config.pool.maxSockets, 'max sockets');
    }

    /**
     * Request interceptor for deduplication and metrics
     */
    requestInterceptor(config) {
        const startTime = Date.now();
        config.metadata = { startTime, requestId: this.generateRequestId() };

        // Handle request deduplication
        if (this.config.deduplication) {
            const requestKey = this.generateRequestKey(config);
            const activeRequest = this.activeRequests.get(requestKey);

            if (activeRequest) {
                this.metrics.deduplicatedRequests++;
                this.emit('request:deduplicated', { requestKey, config });
                return Promise.reject(new Error('DEDUPLICATED_REQUEST'));
            }

            this.activeRequests.set(requestKey, config);
        }

        this.metrics.totalRequests++;
        this.emit('request:start', { requestId: config.metadata.requestId, config });

        return config;
    }

    /**
     * Request error interceptor
     */
    requestErrorInterceptor(error) {
        this.metrics.failedRequests++;
        this.emit('request:error', { error });
        return Promise.reject(error);
    }

    /**
     * Response interceptor for metrics
     */
    responseInterceptor(response) {
        const { startTime, requestId } = response.config.metadata;
        const responseTime = Date.now() - startTime;

        this.updateAverageResponseTime(responseTime);
        this.metrics.successfulRequests++;

        // Remove from active requests if deduplication is enabled
        if (this.config.deduplication) {
            const requestKey = this.generateRequestKey(response.config);
            this.activeRequests.delete(requestKey);
        }

        this.emit('request:success', { requestId, responseTime, status: response.status });

        return response;
    }

    /**
     * Response error interceptor with retry logic
     */
    async responseErrorInterceptor(error) {
        const config = error.config;

        // Skip retry for deduplicated requests
        if (error.message === 'DEDUPLICATED_REQUEST') {
            return Promise.reject(error);
        }

        if (!config || !config.metadata) {
            return Promise.reject(error);
        }

        const { startTime, requestId } = config.metadata;
        const responseTime = Date.now() - startTime;

        // Remove from active requests
        if (this.config.deduplication) {
            const requestKey = this.generateRequestKey(config);
            this.activeRequests.delete(requestKey);
        }

        // Check circuit breaker
        const hostKey = this.getHostKey(config.url);
        if (this.isCircuitBreakerOpen(hostKey)) {
            this.emit('request:circuit_breaker', { requestId, hostKey });
            return Promise.reject(new Error('CIRCUIT_BREAKER_OPEN'));
        }

        // Increment failure count for circuit breaker
        this.recordFailure(hostKey);

        // Determine if request should be retried
        const shouldRetry = this.shouldRetry(error, config);

        if (shouldRetry) {
            const retryCount = (config.__retryCount || 0) + 1;
            const delay = this.calculateRetryDelay(retryCount);

            config.__retryCount = retryCount;
            this.metrics.retriedRequests++;

            this.emit('request:retry', { requestId, retryCount, delay, error: error.message });

            // Wait for the calculated delay
            await new Promise(resolve => setTimeout(resolve, delay));

            // Retry the request
            return this.axiosInstance(config);
        }

        this.metrics.failedRequests++;
        this.emit('request:failed', { requestId, responseTime, error: error.message });

        return Promise.reject(error);
    }

    /**
     * Make HTTP request with connection pooling and retry logic
     */
    async request(config) {
        // Check if batching is enabled and request can be batched
        if (this.config.batching.enabled && this.canBatch(config)) {
            return await this.addToBatch(config);
        }

        return await this.axiosInstance(config);
    }

    /**
     * Batch multiple requests together
     */
    async addToBatch(config) {
        return new Promise((resolve, reject) => {
            this.batchQueue.push({ config, resolve, reject });

            // Start batch timer if not already running
            if (!this.batchTimer) {
                this.batchTimer = setTimeout(() => {
                    this.processBatch();
                }, this.config.batching.batchTimeout);
            }

            // Process batch immediately if it reaches max size
            if (this.batchQueue.length >= this.config.batching.maxBatchSize) {
                this.processBatch();
            }
        });
    }

    /**
     * Process batched requests
     */
    async processBatch() {
        if (this.batchTimer) {
            clearTimeout(this.batchTimer);
            this.batchTimer = null;
        }

        if (this.batchQueue.length === 0) {
            return;
        }

        const batch = this.batchQueue.splice(0, this.config.batching.maxBatchSize);
        this.metrics.batchedRequests += batch.length;

        this.emit('batch:start', { size: batch.length });

        // Execute requests with limited concurrency
        const chunks = this.chunkArray(batch, this.config.batching.maxConcurrent);

        for (const chunk of chunks) {
            const promises = chunk.map(async ({ config, resolve, reject }) => {
                try {
                    const response = await this.axiosInstance(config);
                    resolve(response);
                } catch (error) {
                    reject(error);
                }
            });

            await Promise.allSettled(promises);
        }

        this.emit('batch:complete', { size: batch.length });

        // Process remaining batches if any
        if (this.batchQueue.length > 0) {
            setTimeout(() => this.processBatch(), 0);
        }
    }

    /**
     * Check if request can be batched
     */
    canBatch(config) {
        // Only batch GET requests to the same host
        return config.method?.toLowerCase() === 'get' || !config.method;
    }

    /**
     * Determine if request should be retried
     */
    shouldRetry(error, config) {
        const retryCount = config.__retryCount || 0;

        if (retryCount >= this.config.retry.maxRetries) {
            return false;
        }

        // Don't retry 4xx errors (client errors)
        if (error.response && error.response.status >= 400 && error.response.status < 500) {
            return false;
        }

        // Retry on network errors, timeouts, and 5xx errors
        return !error.response ||
               error.code === 'ECONNRESET' ||
               error.code === 'ETIMEDOUT' ||
               error.code === 'ENOTFOUND' ||
               (error.response.status >= 500);
    }

    /**
     * Calculate retry delay with exponential backoff and jitter
     */
    calculateRetryDelay(retryCount) {
        let delay = this.config.retry.baseDelay * Math.pow(this.config.retry.factor, retryCount - 1);
        delay = Math.min(delay, this.config.retry.maxDelay);

        if (this.config.retry.jitter) {
            delay += Math.random() * 1000; // Add up to 1 second jitter
        }

        return delay;
    }

    /**
     * Circuit breaker implementation
     */
    isCircuitBreakerOpen(hostKey) {
        const breaker = this.circuitBreakers.get(hostKey);
        if (!breaker) return false;

        const now = Date.now();

        // Reset circuit breaker if timeout has passed
        if (breaker.state === 'open' && now - breaker.lastFailureTime > this.config.circuitBreaker.resetTimeout) {
            breaker.state = 'half-open';
            breaker.failureCount = 0;
            this.emit('circuit_breaker:half_open', { hostKey });
        }

        return breaker.state === 'open';
    }

    /**
     * Record failure for circuit breaker
     */
    recordFailure(hostKey) {
        const now = Date.now();
        let breaker = this.circuitBreakers.get(hostKey);

        if (!breaker) {
            breaker = {
                failureCount: 0,
                lastFailureTime: now,
                state: 'closed'
            };
            this.circuitBreakers.set(hostKey, breaker);
        }

        breaker.failureCount++;
        breaker.lastFailureTime = now;

        // Open circuit breaker if failure threshold is reached
        if (breaker.failureCount >= this.config.circuitBreaker.failureThreshold) {
            breaker.state = 'open';
            this.metrics.circuitBreakerTrips++;
            this.emit('circuit_breaker:open', { hostKey, failureCount: breaker.failureCount });
        }
    }

    /**
     * Record success for circuit breaker
     */
    recordSuccess(hostKey) {
        const breaker = this.circuitBreakers.get(hostKey);
        if (breaker && breaker.state === 'half-open') {
            breaker.state = 'closed';
            breaker.failureCount = 0;
            this.emit('circuit_breaker:closed', { hostKey });
        }
    }

    /**
     * Generate unique request ID
     */
    generateRequestId() {
        return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Generate request key for deduplication
     */
    generateRequestKey(config) {
        const key = `${config.method || 'GET'}:${config.url}:${JSON.stringify(config.params || {})}`;
        return Buffer.from(key).toString('base64');
    }

    /**
     * Extract host key from URL
     */
    getHostKey(url) {
        try {
            return new URL(url).host;
        } catch {
            return 'unknown';
        }
    }

    /**
     * Update average response time
     */
    updateAverageResponseTime(responseTime) {
        const totalRequests = this.metrics.successfulRequests;
        this.metrics.averageResponseTime =
            (this.metrics.averageResponseTime * (totalRequests - 1) + responseTime) / totalRequests;
    }

    /**
     * Chunk array into smaller arrays
     */
    chunkArray(array, chunkSize) {
        const chunks = [];
        for (let i = 0; i < array.length; i += chunkSize) {
            chunks.push(array.slice(i, i + chunkSize));
        }
        return chunks;
    }

    /**
     * Get connection pool metrics
     */
    getMetrics() {
        const connectionStats = {
            http: {
                totalSocketCount: this.httpAgent.totalSocketCount || 0,
                sockets: Object.keys(this.httpAgent.sockets || {}).length,
                freeSockets: Object.keys(this.httpAgent.freeSockets || {}).length,
                requests: Object.keys(this.httpAgent.requests || {}).length
            },
            https: {
                totalSocketCount: this.httpsAgent.totalSocketCount || 0,
                sockets: Object.keys(this.httpsAgent.sockets || {}).length,
                freeSockets: Object.keys(this.httpsAgent.freeSockets || {}).length,
                requests: Object.keys(this.httpsAgent.requests || {}).length
            }
        };

        return {
            ...this.metrics,
            connectionStats,
            circuitBreakers: Array.from(this.circuitBreakers.entries()).map(([host, breaker]) => ({
                host,
                state: breaker.state,
                failureCount: breaker.failureCount,
                lastFailureTime: breaker.lastFailureTime
            })),
            batchQueue: {
                size: this.batchQueue.length,
                pending: this.batchTimer !== null
            },
            activeRequests: this.activeRequests.size,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Health check for connection pool
     */
    async healthCheck() {
        const metrics = this.getMetrics();
        const totalConnections = metrics.connectionStats.http.sockets + metrics.connectionStats.https.sockets;
        const freeConnections = metrics.connectionStats.http.freeSockets + metrics.connectionStats.https.freeSockets;

        return {
            status: totalConnections < this.config.pool.maxSockets ? 'healthy' : 'warning',
            totalConnections,
            freeConnections,
            maxConnections: this.config.pool.maxSockets,
            utilization: (totalConnections / this.config.pool.maxSockets * 100).toFixed(2),
            circuitBreakers: metrics.circuitBreakers.filter(cb => cb.state === 'open').length,
            metrics
        };
    }

    /**
     * Close connection pool
     */
    async close() {
        // Clear batch timer
        if (this.batchTimer) {
            clearTimeout(this.batchTimer);
        }

        // Reject pending batch requests
        this.batchQueue.forEach(({ reject }) => {
            reject(new Error('Connection pool closing'));
        });

        // Destroy agents
        if (this.httpAgent) {
            this.httpAgent.destroy();
        }
        if (this.httpsAgent) {
            this.httpsAgent.destroy();
        }

        this.removeAllListeners();
        console.log('Connection Pool Manager closed');
    }
}

module.exports = ConnectionPoolManager;
