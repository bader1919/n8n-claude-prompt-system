/**
 * Claude Provider Tests
 * Enhanced test suite for Claude provider functionality, security, and reliability
 */

const ClaudeProvider = require('../providers/claude_provider');
const { ValidationError } = require('../core/error_handler');

// Mock axios to avoid making real API calls
jest.mock('axios');
const axios = require('axios');

describe('ClaudeProvider', () => {
    let claudeProvider;
    const mockApiKey = 'sk-ant-test-api-key-123456789';

    beforeEach(() => {
        claudeProvider = new ClaudeProvider(mockApiKey);
        axios.post.mockClear();
        // Reset rate limiter state for each test
        if (claudeProvider.rateLimiter) {
            claudeProvider.rateLimiter = claudeProvider.createRateLimiter();
        }
    });

    afterEach(() => {
        // Cleanup any timers or pending operations
        jest.clearAllTimers();
        jest.clearAllMocks();
    });

    describe('Constructor', () => {
        test('should initialize with valid API key', () => {
            expect(claudeProvider.apiKey).toBe(mockApiKey);
            expect(claudeProvider.apiUrl).toBe('https://api.anthropic.com/v1/messages');
            expect(claudeProvider.apiVersion).toBe('2023-06-01');
        });

        test('should throw error without API key', () => {
            expect(() => new ClaudeProvider()).toThrow(ValidationError);
            expect(() => new ClaudeProvider(null)).toThrow(ValidationError);
            expect(() => new ClaudeProvider('')).toThrow(ValidationError);
        });
    });

    describe('generateCompletion', () => {
        test('should generate completion with valid input', async () => {
            const mockResponse = {
                status: 200,
                data: {
                    content: [
                        {
                            type: 'text',
                            text: 'Hello! This is a test response.'
                        }
                    ],
                    model: 'claude-3-haiku-20240307',
                    usage: {
                        input_tokens: 10,
                        output_tokens: 8
                    },
                    stop_reason: 'end_turn'
                }
            };

            // Add a small delay to ensure responseTime > 0
            axios.post.mockImplementation(() =>
                new Promise(resolve => setTimeout(() => resolve(mockResponse), 1))
            );

            const result = await claudeProvider.generateCompletion('Hello, how are you?');

            // Enhanced response structure validation
            expect(result).toHaveProperty('content', 'Hello! This is a test response.');
            expect(result).toHaveProperty('model', 'claude-3-haiku-20240307');
            expect(result).toHaveProperty('usage');
            expect(result).toHaveProperty('cost');
            expect(result).toHaveProperty('responseTime');
            expect(result).toHaveProperty('finishReason', 'end_turn');

            // Validate usage object structure
            expect(result.usage).toHaveProperty('inputTokens', 10);
            expect(result.usage).toHaveProperty('outputTokens', 8);
            expect(result.usage).toHaveProperty('totalTokens', 18);

            // Validate data types
            expect(typeof result.content).toBe('string');
            expect(typeof result.model).toBe('string');
            expect(typeof result.cost).toBe('number');
            expect(typeof result.responseTime).toBe('number');
            expect(typeof result.usage.inputTokens).toBe('number');
            expect(typeof result.usage.outputTokens).toBe('number');
            expect(typeof result.usage.totalTokens).toBe('number');

            // Validate response time is reasonable (should be > 0 and < 5000ms for mocked response)
            expect(result.responseTime).toBeGreaterThanOrEqual(0);
            expect(result.responseTime).toBeLessThan(5000);
        });

        test('should handle multiple content blocks in response', async () => {
            const mockResponse = {
                status: 200,
                data: {
                    content: [
                        { type: 'text', text: 'First part: ' },
                        { type: 'text', text: 'Second part.' }
                    ],
                    model: 'claude-3-haiku-20240307',
                    usage: { input_tokens: 5, output_tokens: 10 },
                    stop_reason: 'end_turn'
                }
            };

            axios.post.mockResolvedValue(mockResponse);
            const result = await claudeProvider.generateCompletion('Test prompt');

            expect(result.content).toBe('First part: Second part.');
        });

        test('should filter out non-text content blocks', async () => {
            const mockResponse = {
                status: 200,
                data: {
                    content: [
                        { type: 'text', text: 'Valid text' },
                        { type: 'image', source: 'base64data' },
                        { type: 'text', text: ' content' }
                    ],
                    model: 'claude-3-haiku-20240307',
                    usage: { input_tokens: 5, output_tokens: 10 },
                    stop_reason: 'end_turn'
                }
            };

            axios.post.mockResolvedValue(mockResponse);
            const result = await claudeProvider.generateCompletion('Test prompt');

            expect(result.content).toBe('Valid text content');
        });

        test('should throw error on invalid response format - missing content', async () => {
            const mockResponse = {
                status: 200,
                data: {
                    model: 'claude-3-haiku-20240307',
                    usage: { input_tokens: 5, output_tokens: 10 }
                }
            };

            axios.post.mockResolvedValue(mockResponse);

            await expect(claudeProvider.generateCompletion('Test')).rejects.toThrow('An internal error occurred');
        });

        test('should throw error on invalid response format - non-array content', async () => {
            const mockResponse = {
                status: 200,
                data: {
                    content: 'invalid format',
                    model: 'claude-3-haiku-20240307',
                    usage: { input_tokens: 5, output_tokens: 10 }
                }
            };

            axios.post.mockResolvedValue(mockResponse);

            await expect(claudeProvider.generateCompletion('Test')).rejects.toThrow('An internal error occurred');
        });

        test('should throw error when no text content is returned', async () => {
            const mockResponse = {
                status: 200,
                data: {
                    content: [
                        { type: 'image', source: 'base64data' }
                    ],
                    model: 'claude-3-haiku-20240307',
                    usage: { input_tokens: 5, output_tokens: 10 }
                }
            };

            axios.post.mockResolvedValue(mockResponse);

            await expect(claudeProvider.generateCompletion('Test')).rejects.toThrow('An internal error occurred');
        });

        test('should validate input prompt', async () => {
            // Test empty prompts - these will be wrapped in Error objects by the provider
            await expect(claudeProvider.generateCompletion('')).rejects.toThrow('Invalid input provided');
            await expect(claudeProvider.generateCompletion(null)).rejects.toThrow('Invalid input provided');
            await expect(claudeProvider.generateCompletion('  ')).rejects.toThrow('Invalid input provided');
        });

        test('should reject prompts that are too long', async () => {
            const longPrompt = 'x'.repeat(200001);
            await expect(claudeProvider.generateCompletion(longPrompt)).rejects.toThrow('Invalid input provided');
        });

        test('should sanitize input before sending to API', async () => {
            const maliciousPrompt = '<script>alert("xss")</script>Tell me a joke';

            const mockResponse = {
                status: 200,
                data: {
                    content: [{ type: 'text', text: 'Here is a joke...' }],
                    model: 'claude-3-haiku-20240307',
                    usage: { input_tokens: 5, output_tokens: 5 },
                    stop_reason: 'end_turn'
                }
            };

            axios.post.mockResolvedValue(mockResponse);

            await claudeProvider.generateCompletion(maliciousPrompt);

            // Check that the request was made with sanitized input
            expect(axios.post).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    messages: [
                        {
                            role: 'user',
                            content: 'Tell me a joke'
                        }
                    ]
                }),
                expect.any(Object)
            );
        });

        test('should handle API errors gracefully', async () => {
            const apiError = {
                response: {
                    status: 400,
                    data: {
                        error: {
                            type: 'invalid_request_error',
                            message: 'Invalid request'
                        }
                    }
                }
            };

            axios.post.mockRejectedValue(apiError);

            await expect(claudeProvider.generateCompletion('Test prompt')).rejects.toThrow();
        });

        test('should handle invalid API key scenario', async () => {
            const authError = {
                response: {
                    status: 401,
                    data: {
                        error: {
                            type: 'authentication_error',
                            message: 'Invalid API key'
                        }
                    }
                }
            };

            axios.post.mockRejectedValue(authError);

            await expect(claudeProvider.generateCompletion('Test')).rejects.toThrow();
        });

        test('should handle rate limiting responses', async () => {
            const rateLimitError = {
                response: {
                    status: 429,
                    data: {
                        error: {
                            type: 'rate_limit_error',
                            message: 'Rate limit exceeded'
                        }
                    }
                }
            };

            axios.post.mockRejectedValue(rateLimitError);

            await expect(claudeProvider.generateCompletion('Test')).rejects.toThrow();
        });

        test('should handle network timeout scenarios', async () => {
            const timeoutError = new Error('timeout of 30000ms exceeded');
            timeoutError.code = 'ECONNABORTED';

            axios.post.mockRejectedValue(timeoutError);

            await expect(claudeProvider.generateCompletion('Test')).rejects.toThrow();
        });

        test('should handle malformed request errors', async () => {
            const malformedError = {
                response: {
                    status: 400,
                    data: {
                        error: {
                            type: 'invalid_request_error',
                            message: 'Malformed request body'
                        }
                    }
                }
            };

            axios.post.mockRejectedValue(malformedError);

            await expect(claudeProvider.generateCompletion('Test')).rejects.toThrow();
        });

        test('should handle server error responses', async () => {
            const serverError = {
                response: {
                    status: 500,
                    data: {
                        error: {
                            type: 'api_error',
                            message: 'Internal server error'
                        }
                    }
                }
            };

            axios.post.mockRejectedValue(serverError);

            await expect(claudeProvider.generateCompletion('Test')).rejects.toThrow();
        });

        test('should handle overloaded server responses', async () => {
            const overloadedError = {
                response: {
                    status: 529,
                    data: {
                        error: {
                            type: 'overloaded_error',
                            message: 'API is temporarily overloaded'
                        }
                    }
                }
            };

            axios.post.mockRejectedValue(overloadedError);

            await expect(claudeProvider.generateCompletion('Test')).rejects.toThrow();
        });

        test('should include system prompt when provided', async () => {
            const mockResponse = {
                status: 200,
                data: {
                    content: [{ type: 'text', text: 'Response' }],
                    model: 'claude-3-haiku-20240307',
                    usage: { input_tokens: 5, output_tokens: 5 },
                    stop_reason: 'end_turn'
                }
            };

            axios.post.mockResolvedValue(mockResponse);

            await claudeProvider.generateCompletion('Test prompt', {
                systemPrompt: 'You are a helpful assistant.'
            });

            expect(axios.post).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    system: 'You are a helpful assistant.'
                }),
                expect.any(Object)
            );
        });

        test('should respect rate limiting', async () => {
            // Use manual time control for deterministic testing
            jest.useFakeTimers();

            const mockResponse = {
                status: 200,
                data: {
                    content: [{ type: 'text', text: 'response' }],
                    model: 'claude-3-haiku-20240307',
                    usage: { input_tokens: 1, output_tokens: 1 },
                    stop_reason: 'end_turn'
                }
            };

            axios.post.mockResolvedValue(mockResponse);

            // Create a fresh provider with a lower rate limit for testing
            const testProvider = new ClaudeProvider(mockApiKey);

            // Make requests up to the limit (50 requests)
            const initialPromises = [];
            for (let i = 0; i < 50; i++) {
                initialPromises.push(testProvider.generateCompletion('test'));
            }

            // Wait for initial requests to complete
            await Promise.all(initialPromises);

            // The 51st request should trigger rate limit error
            await expect(testProvider.generateCompletion('test')).rejects.toThrow('Rate limit exceeded');

            // Advance time by 61 seconds to reset the rate limit window
            jest.advanceTimersByTime(61000);

            // Now it should work again
            await expect(testProvider.generateCompletion('test')).resolves.toBeDefined();

            jest.useRealTimers();
        });
    });

    describe('calculateCost', () => {
        test('should calculate cost correctly for different models', () => {
            // Test Haiku pricing
            const haikuCost = claudeProvider.calculateCost(1000000, 1000000, 'claude-3-haiku-20240307');
            expect(haikuCost).toBe(1.5); // $0.25 + $1.25

            // Test Sonnet pricing
            const sonnetCost = claudeProvider.calculateCost(1000000, 1000000, 'claude-3-sonnet-20240229');
            expect(sonnetCost).toBe(18); // $3.00 + $15.00

            // Test Opus pricing
            const opusCost = claudeProvider.calculateCost(1000000, 1000000, 'claude-3-opus-20240229');
            expect(opusCost).toBe(90); // $15.00 + $75.00
        });

        test('should handle unknown models with default pricing', () => {
            const unknownModelCost = claudeProvider.calculateCost(1000000, 1000000, 'unknown-model');
            expect(unknownModelCost).toBe(1.5); // Default to Haiku pricing
        });
    });

    describe('getAvailableModels', () => {
        test('should return list of available models', () => {
            const models = claudeProvider.getAvailableModels();
            expect(Array.isArray(models)).toBe(true);
            expect(models).toContain('claude-3-haiku-20240307');
            expect(models).toContain('claude-3-sonnet-20240229');
            expect(models).toContain('claude-3-opus-20240229');
        });
    });

    describe('validateApiKey', () => {
        test('should validate correct API key format', () => {
            expect(claudeProvider.validateApiKey()).toBe(true);
        });

        test('should reject invalid API key formats', () => {
            const invalidProvider1 = new ClaudeProvider('invalid-key');
            const invalidProvider2 = new ClaudeProvider('sk-openai-123');

            expect(invalidProvider1.validateApiKey()).toBe(false);
            expect(invalidProvider2.validateApiKey()).toBe(false);
        });

        test('should validate various API key format scenarios', () => {
            // Valid formats
            expect(new ClaudeProvider('sk-ant-api03-valid-key-12345678901234567890').validateApiKey()).toBe(true);
            expect(new ClaudeProvider('sk-ant-api03-different-format-abcdefghijk').validateApiKey()).toBe(true);

            // Invalid formats - these should be tested by creating providers that skip the constructor validation
            const testInvalidKey = (invalidKey) => {
                const provider = Object.create(ClaudeProvider.prototype);
                provider.apiKey = invalidKey;
                return provider.validateApiKey();
            };

            expect(testInvalidKey('sk-ant-short')).toBe(false);
            expect(testInvalidKey('openai-api-key')).toBe(false);
            expect(testInvalidKey('sk-wrong-prefix-123456789012345678901')).toBe(false);
            expect(testInvalidKey('')).toBe(false);
        });

        test('should handle API key validation with special characters', () => {
            const validKeyWithSpecialChars = 'sk-ant-api03-key_with-dashes_and_underscores123';
            const providerWithSpecialChars = new ClaudeProvider(validKeyWithSpecialChars);
            expect(providerWithSpecialChars.validateApiKey()).toBe(true);
        });

        test('should securely store API key without exposure in errors', () => {
            const provider = new ClaudeProvider('sk-ant-secret-key-12345678901234567890');

            // Test that API key is not exposed in error messages
            const errorMock = {
                status: 401,
                data: {
                    error: {
                        type: 'authentication_error',
                        message: 'Invalid API key'
                    }
                }
            };

            expect(() => provider.handleApiError(errorMock)).toThrow('Authentication failed with Claude API');
            // The error message should not contain the actual API key
            try {
                provider.handleApiError(errorMock);
            } catch (error) {
                expect(error.message).not.toContain('sk-ant-secret-key');
            }
        });
    });

    describe('testConnection', () => {
        test('should return success for valid connection', async () => {
            const mockResponse = {
                status: 200,
                data: {
                    content: [{ type: 'text', text: 'Hi' }],
                    model: 'claude-3-haiku-20240307',
                    usage: { input_tokens: 1, output_tokens: 1 },
                    stop_reason: 'end_turn'
                }
            };

            // Mock with a slight delay to ensure responseTime > 0
            axios.post.mockImplementation(() =>
                new Promise(resolve => setTimeout(() => resolve(mockResponse), 1))
            );

            const result = await claudeProvider.testConnection();

            expect(result.success).toBe(true);
            expect(result).toHaveProperty('model');
            expect(result).toHaveProperty('responseTime');
            expect(typeof result.responseTime).toBe('number');
            expect(result.responseTime).toBeGreaterThanOrEqual(0);
        });

        test('should return failure for connection error', async () => {
            const apiError = new Error('Network error');
            axios.post.mockRejectedValue(apiError);

            const result = await claudeProvider.testConnection();

            expect(result.success).toBe(false);
            expect(result).toHaveProperty('error');
            expect(typeof result.error).toBe('string');
        });

        test('should test connection with performance constraints', async () => {
            const mockResponse = {
                status: 200,
                data: {
                    content: [{ type: 'text', text: 'Hi' }],
                    model: 'claude-3-haiku-20240307',
                    usage: { input_tokens: 1, output_tokens: 1 },
                    stop_reason: 'end_turn'
                }
            };

            // Simulate a slightly delayed response (500ms)
            axios.post.mockImplementation(() =>
                new Promise(resolve => setTimeout(() => resolve(mockResponse), 500))
            );

            const result = await claudeProvider.testConnection();

            expect(result.success).toBe(true);
            // Response should be reasonable but allow for network latency in real scenarios
            expect(result.responseTime).toBeGreaterThan(400);
            expect(result.responseTime).toBeLessThan(1000);
        });

        test('should handle authentication errors in connection test', async () => {
            const authError = {
                response: {
                    status: 401,
                    data: {
                        error: {
                            type: 'authentication_error',
                            message: 'Invalid API key'
                        }
                    }
                }
            };

            axios.post.mockRejectedValue(authError);

            const result = await claudeProvider.testConnection();

            expect(result.success).toBe(false);
            expect(result.error).toContain('Client error occurred');
        });
    });

    describe('handleApiError', () => {
        test('should handle different error types correctly', () => {
            const testCases = [
                {
                    errorType: 'invalid_request_error',
                    expectedMessage: 'Invalid request to Claude API'
                },
                {
                    errorType: 'authentication_error',
                    expectedMessage: 'Authentication failed with Claude API'
                },
                {
                    errorType: 'rate_limit_error',
                    expectedMessage: 'Rate limit exceeded for Claude API'
                }
            ];

            testCases.forEach(({ errorType, expectedMessage }) => {
                const mockResponse = {
                    status: 400,
                    data: {
                        error: {
                            type: errorType,
                            message: 'API error message'
                        }
                    }
                };

                expect(() => claudeProvider.handleApiError(mockResponse)).toThrow(expectedMessage);
            });
        });
    });

    describe('Performance and Memory Tests', () => {
        test('should handle large requests efficiently', async () => {
            const largePrompt = 'A'.repeat(50000); // 50KB prompt
            const mockResponse = {
                status: 200,
                data: {
                    content: [{ type: 'text', text: 'Response to large prompt' }],
                    model: 'claude-3-haiku-20240307',
                    usage: { input_tokens: 12500, output_tokens: 100 },
                    stop_reason: 'end_turn'
                }
            };

            axios.post.mockResolvedValue(mockResponse);

            const startMemory = process.memoryUsage().heapUsed;
            const result = await claudeProvider.generateCompletion(largePrompt);
            const endMemory = process.memoryUsage().heapUsed;

            // Memory usage should not increase dramatically (less than 10MB for this test)
            const memoryIncrease = endMemory - startMemory;
            expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024);

            expect(result.content).toBe('Response to large prompt');
            expect(result.usage.inputTokens).toBe(12500);
        });

        test('should complete requests within reasonable time limits', async () => {
            const mockResponse = {
                status: 200,
                data: {
                    content: [{ type: 'text', text: 'Quick response' }],
                    model: 'claude-3-haiku-20240307',
                    usage: { input_tokens: 5, output_tokens: 5 },
                    stop_reason: 'end_turn'
                }
            };

            axios.post.mockResolvedValue(mockResponse);

            const startTime = Date.now();
            const result = await claudeProvider.generateCompletion('Quick test');
            const duration = Date.now() - startTime;

            // For mocked requests, this should be very fast (under 100ms)
            expect(duration).toBeLessThan(100);
            expect(result.responseTime).toBeLessThan(100);
        });

        test('should handle timeout scenarios gracefully', async () => {
            const timeoutError = new Error('timeout of 30000ms exceeded');
            timeoutError.code = 'ECONNABORTED';

            axios.post.mockRejectedValue(timeoutError);

            const startTime = Date.now();
            await expect(claudeProvider.generateCompletion('Test')).rejects.toThrow();
            const duration = Date.now() - startTime;

            // Should fail quickly for mocked timeout errors
            expect(duration).toBeLessThan(1000);
        });

        test('should validate connection pooling efficiency', async () => {
            const mockResponse = {
                status: 200,
                data: {
                    content: [{ type: 'text', text: 'Response' }],
                    model: 'claude-3-haiku-20240307',
                    usage: { input_tokens: 5, output_tokens: 5 },
                    stop_reason: 'end_turn'
                }
            };

            axios.post.mockResolvedValue(mockResponse);

            // Make multiple sequential requests to test connection efficiency
            const promises = [];
            for (let i = 0; i < 5; i++) {
                promises.push(claudeProvider.generateCompletion(`Test ${i}`));
            }

            const startTime = Date.now();
            const results = await Promise.all(promises);
            const totalDuration = Date.now() - startTime;

            // All requests should complete
            expect(results).toHaveLength(5);
            results.forEach(result => {
                expect(result.content).toBe('Response');
            });

            // Total time should be reasonable for 5 mocked requests
            expect(totalDuration).toBeLessThan(500);
        });
    });
});
