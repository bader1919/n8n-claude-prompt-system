/**
 * Tests for Logging and Monitoring System
 * Part of the n8n Claude Prompt System
 */

const fs = require('fs').promises;
const path = require('path');
const Logger = require('../core/logger');
const MonitoringService = require('../core/monitoring');

describe('Logging and Monitoring System', () => {
    let logger;
    let monitoring;
    let testLogDir;

    beforeEach(() => {
        testLogDir = path.join(__dirname, '../logs/test');
        logger = new Logger({
            logDir: testLogDir,
            enableConsole: false,
            enableFile: true,
            enableRotation: false
        });
        monitoring = new MonitoringService({
            metricsInterval: 100,
            enableAlerting: false
        });
    });

    afterEach(async () => {
        if (logger) {
            logger.cleanup();
        }
        if (monitoring) {
            monitoring.stop();
        }
        
        // Clean up test logs
        try {
            await fs.rmdir(testLogDir, { recursive: true });
        } catch (error) {
            // Ignore cleanup errors
        }
    });

    describe('Logger', () => {
        test('should create logger instance with default configuration', () => {
            expect(logger).toBeDefined();
            expect(logger.config).toBeDefined();
            expect(logger.config.serviceName).toBe('n8n-claude-prompt-system');
        });

        test('should generate correlation IDs', () => {
            const correlationId = logger.generateCorrelationId();
            expect(correlationId).toMatch(/^req_\d+_[a-z0-9]+$/);
        });

        test('should sanitize sensitive data', () => {
            const sensitiveData = {
                username: 'testuser',
                password: 'secret123',
                apiKey: 'sk-123456',
                data: 'safe data'
            };

            const sanitized = logger.sanitizeData(sensitiveData);
            
            expect(sanitized.username).toBe('testuser');
            expect(sanitized.password).toBe('[REDACTED]');
            expect(sanitized.apiKey).toBe('[REDACTED]');
            expect(sanitized.data).toBe('safe data');
        });

        test('should handle nested object sanitization', () => {
            const nestedData = {
                user: {
                    name: 'test',
                    credentials: {
                        password: 'secret',
                        token: 'abc123'
                    }
                },
                config: {
                    apiKey: 'key123'
                }
            };

            const sanitized = logger.sanitizeData(nestedData);
            
            expect(sanitized.user.name).toBe('test');
            expect(sanitized.user.credentials.password).toBe('[REDACTED]');
            expect(sanitized.user.credentials.token).toBe('[REDACTED]');
            expect(sanitized.config.apiKey).toBe('[REDACTED]');
        });

        test('should truncate very long strings', () => {
            const longString = 'a'.repeat(2000);
            const data = { content: longString };
            
            const sanitized = logger.sanitizeData(data);
            
            expect(sanitized.content).toHaveLength(1014); // 1000 + '...[TRUNCATED]'
            expect(sanitized.content.endsWith('...[TRUNCATED]')).toBe(true);
        });

        test('should log different levels', () => {
            // Test that different log levels work
            expect(() => {
                logger.debug('Debug message', { test: true });
                logger.info('Info message', { test: true });
                logger.warn('Warning message', { test: true });
                logger.error('Error message', new Error('Test error'), { test: true });
            }).not.toThrow();
        });

        test('should log security events', () => {
            expect(() => {
                logger.security('unauthorized_access', {
                    ip: '192.168.1.1',
                    endpoint: '/api/test'
                });
            }).not.toThrow();
        });

        test('should log authentication events', () => {
            expect(() => {
                logger.auth('login_attempt', {
                    username: 'testuser',
                    success: true
                });
            }).not.toThrow();
        });

        test('should log performance metrics', () => {
            expect(() => {
                logger.performance('response_time', 125, 'ms', {
                    endpoint: '/api/test'
                });
            }).not.toThrow();
        });

        test('should manage correlation contexts', () => {
            const correlationId = logger.generateCorrelationId();
            const context = {
                userId: 'test123',
                operation: 'test'
            };

            logger.setCorrelationId(correlationId, context);
            const retrievedContext = logger.getCorrelationContext(correlationId);

            expect(retrievedContext.userId).toBe('test123');
            expect(retrievedContext.operation).toBe('test');
            expect(retrievedContext.createdAt).toBeDefined();
        });

        test('should clean up old correlations', () => {
            const correlationId = logger.generateCorrelationId();
            logger.setCorrelationId(correlationId, { test: true });

            // Manually set old timestamp
            const context = logger.getCorrelationContext(correlationId);
            context.createdAt = new Date(Date.now() - 400000).toISOString(); // 6+ minutes ago

            logger.cleanupCorrelations();

            const retrievedContext = logger.getCorrelationContext(correlationId);
            expect(retrievedContext).toEqual({});
        });

        test('should update log level dynamically', () => {
            expect(logger.config.level).toBe('info');
            logger.setLogLevel('debug');
            expect(logger.config.level).toBe('debug');
        });
    });

    describe('MonitoringService', () => {
        test('should create monitoring service instance', () => {
            expect(monitoring).toBeDefined();
            expect(monitoring.config).toBeDefined();
            expect(monitoring.metrics).toBeDefined();
        });

        test('should track request metrics', () => {
            monitoring.trackRequest('GET', '/api/test', 200, 150);
            
            const metrics = monitoring.getMetrics();
            expect(metrics.requests.total).toBe(1);
            expect(metrics.requests.successful).toBe(1);
            expect(metrics.requests.failed).toBe(0);
        });

        test('should track failed requests', () => {
            monitoring.trackRequest('POST', '/api/test', 500, 250);
            
            const metrics = monitoring.getMetrics();
            expect(metrics.requests.total).toBe(1);
            expect(metrics.requests.successful).toBe(0);
            expect(metrics.requests.failed).toBe(1);
        });

        test('should track security events', () => {
            monitoring.trackSecurityEvent('auth_failure');
            monitoring.trackSecurityEvent('rate_limit');
            
            const metrics = monitoring.getMetrics();
            expect(metrics.security.authFailures).toBe(1);
            expect(metrics.security.rateLimitTriggers).toBe(1);
        });

        test('should track provider usage', () => {
            monitoring.trackProviderUsage('claude', 'generate', true, 1000, 0.05);
            
            const metrics = monitoring.getMetrics();
            expect(metrics.providers.claude).toBeDefined();
            expect(metrics.providers.claude.requests).toBe(1);
            expect(metrics.providers.claude.successes).toBe(1);
            expect(metrics.providers.claude.totalCost).toBe(0.05);
        });

        test('should calculate metrics correctly', () => {
            // Add some test data
            monitoring.trackRequest('GET', '/api/test1', 200, 100);
            monitoring.trackRequest('POST', '/api/test2', 500, 200);
            monitoring.trackRequest('GET', '/api/test1', 200, 150);

            const metrics = monitoring.getMetrics();
            
            expect(metrics.requests.total).toBe(3);
            expect(metrics.requests.successful).toBe(2);
            expect(metrics.requests.failed).toBe(1);
            expect(metrics.requests.errorRate).toBe('33.33%');
        });

        test('should get health status', () => {
            const healthStatus = monitoring.getHealthStatus();
            
            expect(healthStatus.status).toBeDefined();
            expect(healthStatus.timestamp).toBeDefined();
            expect(healthStatus.issues).toBeDefined();
            expect(healthStatus.metrics).toBeDefined();
        });

        test('should format uptime correctly', () => {
            const formatted = monitoring.formatUptime(7325); // 2h 2m 5s
            expect(formatted).toBe('2h 2m 5s');
        });

        test('should handle start and stop', () => {
            expect(monitoring.isRunning).toBe(false);
            
            monitoring.start();
            expect(monitoring.isRunning).toBe(true);
            
            monitoring.stop();
            expect(monitoring.isRunning).toBe(false);
        });

        test('should clean up old metrics', () => {
            // Add metrics with old timestamps
            monitoring.metrics.requests.responseTimes.push({
                timestamp: Date.now() - 2 * 24 * 60 * 60 * 1000, // 2 days ago
                responseTime: 100
            });

            monitoring.cleanupOldMetrics();

            expect(monitoring.metrics.requests.responseTimes.length).toBe(0);
        });
    });

    describe('Integration Tests', () => {
        test('should handle request logging middleware', () => {
            const middleware = logger.requestLoggingMiddleware();
            
            const mockReq = {
                method: 'GET',
                url: '/api/test',
                path: '/api/test',
                headers: { 'user-agent': 'test-agent' },
                ip: '127.0.0.1',
                body: { test: 'data' },
                query: { param: 'value' }
            };
            
            const mockRes = {
                setHeader: jest.fn(),
                on: jest.fn()
            };
            
            const mockNext = jest.fn();

            expect(() => {
                middleware(mockReq, mockRes, mockNext);
                expect(mockReq.correlationId).toBeDefined();
                expect(mockRes.setHeader).toHaveBeenCalledWith('x-correlation-id', mockReq.correlationId);
                expect(mockRes.on).toHaveBeenCalledWith('finish', expect.any(Function));
                expect(mockNext).toHaveBeenCalled();
            }).not.toThrow();
        });

        test('should handle monitoring middleware', () => {
            const middleware = monitoring.requestMonitoringMiddleware();
            
            const mockReq = {
                method: 'GET',
                route: { path: '/api/test' },
                path: '/api/test',
                headers: { 'user-agent': 'test-agent' },
                ip: '127.0.0.1',
                correlationId: 'test-correlation-id'
            };
            
            const mockRes = {
                statusCode: 200,
                get: jest.fn().mockReturnValue('100'),
                on: jest.fn()
            };
            
            const mockNext = jest.fn();

            expect(() => {
                middleware(mockReq, mockRes, mockNext);
                expect(mockRes.on).toHaveBeenCalledWith('finish', expect.any(Function));
                expect(mockNext).toHaveBeenCalled();
            }).not.toThrow();
        });

        test('should handle error logging middleware', () => {
            const middleware = logger.errorLoggingMiddleware();
            
            const mockError = new Error('Test error');
            const mockReq = {
                method: 'GET',
                url: '/api/test',
                headers: { 'user-agent': 'test-agent' },
                ip: '127.0.0.1',
                correlationId: 'test-correlation-id'
            };
            
            const mockRes = {};
            const mockNext = jest.fn();

            expect(() => {
                middleware(mockError, mockReq, mockRes, mockNext);
                expect(mockNext).toHaveBeenCalledWith(mockError);
            }).not.toThrow();
        });
    });

    describe('Configuration', () => {
        test('should get logger configuration', () => {
            const config = logger.getConfig();
            expect(config.serviceName).toBe('n8n-claude-prompt-system');
            expect(config.logDir).toBe(testLogDir);
        });

        test('should get monitoring configuration', () => {
            const config = monitoring.getConfig();
            expect(config.metricsInterval).toBe(100);
            expect(config.enableAlerting).toBe(false);
        });

        test('should update monitoring configuration', () => {
            const newConfig = { metricsInterval: 200 };
            monitoring.updateConfig(newConfig);
            
            const config = monitoring.getConfig();
            expect(config.metricsInterval).toBe(200);
        });
    });
});