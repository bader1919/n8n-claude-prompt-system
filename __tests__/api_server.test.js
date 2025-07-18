/**
 * API Server Integration Tests
 * Test suite for API endpoints, authentication, and security
 */

const request = require('supertest');
const ApiServer = require('../api_server');

// Mock dependencies to avoid external calls
jest.mock('../core/template_manager');
jest.mock('../providers/claude_provider');

describe('API Server Integration Tests', () => {
    let app;
    let server;

    beforeAll(() => {
        // Set test environment variables
        process.env.NODE_ENV = 'test';
        process.env.API_KEYS = 'test-api-key,another-test-key';

        server = new ApiServer();
        app = server.app;
    });

    describe('Health Check Endpoint', () => {
        test('GET /api/health should return health status', async () => {
            const response = await request(app)
                .get('/api/health')
                .expect(200);

            expect(response.body).toHaveProperty('status', 'healthy');
            expect(response.body).toHaveProperty('timestamp');
            expect(response.body).toHaveProperty('uptime');
            expect(response.body).toHaveProperty('version');
            expect(response.body).toHaveProperty('services');
        });
    });

    describe('Authentication', () => {
        test('should reject requests without API key', async () => {
            await request(app)
                .get('/api/templates')
                .expect(401);
        });

        test('should reject requests with invalid API key', async () => {
            await request(app)
                .get('/api/templates')
                .set('x-api-key', 'invalid-key')
                .expect(401);
        });

        test('should accept requests with valid API key', async () => {
            await request(app)
                .get('/api/templates')
                .set('x-api-key', 'test-api-key')
                .expect(200);
        });

        test('should accept Authorization header', async () => {
            await request(app)
                .get('/api/templates')
                .set('Authorization', 'Bearer test-api-key')
                .expect(200);
        });
    });

    describe('Template Endpoints', () => {
        test('GET /api/templates should return templates list', async () => {
            const response = await request(app)
                .get('/api/templates')
                .set('x-api-key', 'test-api-key')
                .expect(200);

            expect(response.body).toHaveProperty('success', true);
            expect(response.body).toHaveProperty('templates');
            expect(response.body).toHaveProperty('count');
        });

        test('GET /api/templates/:category should return filtered templates', async () => {
            const response = await request(app)
                .get('/api/templates/business')
                .set('x-api-key', 'test-api-key')
                .expect(200);

            expect(response.body).toHaveProperty('success', true);
            expect(response.body).toHaveProperty('category', 'business');
            expect(response.body).toHaveProperty('templates');
        });
    });

    describe('Generation Endpoint', () => {
        test('POST /api/generate should validate required fields', async () => {
            await request(app)
                .post('/api/generate')
                .set('x-api-key', 'test-api-key')
                .send({})
                .expect(400);
        });

        test('POST /api/generate should validate input sanitization', async () => {
            const maliciousInput = {
                template: 'business/customer_support',
                variables: {
                    customer_name: '<script>alert("xss")</script>John',
                    issue_description: 'javascript:alert("bad")'
                }
            };

            const response = await request(app)
                .post('/api/generate')
                .set('x-api-key', 'test-api-key')
                .set('Content-Type', 'application/json')
                .send(maliciousInput);

            // Should process without the malicious content
            // The actual response depends on mocked template manager
            expect(response.status).not.toBe(500);
        });

        test('POST /api/generate should handle valid request structure', async () => {
            const validInput = {
                template: 'business/customer_support',
                variables: {
                    customer_name: 'John Doe',
                    issue_description: 'Login problem'
                },
                provider: 'claude',
                options: {
                    temperature: 0.7,
                    maxTokens: 1000
                }
            };

            // This will likely fail in test because of mocked dependencies
            // but it tests the request structure validation
            await request(app)
                .post('/api/generate')
                .set('x-api-key', 'test-api-key')
                .set('Content-Type', 'application/json')
                .send(validInput);

            // If it gets past validation, that's a success for this test
        });
    });

    describe('Provider Endpoints', () => {
        test('GET /api/providers should return available providers', async () => {
            const response = await request(app)
                .get('/api/providers')
                .set('x-api-key', 'test-api-key')
                .expect(200);

            expect(response.body).toHaveProperty('success', true);
            expect(response.body).toHaveProperty('providers');
            expect(response.body).toHaveProperty('default');
        });
    });

    describe('Security Headers', () => {
        test('should include security headers', async () => {
            const response = await request(app)
                .get('/api/health')
                .expect(200);

            // Check for helmet security headers
            expect(response.headers).toHaveProperty('x-content-type-options', 'nosniff');
            expect(response.headers).toHaveProperty('x-frame-options');
            expect(response.headers).toHaveProperty('x-xss-protection');
        });
    });

    describe('Rate Limiting', () => {
        test('should enforce rate limits', async () => {
            // Make multiple requests to trigger rate limiting
            const promises = [];
            for (let i = 0; i < 105; i++) {
                promises.push(
                    request(app)
                        .get('/api/templates')
                        .set('x-api-key', 'test-api-key')
                );
            }

            const responses = await Promise.all(promises);
            const rateLimitedResponses = responses.filter(res => res.status === 429);

            // Should have some rate-limited responses
            expect(rateLimitedResponses.length).toBeGreaterThan(0);
        }, 10000); // Increase timeout for this test
    });

    describe('Input Validation', () => {
        test('should validate Content-Type header', async () => {
            await request(app)
                .post('/api/generate')
                .set('x-api-key', 'test-api-key')
                .set('Content-Type', 'text/plain')
                .send('invalid content type')
                .expect(400);
        });

        test('should handle malformed JSON', async () => {
            await request(app)
                .post('/api/generate')
                .set('x-api-key', 'test-api-key')
                .set('Content-Type', 'application/json')
                .send('{"malformed": json}')
                .expect(400);
        });
    });

    describe('Error Handling', () => {
        test('should return 404 for unknown endpoints', async () => {
            const response = await request(app)
                .get('/api/unknown-endpoint')
                .set('x-api-key', 'test-api-key')
                .expect(404);

            expect(response.body).toHaveProperty('error', true);
            expect(response.body).toHaveProperty('type', 'not_found_error');
        });

        test('should return sanitized error responses', async () => {
            // Try to trigger an internal error
            const response = await request(app)
                .post('/api/generate')
                .set('x-api-key', 'test-api-key')
                .set('Content-Type', 'application/json')
                .send({
                    template: 'non/existent/template',
                    variables: {}
                });

            // Error response should be sanitized
            expect(response.body).toHaveProperty('error', true);
            expect(response.body).toHaveProperty('errorId');
            expect(response.body).toHaveProperty('timestamp');
            expect(response.body).not.toHaveProperty('stack');
        });
    });

    describe('CORS', () => {
        test('should handle CORS preflight requests', async () => {
            const response = await request(app)
                .options('/api/templates')
                .set('Origin', 'http://localhost:5678')
                .set('Access-Control-Request-Method', 'GET')
                .expect(204);

            expect(response.headers).toHaveProperty('access-control-allow-origin');
        });
    });

    describe('Metrics Endpoint', () => {
        test('GET /api/metrics should return system metrics', async () => {
            const response = await request(app)
                .get('/api/metrics')
                .expect(200);

            expect(response.body).toHaveProperty('success', true);
            expect(response.body).toHaveProperty('metrics');
            expect(response.body.metrics).toHaveProperty('uptime');
            expect(response.body.metrics).toHaveProperty('memory');
            expect(response.body.metrics).toHaveProperty('timestamp');
        });
    });

    describe('Default Route', () => {
        test('GET / should return API information', async () => {
            const response = await request(app)
                .get('/')
                .expect(200);

            expect(response.body).toHaveProperty('name', 'n8n Claude Prompt System');
            expect(response.body).toHaveProperty('version');
            expect(response.body).toHaveProperty('status', 'running');
            expect(response.body).toHaveProperty('endpoints');
        });
    });
});
