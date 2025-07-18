/**
 * Circuit Breaker Tests
 * Test suite for circuit breaker functionality
 */

const { CircuitBreaker, CircuitBreakerManager } = require('../core/circuit_breaker');
const { CircuitBreakerError } = require('../core/error_types');

describe('CircuitBreaker', () => {
    let circuitBreaker;

    beforeEach(() => {
        circuitBreaker = new CircuitBreaker({
            name: 'test-circuit',
            failureThreshold: 3,
            successThreshold: 2,
            timeout: 1000
        });
    });

    describe('Basic Functionality', () => {
        test('should start in closed state', () => {
            expect(circuitBreaker.state).toBe('closed');
            expect(circuitBreaker.isHealthy()).toBe(true);
        });

        test('should execute function successfully', async () => {
            const mockFn = jest.fn().mockResolvedValue('success');
            
            const result = await circuitBreaker.execute(mockFn, 'arg1', 'arg2');
            
            expect(result).toBe('success');
            expect(mockFn).toHaveBeenCalledWith('arg1', 'arg2');
            expect(circuitBreaker.state).toBe('closed');
        });

        test('should handle function failures', async () => {
            const mockFn = jest.fn().mockRejectedValue(new Error('Test error'));
            
            await expect(circuitBreaker.execute(mockFn)).rejects.toThrow('Test error');
            expect(circuitBreaker.failureCount).toBe(1);
        });
    });

    describe('State Transitions', () => {
        test('should open circuit after threshold failures', async () => {
            const mockFn = jest.fn().mockRejectedValue(new Error('Test error'));
            
            // First 3 failures should open the circuit
            for (let i = 0; i < 3; i++) {
                await expect(circuitBreaker.execute(mockFn)).rejects.toThrow('Test error');
            }
            
            expect(circuitBreaker.state).toBe('open');
            expect(circuitBreaker.isHealthy()).toBe(false);
        });

        test('should reject requests when circuit is open', async () => {
            // Force circuit to open
            circuitBreaker.state = 'open';
            circuitBreaker.nextAttempt = Date.now() + 5000;
            
            const mockFn = jest.fn();
            
            await expect(circuitBreaker.execute(mockFn)).rejects.toThrow(CircuitBreakerError);
            expect(mockFn).not.toHaveBeenCalled();
        });

        test('should transition to half-open after timeout', async () => {
            // Force circuit to open with past timeout
            circuitBreaker.state = 'open';
            circuitBreaker.nextAttempt = Date.now() - 1000;
            
            const mockFn = jest.fn().mockResolvedValue('success');
            
            await circuitBreaker.execute(mockFn);
            
            // After one success in half-open, we need another success to close
            expect(circuitBreaker.state).toBe('half-open');
            
            // Execute again to close the circuit
            await circuitBreaker.execute(mockFn);
            expect(circuitBreaker.state).toBe('closed');
        });
    });

    describe('Metrics', () => {
        test('should track metrics correctly', async () => {
            const successFn = jest.fn().mockResolvedValue('success');
            const failFn = jest.fn().mockRejectedValue(new Error('fail'));
            
            await circuitBreaker.execute(successFn);
            await expect(circuitBreaker.execute(failFn)).rejects.toThrow();
            
            const status = circuitBreaker.getStatus();
            expect(status.metrics.totalRequests).toBe(2);
            expect(status.metrics.totalSuccesses).toBe(1);
            expect(status.metrics.totalFailures).toBe(1);
            expect(status.metrics.successRate).toBe(0.5);
            expect(status.metrics.failureRate).toBe(0.5);
        });
    });
});

describe('CircuitBreakerManager', () => {
    let manager;

    beforeEach(() => {
        manager = new CircuitBreakerManager();
    });

    test('should create and manage circuit breakers', async () => {
        const mockFn = jest.fn().mockResolvedValue('success');
        
        const result = await manager.execute('test-service', mockFn);
        
        expect(result).toBe('success');
        expect(manager.circuitBreakers.has('test-service')).toBe(true);
    });

    test('should provide health status for all circuits', () => {
        manager.getCircuitBreaker('service1');
        manager.getCircuitBreaker('service2');
        
        const health = manager.getHealthStatus();
        
        expect(health.healthy).toBe(true);
        expect(health.circuitBreakers).toHaveProperty('service1');
        expect(health.circuitBreakers).toHaveProperty('service2');
    });

    test('should reset all circuit breakers', () => {
        const cb1 = manager.getCircuitBreaker('service1');
        const cb2 = manager.getCircuitBreaker('service2');
        
        cb1.failureCount = 5;
        cb2.failureCount = 3;
        
        manager.resetAll();
        
        expect(cb1.failureCount).toBe(0);
        expect(cb2.failureCount).toBe(0);
    });
});