/**
 * Cache Manager - Intelligent caching system with Redis and in-memory fallback
 * Part of the n8n Claude Prompt System
 *
 * Features:
 * - Redis caching with connection pooling
 * - In-memory LRU cache fallback
 * - Intelligent cache invalidation strategies
 * - Different TTL policies for different content types
 * - Cache warming and preloading
 * - Performance metrics and monitoring
 *
 * @author Bader Abdulrahim
 * @version 1.0.0
 */

const Redis = require('ioredis');
const { LRUCache } = require('lru-cache');
const crypto = require('crypto');
const EventEmitter = require('events');

class CacheManager extends EventEmitter {
    constructor(options = {}) {
        super();

        this.config = {
            redis: {
                enabled: options.redis?.enabled ?? true,
                host: options.redis?.host || process.env.REDIS_HOST || 'localhost',
                port: options.redis?.port || process.env.REDIS_PORT || 6379,
                password: options.redis?.password || process.env.REDIS_PASSWORD,
                db: options.redis?.db || 0,
                maxRetriesPerRequest: 3,
                retryDelayOnFailover: 100,
                enableReadyCheck: true,
                lazyConnect: true,
                keepAlive: 30000,
                connectTimeout: 10000,
                commandTimeout: 5000,
                maxmemoryPolicy: 'allkeys-lru'
            },
            memory: {
                max: options.memory?.max || 1000,
                ttl: options.memory?.ttl || 1000 * 60 * 60, // 1 hour
                allowStale: true,
                updateAgeOnGet: true,
                updateAgeOnHas: true
            },
            defaultTTL: options.defaultTTL || 3600, // 1 hour in seconds
            keyPrefix: options.keyPrefix || 'n8n:claude:',
            compression: options.compression ?? true,
            metrics: options.metrics ?? true
        };

        this.redisClient = null;
        this.memoryCache = new LRUCache(this.config.memory);
        this.isRedisConnected = false;
        this.metrics = {
            hits: 0,
            misses: 0,
            errors: 0,
            operations: 0,
            redisHits: 0,
            memoryHits: 0,
            writeOperations: 0,
            deleteOperations: 0
        };

        // TTL policies for different content types
        this.ttlPolicies = {
            'claude_response': 1800, // 30 minutes
            'template_content': 3600, // 1 hour
            'provider_config': 7200, // 2 hours
            'health_status': 300, // 5 minutes
            'metrics': 60, // 1 minute
            'user_session': 86400, // 24 hours
            'api_response': 900, // 15 minutes
            'default': this.config.defaultTTL
        };

        this.initializeCache();
    }

    /**
     * Initialize cache connections
     */
    async initializeCache() {
        if (this.config.redis.enabled) {
            await this.initializeRedis();
        }

        // Start metrics collection if enabled
        if (this.config.metrics) {
            this.startMetricsCollection();
        }

        console.log('Cache Manager initialized successfully');
    }

    /**
     * Initialize Redis connection with retry logic
     */
    async initializeRedis() {
        try {
            this.redisClient = new Redis({
                ...this.config.redis,
                retryDelayOnFailover: 100,
                enableOfflineQueue: false,
                maxRetriesPerRequest: 3
            });

            this.redisClient.on('connect', () => {
                console.log('Redis connected successfully');
                this.isRedisConnected = true;
                this.emit('redis:connected');
            });

            this.redisClient.on('error', (error) => {
                console.error('Redis connection error:', error.message);
                this.isRedisConnected = false;
                this.metrics.errors++;
                this.emit('redis:error', error);
            });

            this.redisClient.on('close', () => {
                console.log('Redis connection closed');
                this.isRedisConnected = false;
                this.emit('redis:disconnected');
            });

            this.redisClient.on('reconnecting', () => {
                console.log('Redis reconnecting...');
                this.emit('redis:reconnecting');
            });

            // Test connection
            await this.redisClient.ping();
            console.log('Redis connection test successful');

        } catch (error) {
            console.warn('Redis initialization failed, using memory cache only:', error.message);
            this.redisClient = null;
            this.isRedisConnected = false;
        }
    }

    /**
     * Generate cache key with prefix and hashing for long keys
     */
    generateKey(key, type = 'default') {
        const fullKey = `${this.config.keyPrefix}${type}:${key}`;

        // Hash long keys to prevent Redis key length issues
        if (fullKey.length > 250) {
            const hash = crypto.createHash('sha256').update(fullKey).digest('hex');
            return `${this.config.keyPrefix}${type}:hash:${hash}`;
        }

        return fullKey;
    }

    /**
     * Get TTL based on content type
     */
    getTTL(type = 'default') {
        return this.ttlPolicies[type] || this.ttlPolicies.default;
    }

    /**
     * Set cache value with intelligent storage selection
     */
    async set(key, value, options = {}) {
        try {
            this.metrics.operations++;
            this.metrics.writeOperations++;

            const cacheKey = this.generateKey(key, options.type);
            const ttl = options.ttl || this.getTTL(options.type);
            const serializedValue = JSON.stringify({
                data: value,
                timestamp: Date.now(),
                type: options.type || 'default',
                compressed: this.config.compression
            });

            // Try Redis first if available
            if (this.isRedisConnected && this.redisClient) {
                try {
                    await this.redisClient.setex(cacheKey, ttl, serializedValue);
                    this.emit('cache:set', { key: cacheKey, type: 'redis', size: serializedValue.length });
                } catch (redisError) {
                    console.warn('Redis set failed, falling back to memory cache:', redisError.message);
                    this.metrics.errors++;
                }
            }

            // Always set in memory cache as backup/faster access
            this.memoryCache.set(cacheKey, serializedValue, {
                ttl: ttl * 1000 // LRU cache expects milliseconds
            });

            return true;
        } catch (error) {
            console.error('Cache set error:', error);
            this.metrics.errors++;
            return false;
        }
    }

    /**
     * Get cache value with fallback logic
     */
    async get(key, options = {}) {
        try {
            this.metrics.operations++;
            const cacheKey = this.generateKey(key, options.type);
            let value = null;
            let source = null;

            // Try memory cache first (fastest)
            const memoryValue = this.memoryCache.get(cacheKey);
            if (memoryValue) {
                value = memoryValue;
                source = 'memory';
                this.metrics.memoryHits++;
            }

            // If not in memory and Redis is available, try Redis
            if (!value && this.isRedisConnected && this.redisClient) {
                try {
                    const redisValue = await this.redisClient.get(cacheKey);
                    if (redisValue) {
                        value = redisValue;
                        source = 'redis';
                        this.metrics.redisHits++;

                        // Update memory cache with Redis value
                        this.memoryCache.set(cacheKey, redisValue, {
                            ttl: this.getTTL(options.type) * 1000
                        });
                    }
                } catch (redisError) {
                    console.warn('Redis get failed:', redisError.message);
                    this.metrics.errors++;
                }
            }

            if (value) {
                this.metrics.hits++;
                const parsed = JSON.parse(value);

                // Check if value has expired (additional safety)
                const age = Date.now() - parsed.timestamp;
                const maxAge = this.getTTL(parsed.type) * 1000;

                if (age > maxAge) {
                    this.metrics.misses++;
                    await this.delete(key, options);
                    return null;
                }

                this.emit('cache:hit', { key: cacheKey, source, age, type: parsed.type });
                return parsed.data;
            }

            this.metrics.misses++;
            this.emit('cache:miss', { key: cacheKey, type: options.type });
            return null;

        } catch (error) {
            console.error('Cache get error:', error);
            this.metrics.errors++;
            return null;
        }
    }

    /**
     * Delete cache value from both stores
     */
    async delete(key, options = {}) {
        try {
            this.metrics.operations++;
            this.metrics.deleteOperations++;

            const cacheKey = this.generateKey(key, options.type);

            // Delete from Redis
            if (this.isRedisConnected && this.redisClient) {
                try {
                    await this.redisClient.del(cacheKey);
                } catch (redisError) {
                    console.warn('Redis delete failed:', redisError.message);
                    this.metrics.errors++;
                }
            }

            // Delete from memory cache
            this.memoryCache.delete(cacheKey);

            this.emit('cache:delete', { key: cacheKey });
            return true;
        } catch (error) {
            console.error('Cache delete error:', error);
            this.metrics.errors++;
            return false;
        }
    }

    /**
     * Check if key exists in cache
     */
    async exists(key, options = {}) {
        const cacheKey = this.generateKey(key, options.type);

        // Check memory cache first
        if (this.memoryCache.has(cacheKey)) {
            return true;
        }

        // Check Redis if available
        if (this.isRedisConnected && this.redisClient) {
            try {
                const result = await this.redisClient.exists(cacheKey);
                return result === 1;
            } catch (redisError) {
                console.warn('Redis exists check failed:', redisError.message);
                this.metrics.errors++;
            }
        }

        return false;
    }

    /**
     * Clear cache with pattern support
     */
    async clear(pattern = null, options = {}) {
        try {
            this.metrics.operations++;

            if (pattern) {
                const searchPattern = this.generateKey(pattern, options.type);

                // Clear from Redis with pattern
                if (this.isRedisConnected && this.redisClient) {
                    try {
                        const keys = await this.redisClient.keys(searchPattern);
                        if (keys.length > 0) {
                            await this.redisClient.del(...keys);
                        }
                    } catch (redisError) {
                        console.warn('Redis pattern clear failed:', redisError.message);
                        this.metrics.errors++;
                    }
                }

                // Clear from memory cache with pattern
                for (const key of this.memoryCache.keys()) {
                    if (key.includes(searchPattern.replace('*', ''))) {
                        this.memoryCache.delete(key);
                    }
                }
            } else {
                // Clear all
                if (this.isRedisConnected && this.redisClient) {
                    try {
                        await this.redisClient.flushdb();
                    } catch (redisError) {
                        console.warn('Redis flush failed:', redisError.message);
                        this.metrics.errors++;
                    }
                }
                this.memoryCache.clear();
            }

            this.emit('cache:clear', { pattern });
            return true;
        } catch (error) {
            console.error('Cache clear error:', error);
            this.metrics.errors++;
            return false;
        }
    }

    /**
     * Invalidate cache based on content changes
     */
    async invalidateByType(type) {
        return await this.clear('*', { type });
    }

    /**
     * Warm cache with frequently accessed data
     */
    async warmCache(dataMap, options = {}) {
        console.log(`Warming cache with ${Object.keys(dataMap).length} items`);

        const promises = Object.entries(dataMap).map(([key, value]) =>
            this.set(key, value, { ...options, ttl: options.warmTTL || this.getTTL(options.type) })
        );

        const results = await Promise.allSettled(promises);
        const successful = results.filter(r => r.status === 'fulfilled').length;

        console.log(`Cache warming completed: ${successful}/${results.length} items cached`);
        this.emit('cache:warmed', { total: results.length, successful });

        return successful;
    }

    /**
     * Get cache statistics and metrics
     */
    getMetrics() {
        const memoryStats = {
            size: this.memoryCache.size,
            max: this.memoryCache.max,
            calculatedSize: this.memoryCache.calculatedSize
        };

        const hitRate = this.metrics.operations > 0 ?
            (this.metrics.hits / this.metrics.operations * 100).toFixed(2) : 0;

        return {
            ...this.metrics,
            hitRate: parseFloat(hitRate),
            memory: memoryStats,
            redis: {
                connected: this.isRedisConnected,
                client: this.redisClient ? 'available' : 'unavailable'
            },
            ttlPolicies: this.ttlPolicies,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Start metrics collection interval
     */
    startMetricsCollection() {
        setInterval(() => {
            this.emit('metrics:collected', this.getMetrics());
        }, 30000); // Every 30 seconds
    }

    /**
     * Health check for cache system
     */
    async healthCheck() {
        const health = {
            memory: {
                status: 'healthy',
                size: this.memoryCache.size,
                available: true
            },
            redis: {
                status: 'unavailable',
                connected: false,
                available: false
            },
            overall: 'degraded'
        };

        // Test Redis connection
        if (this.redisClient && this.isRedisConnected) {
            try {
                await this.redisClient.ping();
                health.redis = {
                    status: 'healthy',
                    connected: true,
                    available: true
                };
                health.overall = 'healthy';
            } catch (error) {
                health.redis.error = error.message;
            }
        }

        return health;
    }

    /**
     * Close all connections
     */
    async close() {
        if (this.redisClient) {
            await this.redisClient.quit();
        }
        this.memoryCache.clear();
        this.removeAllListeners();
        console.log('Cache Manager closed');
    }
}

module.exports = CacheManager;
