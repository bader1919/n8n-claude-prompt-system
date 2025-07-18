/**
 * Schema Validator Tests
 * Test suite for schema validation functionality
 */

const { SchemaValidator } = require('../core/schema_validator');
const { ValidationError } = require('../core/error_types');

describe('SchemaValidator', () => {
    let validator;

    beforeEach(() => {
        validator = new SchemaValidator();
    });

    describe('Request Validation', () => {
        test('should validate generate request schema', () => {
            const validRequest = {
                template: 'business/email_draft',
                variables: {
                    recipient: 'John Doe',
                    subject: 'Test Subject'
                },
                provider: 'claude',
                options: {
                    maxTokens: 1000,
                    temperature: 0.7
                }
            };

            const result = validator.validate(validRequest, 'generate_request');
            expect(result.valid).toBe(true);
        });

        test('should reject invalid generate request', () => {
            const invalidRequest = {
                // Missing required template field
                variables: {},
                provider: 'invalid-provider'
            };

            expect(() => {
                validator.validate(invalidRequest, 'generate_request');
            }).toThrow(ValidationError);
        });

        test('should validate template names correctly', () => {
            const invalidRequest = {
                template: 'invalid template name!',
                variables: {}
            };

            expect(() => {
                validator.validate(invalidRequest, 'generate_request');
            }).toThrow(ValidationError);
        });
    });

    describe('Response Validation', () => {
        test('should validate generate response schema', () => {
            const validResponse = {
                success: true,
                result: {
                    content: 'Generated content',
                    template: 'business/email_draft',
                    provider: 'claude',
                    usage: {
                        inputTokens: 100,
                        outputTokens: 200,
                        totalTokens: 300
                    },
                    responseTime: 1500,
                    model: 'claude-3-haiku-20240307'
                },
                timestamp: new Date().toISOString()
            };

            const result = validator.validate(validResponse, 'generate_response');
            expect(result.valid).toBe(true);
        });
    });

    describe('Error Response Validation', () => {
        test('should validate error response schema', () => {
            const validError = {
                error: true,
                type: 'validation_error',
                message: 'Invalid input provided',
                code: 'VALIDATION_FAILED',
                timestamp: new Date().toISOString(),
                retryable: false
            };

            const result = validator.validate(validError, 'error_response');
            expect(result.valid).toBe(true);
        });
    });

    describe('Custom Validations', () => {
        test('should validate file uploads', () => {
            const validFile = {
                name: 'test.txt',
                size: 1024,
                mimetype: 'text/plain',
                data: Buffer.from('test content')
            };

            expect(() => {
                validator.validateFileUploads([validFile]);
            }).not.toThrow();
        });

        test('should reject oversized files', () => {
            const oversizedFile = {
                name: 'large.txt',
                size: 20 * 1024 * 1024, // 20MB
                mimetype: 'text/plain'
            };

            expect(() => {
                validator.validateFileUploads([oversizedFile]);
            }).toThrow(ValidationError);
        });

        test('should reject invalid file types', () => {
            const invalidFile = {
                name: 'test.exe',
                size: 1024,
                mimetype: 'application/x-executable'
            };

            expect(() => {
                validator.validateFileUploads([invalidFile]);
            }).toThrow(ValidationError);
        });
    });

    describe('Business Rule Validation', () => {
        test('should validate template request format', () => {
            const validBody = {
                template: 'business/email_draft',
                variables: { recipient: 'test' },
                options: { maxTokens: 1000, temperature: 0.5 }
            };

            expect(() => {
                validator.validateTemplateRequest(validBody);
            }).not.toThrow();
        });

        test('should reject invalid template format', () => {
            const invalidBody = {
                template: 'invalid-format', // Missing category/name format
                variables: {}
            };

            expect(() => {
                validator.validateTemplateRequest(invalidBody);
            }).toThrow(ValidationError);
        });

        test('should validate provider requests', () => {
            const validBody = {
                provider: 'claude',
                options: { model: 'claude-3-haiku-20240307' }
            };

            expect(() => {
                validator.validateProviderRequest(validBody);
            }).not.toThrow();
        });

        test('should reject invalid providers', () => {
            const invalidBody = {
                provider: 'invalid-provider'
            };

            expect(() => {
                validator.validateProviderRequest(invalidBody);
            }).toThrow(ValidationError);
        });
    });

    describe('Input Sanitization', () => {
        test('should sanitize string inputs', () => {
            const maliciousInput = '<script>alert("xss")</script>Hello';
            const sanitized = validator.sanitizeString(maliciousInput);
            
            expect(sanitized).toBe('Hello');
            expect(sanitized).not.toContain('<script>');
        });

        test('should handle javascript: protocol', () => {
            const maliciousInput = 'javascript:alert("xss")';
            const sanitized = validator.sanitizeString(maliciousInput);
            
            expect(sanitized).toBe('alert("xss")'); // javascript: is removed
            expect(sanitized).not.toContain('javascript:');
        });

        test('should sanitize nested objects', () => {
            const input = {
                name: '<script>alert("xss")</script>John',
                details: {
                    message: 'Hello<script>evil()</script>World'
                }
            };

            const schema = {
                type: 'object',
                properties: {
                    name: { type: 'string' },
                    details: {
                        type: 'object',
                        properties: {
                            message: { type: 'string' }
                        }
                    }
                }
            };

            const sanitized = validator.sanitizeData(input, schema);
            
            expect(sanitized.name).toBe('John');
            expect(sanitized.details.message).toBe('HelloWorld');
        });
    });
});