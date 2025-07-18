/**
 * Performance Tests - Comprehensive testing for performance optimizations
 * Part of the n8n Claude Prompt System
 *
 * Tests:
 * - Cache performance and hit rates
 * - Connection pooling efficiency
 * - Batch processing performance
 * - Memory usage optimization
 * - Response time improvements
 *
 * @author Bader Abdulrahim
 * @version 1.0.0
 */

const { performance } = require('perf_hooks');
const CacheManager = require('../core/cache_manager');
const ConnectionPoolManager = require('../core/connection_pool');
const PerformanceMonitor = require('../core/performance_monitor');

describe('Performance Optimization Tests', () => {
    let cacheManager;
    let connectionPool;
    let performanceMonitor;

    beforeAll(async () => {
        // Initialize components for testing
        cacheManager = new CacheManager({
            redis: { enabled: false }, // Use memory cache for tests
            memory: { max: 100 }
        });

        connectionPool = new ConnectionPoolManager({
            maxSockets: 10,
            timeout: 5000,
            batching: { enabled: true, maxBatchSize: 5 }
        });

        performanceMonitor = new PerformanceMonitor({
            interval: 1000, // 1 second for testing
            gc: { enabled: false } // Disable GC for consistent tests
        });
    });

    afterAll(async () => {
        if (cacheManager) await cacheManager.close();
        if (connectionPool) await connectionPool.close();
        if (performanceMonitor) performanceMonitor.stop();
    });

    describe('Cache Performance', () => {
        test('should demonstrate cache hit performance improvement', async () => {
            const testData = { test: 'data', timestamp: Date.now() };
            const cacheKey = 'performance_test_key';

            // First access - cache miss
            const start1 = performance.now();
            const result1 = await cacheManager.get(cacheKey);
            const miss_time = performance.now() - start1;

            expect(result1).toBeNull();

            // Set cache
            await cacheManager.set(cacheKey, testData);

            // Second access - cache hit
            const start2 = performance.now();
            const result2 = await cacheManager.get(cacheKey);
            const hit_time = performance.now() - start2;

            expect(result2).toEqual(testData);
            expect(hit_time).toBeLessThan(miss_time * 0.5); // Cache hit should be at least 50% faster
        });

        test('should maintain high cache hit rate under load', async () => {
            const testKeys = Array.from({ length: 50 }, (_, i) => `load_test_${i}`);
            const testData = { data: 'test_value' };

            // Populate cache
            await Promise.all(
                testKeys.map(key => cacheManager.set(key, testData))
            );

            // Simulate load with repeated access
            const accessPromises = [];
            for (let i = 0; i < 200; i++) {
                const randomKey = testKeys[Math.floor(Math.random() * testKeys.length)];
                accessPromises.push(cacheManager.get(randomKey));
            }

            const results = await Promise.all(accessPromises);
            const hits = results.filter(r => r !== null).length;
            const hitRate = hits / results.length;

            expect(hitRate).toBeGreaterThan(0.95); // 95% hit rate
        });

        test('should handle cache invalidation efficiently', async () => {
            const keys = Array.from({ length: 10 }, (_, i) => `invalidation_test_${i}`);

            // Populate cache
            await Promise.all(
                keys.map(key => cacheManager.set(key, { data: key }))
            );

            // Verify all keys exist
            const existsResults = await Promise.all(
                keys.map(key => cacheManager.exists(key))
            );
            expect(existsResults.every(exists => exists)).toBe(true);

            // Clear specific pattern
            const start = performance.now();
            await cacheManager.clear('invalidation_test_*');
            const clearTime = performance.now() - start;

            // Verify keys are cleared
            const existsAfterClear = await Promise.all(
                keys.map(key => cacheManager.exists(key))
            );
            expect(existsAfterClear.every(exists => !exists)).toBe(true);
            expect(clearTime).toBeLessThan(100); // Should clear quickly
        });
    });

    describe('Connection Pool Performance', () => {
        test('should reuse connections effectively', async () => {
            const testUrl = 'https://httpbin.org/get';
            const requests = [];

            // Make multiple requests to same host
            for (let i = 0; i < 10; i++) {
                requests.push(
                    connectionPool.request({
                        method: 'GET',
                        url: testUrl,
                        params: { test: i }
                    })
                );
            }

            const start = performance.now();
            const responses = await Promise.allSettled(requests);
            const totalTime = performance.now() - start;

            const successful = responses.filter(r => r.status === 'fulfilled').length;

            expect(successful).toBeGreaterThan(5); // At least half should succeed
            expect(totalTime).toBeLessThan(5000); // Should complete within 5 seconds

            // Check connection pool metrics
            const metrics = connectionPool.getMetrics();
            expect(metrics.totalRequests).toBe(10);
        });

        test('should implement circuit breaker correctly', async () => {
            const failingUrl = 'https://httpbin.org/status/500';
            const requests = [];

            // Make requests that will fail
            for (let i = 0; i < 8; i++) {
                requests.push(
                    connectionPool.request({
                        method: 'GET',
                        url: failingUrl
                    }).catch(error => ({ error: error.message }))
                );
            }

            await Promise.all(requests);

            // Check if circuit breaker is triggered
            const metrics = connectionPool.getMetrics();
            const circuitBreakers = metrics.circuitBreakers;

            expect(circuitBreakers.length).toBeGreaterThan(0);
            // Should have at least one circuit breaker entry
        });

        test('should batch requests when enabled', async () => {
            const requests = [];
            const batchSize = 5;

            // Create batchable requests (GET requests to same host)
            for (let i = 0; i < batchSize; i++) {
                requests.push(
                    connectionPool.request({
                        method: 'GET',
                        url: 'https://httpbin.org/get',
                        params: { batch: i }
                    })
                );
            }

            const start = performance.now();
            const results = await Promise.allSettled(requests);
            const totalTime = performance.now() - start;

            const successful = results.filter(r => r.status === 'fulfilled').length;
            expect(successful).toBeGreaterThan(2); // At least some should succeed
            expect(totalTime).toBeLessThan(3000); // Should complete reasonably fast

            // Check batch metrics
            const metrics = connectionPool.getMetrics();
            expect(metrics.batchedRequests).toBeGreaterThan(0);
        });
    });

    describe('Performance Monitor', () => {
        test('should track request performance accurately', async () => {
            const requestId = 'test_request_123';
            const metadata = { endpoint: '/test', method: 'GET' };

            // Start tracking
            const tracking = performanceMonitor.startRequestTracking(requestId, metadata);
            expect(tracking.id).toBe(requestId);
            expect(tracking.startTime).toBeDefined();

            // Simulate processing time
            await new Promise(resolve => setTimeout(resolve, 100));

            // End tracking
            const completed = performanceMonitor.endRequestTracking(requestId, true);
            expect(completed.success).toBe(true);
            expect(completed.responseTime).toBeGreaterThan(90);
            expect(completed.responseTime).toBeLessThan(150);
        });

        test('should calculate metrics correctly', async () => {
            const requestIds = ['req1', 'req2', 'req3'];

            // Track multiple requests
            for (const id of requestIds) {
                performanceMonitor.startRequestTracking(id);
                await new Promise(resolve => setTimeout(resolve, 50));
                performanceMonitor.endRequestTracking(id, true);
            }

            const metrics = performanceMonitor.getMetrics();
            expect(metrics.current.requests.total).toBeGreaterThanOrEqual(3);
            expect(metrics.current.requests.successful).toBeGreaterThanOrEqual(3);
            expect(metrics.current.requests.avgResponseTime).toBeGreaterThan(0);
        });

        test('should provide performance recommendations', async () => {
            // Simulate high memory usage
            const originalMetrics = performanceMonitor.metrics.system.memory;
            performanceMonitor.metrics.system.memory.percentage = 85;

            const recommendations = performanceMonitor.getRecommendations();

            expect(recommendations.length).toBeGreaterThan(0);
            expect(recommendations.some(r => r.type === 'memory')).toBe(true);

            // Restore original metrics
            performanceMonitor.metrics.system.memory = originalMetrics;
        });
    });

    describe('Integration Performance', () => {
        test('should demonstrate end-to-end performance improvement', async () => {
            const iterations = 10;
            const testData = { content: 'test content', tokens: 100 };

            // Simulate API calls with caching
            const times = [];

            for (let i = 0; i < iterations; i++) {
                const start = performance.now();

                // Check cache first
                const cacheKey = `api_response_${i % 3}`; // Repeat every 3 calls
                let result = await cacheManager.get(cacheKey, { type: 'api_response' });

                if (!result) {
                    // Simulate API call delay
                    await new Promise(resolve => setTimeout(resolve, 100));
                    result = testData;
                    await cacheManager.set(cacheKey, result, { type: 'api_response' });
                }

                const time = performance.now() - start;
                times.push(time);
            }

            // Calculate performance metrics
            const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
            const cachedCalls = times.filter(t => t < 50).length; // Fast calls are cached
            const cacheHitRate = cachedCalls / iterations;

            expect(avgTime).toBeLessThan(75); // Average should be better due to caching
            expect(cacheHitRate).toBeGreaterThan(0.5); // At least 50% cache hits
        });

        test('should handle concurrent load efficiently', async () => {
            const concurrentRequests = 20;
            const promises = [];

            const start = performance.now();

            for (let i = 0; i < concurrentRequests; i++) {
                promises.push(
                    (async () => {
                        const requestId = `concurrent_${i}`;
                        performanceMonitor.startRequestTracking(requestId);

                        // Simulate processing
                        await new Promise(resolve => setTimeout(resolve, Math.random() * 100));

                        return performanceMonitor.endRequestTracking(requestId, true);
                    })()
                );
            }

            const results = await Promise.all(promises);
            const totalTime = performance.now() - start;

            expect(results.length).toBe(concurrentRequests);
            expect(totalTime).toBeLessThan(1000); // Should handle concurrency well

            const avgResponseTime = results.reduce((sum, r) => sum + r.responseTime, 0) / results.length;
            expect(avgResponseTime).toBeLessThan(200); // Individual requests should be fast
        });
    });

    describe('Memory Optimization', () => {
        test('should maintain stable memory usage under load', async () => {
            const initialMemory = process.memoryUsage().heapUsed;
            const largeData = 'x'.repeat(10000); // 10KB string

            // Generate load
            for (let i = 0; i < 100; i++) {
                await cacheManager.set(`memory_test_${i}`, { data: largeData, index: i });

                // Occasionally clear cache to prevent unbounded growth
                if (i % 20 === 0) {
                    await cacheManager.clear('memory_test_*');
                }
            }

            const finalMemory = process.memoryUsage().heapUsed;
            const memoryIncrease = finalMemory - initialMemory;

            // Memory increase should be reasonable (less than 50MB)
            expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024);
        });
    });
});
