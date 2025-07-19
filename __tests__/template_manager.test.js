/**
 * Template Manager Tests
 * Basic test suite for the template management functionality
 */

const TemplateManager = require('../core/template_manager');
const fs = require('fs').promises;
const path = require('path');

describe('TemplateManager', () => {
    let templateManager;
    const testTemplateDir = path.join(__dirname, 'test_templates');
    const testConfigDir = path.join(__dirname, 'test_config');

    beforeEach(async () => {
        // Create test directories
        await fs.mkdir(testTemplateDir, { recursive: true });
        await fs.mkdir(testConfigDir, { recursive: true });

        templateManager = new TemplateManager({
            templateDir: testTemplateDir,
            configDir: testConfigDir,
            scanInterval: 0, // Disable auto-scanning for tests
            autoInit: false // Don't auto-initialize in tests
        });
    });

    afterEach(async () => {
        // Clean up test directories
        try {
            await fs.rm(testTemplateDir, { recursive: true });
            await fs.rm(testConfigDir, { recursive: true });
        } catch (error) {
            // Ignore cleanup errors
        }
    });

    test('should initialize without errors', () => {
        expect(templateManager).toBeDefined();
        expect(templateManager.templateDir).toBe(testTemplateDir);
        expect(templateManager.configDir).toBe(testConfigDir);
    });

    test('should scan templates in directory', async () => {
        // Create a test template
        const templateContent = 'Hello {{name}}, this is a test template.';
        const templatePath = path.join(testTemplateDir, 'test_template.txt');
        await fs.writeFile(templatePath, templateContent);

        // Test template scanning
        const result = await templateManager.scanTemplates();
        expect(result).toBeDefined();
    });

    test('should extract variables from template content', () => {
        const content = 'Hello {{name}}, your order {{order_id}} is ready. Contact {{support_email}} for help.';
        const variables = templateManager.extractVariables(content);

        expect(variables).toEqual(['name', 'order_id', 'support_email']);
    });

    test('should calculate quality scores', () => {
        const content = 'Instructions: Process customer request\nContext: Customer support\nVariable: {{customer_name}}\nOutput: Response';
        const variables = ['customer_name'];

        const score = templateManager.calculateQualityScore(content, variables);
        expect(typeof score).toBe('number');
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
    });
});
