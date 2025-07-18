/**
 * Error Handler Tests
 * Test suite for error handling and input validation functionality
 */

const { ErrorHandler, ValidationError, AuthenticationError } = require('../core/error_handler');

// Mock console methods to avoid noise during testing
const originalConsoleError = console.error;
beforeAll(() => {
    console.error = jest.fn();
});

afterAll(() => {
    console.error = originalConsoleError;
});

describe('ErrorHandler', () => {
    let errorHandler;

    beforeEach(() => {
        errorHandler = new ErrorHandler({
            logLevel: 'error',
            includeStackTrace: false,
            sanitizeErrors: true
        });
    });

    describe('sanitizeInput', () => {
        test('should remove script tags', () => {
            const maliciousInput = '<script>alert("xss")</script>Hello World';
            const result = errorHandler.sanitizeInput(maliciousInput);
            expect(result).toBe('Hello World');
        });

        test('should remove javascript: protocols', () => {
            const maliciousInput = 'javascript:alert("xss")';
            const result = errorHandler.sanitizeInput(maliciousInput);
            expect(result).toBe('');
        });

        test('should handle non-string inputs', () => {
            expect(errorHandler.sanitizeInput(123)).toBe(123);
            expect(errorHandler.sanitizeInput(null)).toBe(null);
            expect(errorHandler.sanitizeInput(undefined)).toBe(undefined);
        });

        test('should preserve safe content', () => {
            const safeInput = 'This is a safe input string with numbers 123';
            const result = errorHandler.sanitizeInput(safeInput);
            expect(result).toBe(safeInput);
        });
    });

    describe('validateTemplateVariables', () => {
        test('should validate correct variables', () => {
            const variables = {
                customer_name: 'John Doe',
                issue_description: 'Login problem',
                urgency_level: 'high'
            };
            const errors = errorHandler.validateTemplateVariables(variables);
            expect(errors).toHaveLength(0);
        });

        test('should reject invalid variable names', () => {
            const variables = {
                '123invalid': 'value',
                'valid_name': 'value'
            };
            const errors = errorHandler.validateTemplateVariables(variables);
            expect(errors).toHaveLength(1);
            expect(errors[0]).toContain('Invalid variable name: 123invalid');
        });

        test('should reject variables that are too long', () => {
            const variables = {
                long_variable: 'x'.repeat(10001)
            };
            const errors = errorHandler.validateTemplateVariables(variables);
            expect(errors).toHaveLength(1);
            expect(errors[0]).toContain('exceeds maximum length');
        });

        test('should handle non-object input', () => {
            const errors = errorHandler.validateTemplateVariables('not an object');
            expect(errors).toHaveLength(1);
            expect(errors[0]).toBe('Variables must be a valid object');
        });
    });

    describe('containsSuspiciousPatterns', () => {
        test('should detect suspicious eval patterns', () => {
            const suspiciousText = '{{eval("malicious code")}}';
            const result = errorHandler.containsSuspiciousPatterns(suspiciousText);
            expect(result).toBe(true);
        });

        test('should detect suspicious function patterns', () => {
            const suspiciousText = '{{function() { return "bad"; }}}';
            const result = errorHandler.containsSuspiciousPatterns(suspiciousText);
            expect(result).toBe(true);
        });

        test('should allow safe template patterns', () => {
            const safeText = '{{customer_name}} and {{issue_description}}';
            const result = errorHandler.containsSuspiciousPatterns(safeText);
            expect(result).toBe(false);
        });
    });

    describe('handleError', () => {
        test('should generate error ID and timestamp', () => {
            const error = new Error('Test error');
            const result = errorHandler.handleError(error);

            expect(result).toHaveProperty('errorId');
            expect(result).toHaveProperty('timestamp');
            expect(result.error).toBe(true);
        });

        test('should sanitize validation errors', () => {
            const error = new ValidationError('Validation failed');
            const result = errorHandler.handleError(error);

            expect(result.message).toBe('Invalid input provided');
            expect(result.type).toBe('validation_error');
        });

        test('should sanitize authentication errors', () => {
            const error = new AuthenticationError('Invalid credentials');
            const result = errorHandler.handleError(error);

            expect(result.message).toBe('Authentication failed');
            expect(result.type).toBe('auth_error');
        });

        test('should handle unknown errors', () => {
            const error = new Error('Unknown error');
            const result = errorHandler.handleError(error);

            expect(result.message).toBe('An internal error occurred');
            expect(result.type).toBe('internal_error');
        });
    });

    describe('sanitizeRequestBody', () => {
        test('should recursively sanitize nested objects', () => {
            const body = {
                template: 'test',
                variables: {
                    name: '<script>alert("xss")</script>John',
                    description: 'Safe content'
                },
                options: {
                    nested: {
                        value: 'javascript:alert("bad")'
                    }
                }
            };

            const result = errorHandler.sanitizeRequestBody(body);

            expect(result.variables.name).toBe('John');
            expect(result.variables.description).toBe('Safe content');
            expect(result.options.nested.value).toBe('');
        });

        test('should handle arrays', () => {
            const body = {
                items: ['<script>bad</script>good', 'safe item']
            };

            const result = errorHandler.sanitizeRequestBody(body);

            expect(result.items[0]).toBe('good');
            expect(result.items[1]).toBe('safe item');
        });
    });

    describe('generateErrorId', () => {
        test('should generate unique error IDs', () => {
            const id1 = errorHandler.generateErrorId();
            const id2 = errorHandler.generateErrorId();

            expect(id1).not.toBe(id2);
            expect(id1).toMatch(/^err_\d+_[a-z0-9]+$/);
            expect(id2).toMatch(/^err_\d+_[a-z0-9]+$/);
        });
    });
});

describe('Custom Error Classes', () => {
    test('ValidationError should set correct properties', () => {
        const details = ['Field is required', 'Invalid format'];
        const error = new ValidationError('Validation failed', details);

        expect(error.name).toBe('ValidationError');
        expect(error.message).toBe('Validation failed');
        expect(error.details).toEqual(details);
    });

    test('AuthenticationError should set correct properties', () => {
        const error = new AuthenticationError('Invalid API key');

        expect(error.name).toBe('AuthenticationError');
        expect(error.message).toBe('Invalid API key');
    });
});
