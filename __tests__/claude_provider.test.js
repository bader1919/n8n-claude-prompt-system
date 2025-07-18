/**
 * Claude Provider Tests
 * Test suite for Claude provider functionality and security
 */

const ClaudeProvider = require('../providers/claude_provider');
const { ValidationError } = require('../core/error_types');

// Mock axios to avoid making real API calls
jest.mock('axios');
const axios = require('axios');

describe('ClaudeProvider', () => {
    let claudeProvider;
    const mockApiKey = 'sk-ant-test-api-key-123456789';

    beforeEach(() => {
        claudeProvider = new ClaudeProvider(mockApiKey);
        axios.post.mockClear();
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

            axios.post.mockResolvedValue(mockResponse);

            const result = await claudeProvider.generateCompletion('Hello, how are you?');

            expect(result).toHaveProperty('content', 'Hello! This is a test response.');
            expect(result).toHaveProperty('model', 'claude-3-haiku-20240307');
            expect(result).toHaveProperty('usage');
            expect(result.usage.totalTokens).toBe(18);
            expect(result).toHaveProperty('cost');
            expect(result).toHaveProperty('responseTime');
        });

        test('should validate input prompt', async () => {
            await expect(claudeProvider.generateCompletion('')).rejects.toThrow(ValidationError);
            await expect(claudeProvider.generateCompletion(null)).rejects.toThrow(ValidationError);
            await expect(claudeProvider.generateCompletion('  ')).rejects.toThrow(ValidationError);
        });

        test('should reject prompts that are too long', async () => {
            const longPrompt = 'x'.repeat(200001);
            await expect(claudeProvider.generateCompletion(longPrompt)).rejects.toThrow(ValidationError);
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
            // Test rate limiting by making multiple requests quickly
            const promises = [];
            for (let i = 0; i < 60; i++) {
                promises.push(claudeProvider.generateCompletion('test').catch(err => err));
            }

            const results = await Promise.all(promises);
            const rateLimitErrors = results.filter(result =>
                result instanceof Error && result.name === 'RateLimitError'
            );

            expect(rateLimitErrors.length).toBeGreaterThan(0);
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

            axios.post.mockResolvedValue(mockResponse);

            const result = await claudeProvider.testConnection();

            expect(result.success).toBe(true);
            expect(result).toHaveProperty('model');
            expect(result).toHaveProperty('responseTime');
        });

        test('should return failure for connection error', async () => {
            const apiError = new Error('Network error');
            axios.post.mockRejectedValue(apiError);

            const result = await claudeProvider.testConnection();

            expect(result.success).toBe(false);
            expect(result).toHaveProperty('error');
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
});
