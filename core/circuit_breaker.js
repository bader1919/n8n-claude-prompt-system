/**
 * Circuit Breaker Pattern Implementation
 * Part of the n8n Claude Prompt System
 *
 * Features:
 * - Automatic failure detection and service protection
 * - Configurable failure thresholds and timeouts
 * - Exponential backoff for recovery attempts
 * - Health monitoring and metrics
 *
 * @author Bader Abdulrahim
 * @version 1.0.0
 */

const { CircuitBreakerError, ExternalServiceError } = require('./error_types');

class CircuitBreaker {
    constructor(options = {}) {
        this.name = options.name || 'default';
        this.failureThreshold = options.failureThreshold || 5;
        this.successThreshold = options.successThreshold || 2;
        this.timeout = options.timeout || 60000; // 1 minute
        this.resetTimeoutMultiplier = options.resetTimeoutMultiplier || 1.5;
        this.maxResetTimeout = options.maxResetTimeout || 300000; // 5 minutes
        
        // Circuit states
        this.state = 'closed'; // closed, open, half-open
        this.failureCount = 0;
        this.successCount = 0;
        this.nextAttempt = 0;
        this.currentTimeout = this.timeout;
        
        // Metrics
        this.metrics = {
            totalRequests: 0,
            totalFailures: 0,
            totalSuccesses: 0,
            circuitOpenedAt: null,
            lastFailureAt: null,
            lastSuccessAt: null,
            averageResponseTime: 0,
            responseTimeHistory: []
        };
    }

    /**
     * Execute a function with circuit breaker protection
     */
    async execute(fn, ...args) {
        this.metrics.totalRequests++;

        if (this.state === 'open') {
            if (Date.now() < this.nextAttempt) {
                throw new CircuitBreakerError(
                    `Circuit breaker '${this.name}' is open`,
                    { 
                        circuitState: this.state,
                        nextAttempt: this.nextAttempt,
                        service: this.name
                    }
                );
            }
            // Transition to half-open
            this.state = 'half-open';
            this.successCount = 0;
        }

        try {
            const startTime = Date.now();
            const result = await fn(...args);
            const responseTime = Date.now() - startTime;
            
            this.onSuccess(responseTime);
            return result;
        } catch (error) {
            this.onFailure(error);
            throw error;
        }
    }

    /**
     * Handle successful execution
     */
    onSuccess(responseTime) {
        this.metrics.totalSuccesses++;
        this.metrics.lastSuccessAt = Date.now();
        this.updateResponseTime(responseTime);
        
        this.failureCount = 0;
        
        if (this.state === 'half-open') {
            this.successCount++;
            if (this.successCount >= this.successThreshold) {
                this.close();
            }
        } else if (this.state === 'open') {
            // If we're in open state and had a success, transition to half-open first
            this.state = 'half-open';
            this.successCount = 1;
        }
    }

    /**
     * Handle failed execution
     */
    onFailure(error) {
        this.metrics.totalFailures++;
        this.metrics.lastFailureAt = Date.now();
        
        this.failureCount++;
        this.successCount = 0;
        
        if (this.state === 'half-open' || this.failureCount >= this.failureThreshold) {
            this.open();
        }
    }

    /**
     * Open the circuit breaker
     */
    open() {
        this.state = 'open';
        this.metrics.circuitOpenedAt = Date.now();
        this.nextAttempt = Date.now() + this.currentTimeout;
        
        // Exponential backoff for next attempt
        this.currentTimeout = Math.min(
            this.currentTimeout * this.resetTimeoutMultiplier,
            this.maxResetTimeout
        );
        
        console.warn(`Circuit breaker '${this.name}' opened. Next attempt at ${new Date(this.nextAttempt).toISOString()}`);
    }

    /**
     * Close the circuit breaker
     */
    close() {
        this.state = 'closed';
        this.failureCount = 0;
        this.successCount = 0;
        this.currentTimeout = this.timeout; // Reset timeout
        
        console.info(`Circuit breaker '${this.name}' closed. Service is healthy.`);
    }

    /**
     * Update response time metrics
     */
    updateResponseTime(responseTime) {
        this.metrics.responseTimeHistory.push(responseTime);
        
        // Keep only last 100 response times
        if (this.metrics.responseTimeHistory.length > 100) {
            this.metrics.responseTimeHistory.shift();
        }
        
        // Calculate average
        this.metrics.averageResponseTime = this.metrics.responseTimeHistory.reduce((a, b) => a + b, 0) / this.metrics.responseTimeHistory.length;
    }

    /**
     * Get circuit breaker status
     */
    getStatus() {
        return {
            name: this.name,
            state: this.state,
            failureCount: this.failureCount,
            successCount: this.successCount,
            nextAttempt: this.nextAttempt,
            currentTimeout: this.currentTimeout,
            healthy: this.state === 'closed',
            metrics: {
                ...this.metrics,
                failureRate: this.metrics.totalRequests > 0 ? (this.metrics.totalFailures / this.metrics.totalRequests) : 0,
                successRate: this.metrics.totalRequests > 0 ? (this.metrics.totalSuccesses / this.metrics.totalRequests) : 0
            }
        };
    }

    /**
     * Reset circuit breaker to initial state
     */
    reset() {
        this.state = 'closed';
        this.failureCount = 0;
        this.successCount = 0;
        this.nextAttempt = 0;
        this.currentTimeout = this.timeout;
        
        console.info(`Circuit breaker '${this.name}' has been reset.`);
    }

    /**
     * Check if circuit breaker is healthy
     */
    isHealthy() {
        return this.state === 'closed';
    }

    /**
     * Get health check result
     */
    healthCheck() {
        const status = this.getStatus();
        return {
            healthy: status.healthy,
            state: status.state,
            failureRate: status.metrics.failureRate,
            averageResponseTime: status.metrics.averageResponseTime,
            lastFailure: status.metrics.lastFailureAt,
            lastSuccess: status.metrics.lastSuccessAt
        };
    }
}

/**
 * Circuit Breaker Manager - Manages multiple circuit breakers
 */
class CircuitBreakerManager {
    constructor() {
        this.circuitBreakers = new Map();
        this.defaultConfig = {
            failureThreshold: 5,
            successThreshold: 2,
            timeout: 60000,
            resetTimeoutMultiplier: 1.5,
            maxResetTimeout: 300000
        };
    }

    /**
     * Get or create a circuit breaker
     */
    getCircuitBreaker(name, config = {}) {
        if (!this.circuitBreakers.has(name)) {
            const circuitConfig = { ...this.defaultConfig, ...config, name };
            this.circuitBreakers.set(name, new CircuitBreaker(circuitConfig));
        }
        return this.circuitBreakers.get(name);
    }

    /**
     * Execute function with circuit breaker protection
     */
    async execute(name, fn, config = {}, ...args) {
        const circuitBreaker = this.getCircuitBreaker(name, config);
        return circuitBreaker.execute(fn, ...args);
    }

    /**
     * Get status of all circuit breakers
     */
    getAllStatus() {
        const status = {};
        for (const [name, circuitBreaker] of this.circuitBreakers) {
            status[name] = circuitBreaker.getStatus();
        }
        return status;
    }

    /**
     * Get health status of all circuit breakers
     */
    getHealthStatus() {
        const healthStatus = {
            healthy: true,
            circuitBreakers: {}
        };

        for (const [name, circuitBreaker] of this.circuitBreakers) {
            const health = circuitBreaker.healthCheck();
            healthStatus.circuitBreakers[name] = health;
            
            if (!health.healthy) {
                healthStatus.healthy = false;
            }
        }

        return healthStatus;
    }

    /**
     * Reset all circuit breakers
     */
    resetAll() {
        for (const circuitBreaker of this.circuitBreakers.values()) {
            circuitBreaker.reset();
        }
    }

    /**
     * Reset specific circuit breaker
     */
    reset(name) {
        const circuitBreaker = this.circuitBreakers.get(name);
        if (circuitBreaker) {
            circuitBreaker.reset();
            return true;
        }
        return false;
    }

    /**
     * Remove circuit breaker
     */
    remove(name) {
        return this.circuitBreakers.delete(name);
    }
}

// Global circuit breaker manager instance
const globalCircuitBreakerManager = new CircuitBreakerManager();

module.exports = {
    CircuitBreaker,
    CircuitBreakerManager,
    circuitBreakerManager: globalCircuitBreakerManager
};