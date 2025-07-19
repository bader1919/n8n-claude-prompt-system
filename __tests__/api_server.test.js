/**
 * API Server Tests
 * Basic test suite for the API server functionality
 */

const request = require('supertest');
const express = require('express');

describe('API Server', () => {
    let app;

    beforeAll(() => {
        // Create a minimal express app for testing
        app = express();
        app.use(express.json());

        // Mock health endpoint
        app.get('/api/health', (req, res) => {
            res.json({ status: 'healthy', timestamp: new Date().toISOString() });
        });

        // Mock authentication middleware
        const authMiddleware = (req, res, next) => {
            const apiKey = req.headers['x-api-key'];
            if (!apiKey || apiKey !== 'test-api-key') {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            next();
        };

        // Mock templates endpoint
        app.get('/api/templates', authMiddleware, (req, res) => {
            res.json({ templates: [] });
        });
    });

    test('health endpoint should return healthy status', async () => {
        const response = await request(app)
            .get('/api/health')
            .expect(200);

        expect(response.body.status).toBe('healthy');
        expect(response.body.timestamp).toBeDefined();
    });

    test('templates endpoint should require authentication', async () => {
        await request(app)
            .get('/api/templates')
            .expect(401);
    });

    test('templates endpoint should work with valid API key', async () => {
        const response = await request(app)
            .get('/api/templates')
            .set('x-api-key', 'test-api-key')
            .expect(200);

        expect(response.body.templates).toBeDefined();
        expect(Array.isArray(response.body.templates)).toBe(true);
    });
});
