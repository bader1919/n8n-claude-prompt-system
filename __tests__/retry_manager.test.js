/**
 * Retry Manager Tests
 * Test suite for retry mechanism functionality
 */

const { RetryPolicy, RetryManager } = require('../core/retry_manager');
const { RateLimitError, ExternalServiceError, TimeoutError } = require('../core/error_types');

describe('RetryPolicy', () => {
    let retryPolicy;

    beforeEach(() => {
        retryPolicy = new RetryPolicy({
            maxRetries: 3,
            initialDelay: 100,
            maxDelay: 1000,
            backoffMultiplier: 2,
            jitter: false // Disable jitter for predictable tests
        });
    });

    describe('shouldRetry', () => {
        test('should retry retryable errors', () => {
            const error = new RateLimitError('Rate limited');
            expect(retryPolicy.shouldRetry(error, 1)).toBe(true);
        });

        test('should not retry after max attempts', () => {
            const error = new RateLimitError('Rate limited');
            expect(retryPolicy.shouldRetry(error, 3)).toBe(false);
        });

        test('should not retry non-retryable errors', () => {
            const error = new Error('Non-retryable');
            error.retryable = false;
            expect(retryPolicy.shouldRetry(error, 1)).toBe(false);
        });

        test('should retry based on error name', () => {
            const error = new TimeoutError('Timeout');
            expect(retryPolicy.shouldRetry(error, 1)).toBe(true);
        });

        test('should retry based on status code', () => {
            const error = new Error('Server error');
            error.status = 500;
            expect(retryPolicy.shouldRetry(error, 1)).toBe(true);
        });
    });

    describe('calculateDelay', () => {
        test('should calculate exponential backoff', () => {
            expect(retryPolicy.calculateDelay(0)).toBe(100);
            expect(retryPolicy.calculateDelay(1)).toBe(200);
            expect(retryPolicy.calculateDelay(2)).toBe(400);
        });

        test('should respect max delay', () => {
            expect(retryPolicy.calculateDelay(10)).toBe(1000); // Should cap at maxDelay
        });

        test('should use retry-after from error', () => {
            const error = new RateLimitError('Rate limited', { retryAfter: 60 });
            expect(retryPolicy.calculateDelay(1, error)).toBe(60000);
        });
    });

    describe('execute', () => {
        test('should succeed on first attempt', async () => {
            const mockFn = jest.fn().mockResolvedValue('success');
            
            const result = await retryPolicy.execute(mockFn);
            
            expect(result).toBe('success');
            expect(mockFn).toHaveBeenCalledTimes(1);
        });

        test('should retry on retryable error', async () => {
            const mockFn = jest.fn()
                .mockRejectedValueOnce(new RateLimitError('Rate limited'))
                .mockResolvedValue('success');
            
            const result = await retryPolicy.execute(mockFn);
            
            expect(result).toBe('success');
            expect(mockFn).toHaveBeenCalledTimes(2);
        });

        test('should fail after max retries', async () => {
            const mockFn = jest.fn().mockRejectedValue(new ExternalServiceError('Service down'));
            
            await expect(retryPolicy.execute(mockFn)).rejects.toThrow('Operation failed after 3 retry attempts');
            expect(mockFn).toHaveBeenCalledTimes(4); // Initial + 3 retries
        });

        test('should not retry non-retryable errors', async () => {
            const error = new Error('Not retryable');
            error.retryable = false;
            const mockFn = jest.fn().mockRejectedValue(error);
            
            await expect(retryPolicy.execute(mockFn)).rejects.toThrow('Not retryable');
            expect(mockFn).toHaveBeenCalledTimes(1);
        });
    });
});

describe('RetryManager', () => {
    let retryManager;

    beforeEach(() => {
        retryManager = new RetryManager();
        retryManager.setupDefaultPolicies();
    });

    test('should execute with named policy', async () => {
        const mockFn = jest.fn().mockResolvedValue('success');
        
        const result = await retryManager.executeWithPolicy('fast', mockFn);
        
        expect(result).toBe('success');
    });

    test('should execute with custom options', async () => {
        const mockFn = jest.fn()
            .mockRejectedValueOnce(new RateLimitError('Rate limited'))
            .mockResolvedValue('success');
        
        // Use much smaller delays for testing
        const result = await retryManager.execute(mockFn, { 
            maxRetries: 1,
            initialDelay: 10,
            maxDelay: 100
        });
        
        expect(result).toBe('success');
    }, 10000); // 10 second timeout

    test('should register and use custom policies', async () => {
        const customPolicy = new RetryPolicy({ maxRetries: 1 });
        retryManager.registerPolicy('custom', customPolicy);
        
        expect(retryManager.getPolicy('custom')).toBe(customPolicy);
    });
});