/**
 * Monitoring and Alerting Integration
 * Part of the n8n Claude Prompt System
 *
 * Features:
 * - Error tracking and alerting
 * - Performance monitoring
 * - Circuit breaker monitoring
 * - Security event tracking
 * - Integration with external monitoring services
 *
 * @author Bader Abdulrahim
 * @version 1.0.0
 */

const EventEmitter = require('events');

class MonitoringManager extends EventEmitter {
    constructor(options = {}) {
        super();
        this.config = options.config || {};
        this.integrations = new Map();
        this.alerts = [];
        this.maxAlerts = 1000;
        this.alertThresholds = {
            errorRate: 0.05, // 5% error rate
            responseTime: 5000, // 5 seconds
            circuitBreakerOpenings: 3, // Circuit breaker openings per hour
            securityViolations: 10 // Security violations per hour
        };
        
        this.metrics = {
            requests: 0,
            errors: 0,
            totalResponseTime: 0,
            circuitBreakerEvents: [],
            securityEvents: [],
            lastReset: Date.now()
        };

        this.setupEventListeners();
    }

    /**
     * Setup event listeners for monitoring
     */
    setupEventListeners() {
        // Listen for error events
        this.on('error', (error, context) => {
            this.handleError(error, context);
        });

        // Listen for performance events
        this.on('request', (data) => {
            this.trackRequest(data);
        });

        // Listen for circuit breaker events
        this.on('circuitBreakerChange', (data) => {
            this.trackCircuitBreakerEvent(data);
        });

        // Listen for security events
        this.on('securityViolation', (data) => {
            this.trackSecurityEvent(data);
        });
    }

    /**
     * Register monitoring integration
     */
    registerIntegration(name, integration) {
        this.integrations.set(name, integration);
        console.log(`Monitoring integration '${name}' registered`);
    }

    /**
     * Handle error events
     */
    handleError(error, context = {}) {
        this.metrics.errors++;

        const errorData = {
            message: error.message,
            name: error.name,
            stack: error.stack,
            context,
            timestamp: new Date().toISOString(),
            severity: this.getErrorSeverity(error)
        };

        // Send to integrations
        this.sendToIntegrations('error', errorData);

        // Check if alert should be triggered
        this.checkErrorRateAlert();

        // Log error
        console.error('[MONITORING] Error tracked:', errorData);
    }

    /**
     * Track request metrics
     */
    trackRequest(data) {
        this.metrics.requests++;
        this.metrics.totalResponseTime += data.responseTime || 0;

        const requestData = {
            url: data.url,
            method: data.method,
            statusCode: data.statusCode,
            responseTime: data.responseTime,
            userAgent: data.userAgent,
            ip: data.ip,
            timestamp: new Date().toISOString()
        };

        // Send to integrations
        this.sendToIntegrations('request', requestData);

        // Check response time alert
        if (data.responseTime > this.alertThresholds.responseTime) {
            this.createAlert('slow_response', {
                responseTime: data.responseTime,
                threshold: this.alertThresholds.responseTime,
                url: data.url
            });
        }
    }

    /**
     * Track circuit breaker events
     */
    trackCircuitBreakerEvent(data) {
        const event = {
            ...data,
            timestamp: new Date().toISOString()
        };

        this.metrics.circuitBreakerEvents.push(event);

        // Keep only last 100 events
        if (this.metrics.circuitBreakerEvents.length > 100) {
            this.metrics.circuitBreakerEvents.shift();
        }

        // Send to integrations
        this.sendToIntegrations('circuitBreaker', event);

        // Check for too many circuit breaker openings
        if (data.state === 'open') {
            this.checkCircuitBreakerAlert();
        }
    }

    /**
     * Track security events
     */
    trackSecurityEvent(data) {
        const event = {
            ...data,
            timestamp: new Date().toISOString()
        };

        this.metrics.securityEvents.push(event);

        // Keep only last 100 events
        if (this.metrics.securityEvents.length > 100) {
            this.metrics.securityEvents.shift();
        }

        // Send to integrations
        this.sendToIntegrations('security', event);

        // Check security violation rate
        this.checkSecurityAlert();
    }

    /**
     * Get error severity level
     */
    getErrorSeverity(error) {
        if (error.name === 'ValidationError') return 'low';
        if (error.name === 'AuthenticationError') return 'medium';
        if (error.name === 'ExternalServiceError') return 'medium';
        if (error.name === 'CircuitBreakerError') return 'high';
        if (error.name === 'TimeoutError') return 'medium';
        return 'medium';
    }

    /**
     * Check error rate alert
     */
    checkErrorRateAlert() {
        if (this.metrics.requests < 10) return; // Need minimum requests

        const errorRate = this.metrics.errors / this.metrics.requests;
        
        if (errorRate > this.alertThresholds.errorRate) {
            this.createAlert('high_error_rate', {
                errorRate: errorRate.toFixed(4),
                threshold: this.alertThresholds.errorRate,
                requests: this.metrics.requests,
                errors: this.metrics.errors
            });
        }
    }

    /**
     * Check circuit breaker alert
     */
    checkCircuitBreakerAlert() {
        const oneHourAgo = Date.now() - (60 * 60 * 1000);
        const recentOpenings = this.metrics.circuitBreakerEvents.filter(
            event => event.state === 'open' && 
                    new Date(event.timestamp).getTime() > oneHourAgo
        );

        if (recentOpenings.length >= this.alertThresholds.circuitBreakerOpenings) {
            this.createAlert('circuit_breaker_instability', {
                openings: recentOpenings.length,
                threshold: this.alertThresholds.circuitBreakerOpenings,
                timeWindow: '1 hour'
            });
        }
    }

    /**
     * Check security alert
     */
    checkSecurityAlert() {
        const oneHourAgo = Date.now() - (60 * 60 * 1000);
        const recentViolations = this.metrics.securityEvents.filter(
            event => new Date(event.timestamp).getTime() > oneHourAgo
        );

        if (recentViolations.length >= this.alertThresholds.securityViolations) {
            this.createAlert('security_violations', {
                violations: recentViolations.length,
                threshold: this.alertThresholds.securityViolations,
                timeWindow: '1 hour',
                violationTypes: [...new Set(recentViolations.map(v => v.type))]
            });
        }
    }

    /**
     * Create alert
     */
    createAlert(type, data) {
        const alert = {
            id: this.generateAlertId(),
            type,
            data,
            timestamp: new Date().toISOString(),
            acknowledged: false,
            severity: this.getAlertSeverity(type)
        };

        this.alerts.push(alert);

        // Keep only last maxAlerts
        if (this.alerts.length > this.maxAlerts) {
            this.alerts.shift();
        }

        // Send to integrations
        this.sendToIntegrations('alert', alert);

        // Emit alert event
        this.emit('alert', alert);

        console.warn(`[MONITORING] Alert created: ${type}`, data);
    }

    /**
     * Get alert severity
     */
    getAlertSeverity(type) {
        const severityMap = {
            high_error_rate: 'high',
            slow_response: 'medium',
            circuit_breaker_instability: 'high',
            security_violations: 'high'
        };
        return severityMap[type] || 'medium';
    }

    /**
     * Send data to all registered integrations
     */
    sendToIntegrations(eventType, data) {
        for (const [name, integration] of this.integrations) {
            try {
                if (typeof integration.send === 'function') {
                    integration.send(eventType, data);
                } else if (typeof integration[eventType] === 'function') {
                    integration[eventType](data);
                }
            } catch (error) {
                console.error(`Error sending to integration '${name}':`, error.message);
            }
        }
    }

    /**
     * Get monitoring metrics
     */
    getMetrics() {
        const now = Date.now();
        const uptime = now - this.metrics.lastReset;
        const avgResponseTime = this.metrics.requests > 0 ? 
            this.metrics.totalResponseTime / this.metrics.requests : 0;
        const errorRate = this.metrics.requests > 0 ? 
            this.metrics.errors / this.metrics.requests : 0;

        return {
            uptime,
            requests: this.metrics.requests,
            errors: this.metrics.errors,
            errorRate: parseFloat(errorRate.toFixed(4)),
            averageResponseTime: Math.round(avgResponseTime),
            circuitBreakerEvents: this.metrics.circuitBreakerEvents.length,
            securityEvents: this.metrics.securityEvents.length,
            alerts: this.alerts.length,
            unacknowledgedAlerts: this.alerts.filter(a => !a.acknowledged).length,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Get alerts
     */
    getAlerts(filters = {}) {
        let filteredAlerts = [...this.alerts];

        if (filters.severity) {
            filteredAlerts = filteredAlerts.filter(a => a.severity === filters.severity);
        }

        if (filters.type) {
            filteredAlerts = filteredAlerts.filter(a => a.type === filters.type);
        }

        if (filters.acknowledged !== undefined) {
            filteredAlerts = filteredAlerts.filter(a => a.acknowledged === filters.acknowledged);
        }

        return filteredAlerts.reverse(); // Most recent first
    }

    /**
     * Acknowledge alert
     */
    acknowledgeAlert(alertId) {
        const alert = this.alerts.find(a => a.id === alertId);
        if (alert) {
            alert.acknowledged = true;
            alert.acknowledgedAt = new Date().toISOString();
            return true;
        }
        return false;
    }

    /**
     * Reset metrics
     */
    resetMetrics() {
        this.metrics = {
            requests: 0,
            errors: 0,
            totalResponseTime: 0,
            circuitBreakerEvents: [],
            securityEvents: [],
            lastReset: Date.now()
        };
    }

    /**
     * Generate alert ID
     */
    generateAlertId() {
        return `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Express middleware for request tracking
     */
    requestTrackingMiddleware() {
        return (req, res, next) => {
            const startTime = Date.now();

            // Track request completion
            res.on('finish', () => {
                const responseTime = Date.now() - startTime;
                
                this.emit('request', {
                    url: req.url,
                    method: req.method,
                    statusCode: res.statusCode,
                    responseTime,
                    userAgent: req.headers['user-agent'],
                    ip: req.ip
                });
            });

            next();
        };
    }
}

/**
 * Simple webhook integration for monitoring
 */
class WebhookIntegration {
    constructor(webhookUrl, options = {}) {
        this.webhookUrl = webhookUrl;
        this.options = options;
        this.axios = require('axios');
    }

    async send(eventType, data) {
        try {
            await this.axios.post(this.webhookUrl, {
                eventType,
                data,
                timestamp: new Date().toISOString(),
                service: 'n8n-claude-prompt-system'
            }, {
                timeout: 5000,
                headers: {
                    'Content-Type': 'application/json',
                    ...this.options.headers
                }
            });
        } catch (error) {
            console.error('Webhook integration error:', error.message);
        }
    }
}

/**
 * Console integration for development
 */
class ConsoleIntegration {
    constructor(options = {}) {
        this.logLevel = options.logLevel || 'info';
    }

    send(eventType, data) {
        const message = `[${eventType.toUpperCase()}] ${JSON.stringify(data, null, 2)}`;
        
        switch (eventType) {
        case 'error':
        case 'alert':
            console.error(message);
            break;
        case 'security':
            console.warn(message);
            break;
        default:
            if (this.logLevel === 'debug') {
                console.log(message);
            }
        }
    }
}

module.exports = {
    MonitoringManager,
    WebhookIntegration,
    ConsoleIntegration
};