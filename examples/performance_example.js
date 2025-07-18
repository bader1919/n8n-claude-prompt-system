/**
 * Performance Optimization Example - Demonstrates batch processing and caching
 * Part of the n8n Claude Prompt System
 */

const axios = require('axios');

class PerformanceExample {
    constructor(baseUrl = 'http://localhost:3000') {
        this.baseUrl = baseUrl;
        this.apiKey = 'test-api-key'; // Use your actual API key
    }

    /**
     * Example 1: Batch Processing Multiple Requests
     */
    async demonstrateBatchProcessing() {
        console.log('=== Batch Processing Example ===');
        
        const batchRequests = [
            {
                template: 'business_operations/customer_support_template',
                variables: {
                    customer_name: 'John Doe',
                    issue_type: 'billing',
                    urgency: 'high'
                }
            },
            {
                template: 'content_creation/blog_post_template',
                variables: {
                    topic: 'AI automation',
                    target_audience: 'developers',
                    word_count: '800'
                }
            },
            {
                template: 'business_operations/data_analysis_template',
                variables: {
                    dataset: 'sales_data_q4',
                    analysis_type: 'trend analysis'
                }
            }
        ];

        try {
            const startTime = Date.now();
            
            const response = await axios.post(`${this.baseUrl}/api/generate/batch`, {
                requests: batchRequests,
                options: {
                    provider: 'claude',
                    batchSize: 3,
                    maxConcurrent: 2
                }
            }, {
                headers: {
                    'x-api-key': this.apiKey,
                    'Content-Type': 'application/json'
                }
            });

            const totalTime = Date.now() - startTime;
            const batchData = response.data.batch;

            console.log(`✅ Batch completed in ${totalTime}ms`);
            console.log(`📊 Results: ${batchData.summary.successful}/${batchData.summary.total} successful`);
            console.log(`⚡ Average time per request: ${batchData.summary.averageTime.toFixed(1)}ms`);
            
            // Show individual results
            batchData.results.forEach((result, index) => {
                if (result.success) {
                    console.log(`📝 Request ${index + 1}: Success (${result.usage?.totalTokens || 0} tokens)`);
                } else {
                    console.log(`❌ Request ${index + 1}: Failed - ${result.error}`);
                }
            });

        } catch (error) {
            console.error('Batch processing failed:', error.message);
        }
    }

    /**
     * Example 2: Cache Performance Demonstration
     */
    async demonstrateCachePerformance() {
        console.log('\n=== Cache Performance Example ===');
        
        const testRequest = {
            template: 'content_creation/blog_post_template',
            variables: {
                topic: 'performance optimization',
                target_audience: 'technical users',
                word_count: '500'
            },
            provider: 'claude'
        };

        try {
            // First request (cache miss)
            console.log('🔄 Making first request (cache miss)...');
            const start1 = Date.now();
            await axios.post(`${this.baseUrl}/api/generate`, testRequest, {
                headers: { 'x-api-key': this.apiKey }
            });
            const time1 = Date.now() - start1;
            console.log(`⏱️  First request time: ${time1}ms`);

            // Second request (cache hit)
            console.log('🔄 Making second request (cache hit)...');
            const start2 = Date.now();
            const response2 = await axios.post(`${this.baseUrl}/api/generate`, testRequest, {
                headers: { 'x-api-key': this.apiKey }
            });
            const time2 = Date.now() - start2;
            
            console.log(`⚡ Second request time: ${time2}ms`);
            console.log(`🚀 Performance improvement: ${((time1 - time2) / time1 * 100).toFixed(1)}%`);
            console.log(`📦 Response was cached: ${response2.data.result.cached}`);

        } catch (error) {
            console.error('Cache demonstration failed:', error.message);
        }
    }

    /**
     * Example 3: Performance Monitoring
     */
    async demonstratePerformanceMonitoring() {
        console.log('\n=== Performance Monitoring Example ===');
        
        try {
            // Get current performance metrics
            const metricsResponse = await axios.get(`${this.baseUrl}/api/performance`);
            const metrics = metricsResponse.data.performance;

            console.log('📊 Current System Metrics:');
            console.log(`💾 Memory usage: ${metrics.current.system.memory.percentage.toFixed(1)}%`);
            console.log(`🖥️  CPU usage: ${metrics.current.cpu.usage.toFixed(1)}%`);
            console.log(`⏱️  Average response time: ${metrics.current.requests.avgResponseTime}ms`);
            console.log(`✅ Success rate: ${((metrics.current.requests.successful / metrics.current.requests.total) * 100).toFixed(1)}%`);

            // Get cache statistics
            const cacheResponse = await axios.get(`${this.baseUrl}/api/cache/stats`);
            const cache = cacheResponse.data.cache;

            console.log('\n📦 Cache Performance:');
            console.log(`🎯 Hit rate: ${cache.metrics.hitRate}%`);
            console.log(`📈 Total operations: ${cache.metrics.operations}`);
            console.log(`💾 Memory cache size: ${cache.metrics.memory.size}/${cache.metrics.memory.max}`);
            console.log(`🔗 Redis status: ${cache.health.redis.status}`);

            // Check for performance recommendations
            if (metrics.recommendations && metrics.recommendations.length > 0) {
                console.log('\n💡 Performance Recommendations:');
                metrics.recommendations.forEach(rec => {
                    console.log(`⚠️  ${rec.type}: ${rec.message} (${rec.severity})`);
                });
            } else {
                console.log('\n✅ No performance issues detected');
            }

        } catch (error) {
            console.error('Performance monitoring failed:', error.message);
        }
    }

    /**
     * Example 4: Cache Management
     */
    async demonstrateCacheManagement() {
        console.log('\n=== Cache Management Example ===');
        
        try {
            // Warm cache with common requests
            console.log('🔥 Warming cache with common data...');
            await axios.post(`${this.baseUrl}/api/cache/warm`, {
                data: {
                    'common_template_1': { content: 'Cached content 1', cached: true },
                    'common_template_2': { content: 'Cached content 2', cached: true }
                },
                options: {
                    type: 'template_content',
                    warmTTL: 3600
                }
            }, {
                headers: { 'x-api-key': this.apiKey }
            });
            console.log('✅ Cache warming completed');

            // Get cache stats after warming
            const statsResponse = await axios.get(`${this.baseUrl}/api/cache/stats`);
            console.log(`📦 Cache size after warming: ${statsResponse.data.cache.metrics.memory.size}`);

            // Clear specific cache pattern (optional)
            // await axios.post(`${this.baseUrl}/api/cache/clear`, {
            //     pattern: 'common_*',
            //     type: 'template_content'
            // }, {
            //     headers: { 'x-api-key': this.apiKey }
            // });
            // console.log('🧹 Cache cleared');

        } catch (error) {
            console.error('Cache management failed:', error.message);
        }
    }

    /**
     * Run all performance examples
     */
    async runAllExamples() {
        console.log('🚀 Performance Optimization Examples\n');
        
        try {
            await this.demonstrateBatchProcessing();
            await this.demonstrateCachePerformance();
            await this.demonstratePerformanceMonitoring();
            await this.demonstrateCacheManagement();
            
            console.log('\n✅ All performance examples completed successfully!');
            
        } catch (error) {
            console.error('Examples failed:', error.message);
        }
    }
}

// Run examples if this file is executed directly
if (require.main === module) {
    const example = new PerformanceExample();
    example.runAllExamples().catch(console.error);
}

module.exports = PerformanceExample;