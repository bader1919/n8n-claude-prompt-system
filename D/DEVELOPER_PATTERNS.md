# n8n Claude Prompt System - Developer Guide & Patterns

## Overview
This guide provides common patterns, examples, and best practices for developing with the n8n Claude Prompt System. These patterns help developers understand the expected code structure and improve IDE suggestions.

## Core Concepts

### Template Structure
Templates use double curly brace syntax for variable placeholders:
```
Hello {{customer_name}}, regarding your {{issue_type}}...
```

### Variable Injection Pattern
```javascript
// Standard variable injection
const processedPrompt = templateManager.injectVariables(templateContent, {
    customer_name: 'John Doe',
    issue_type: 'billing inquiry',
    company_name: process.env.COMPANY_NAME
});
```

### n8n Workflow Integration
```javascript
// Common n8n workflow pattern
const variables = {
    customer_name: $json.customer_name,
    issue_description: $json.issue,
    priority_level: $json.priority || 'Medium',
    account_type: $json.account_type,
    company_name: $env.COMPANY_NAME
};
```

## Common Function Patterns

### 1. Create Prompt Template Function
```javascript
/**
 * Create a new prompt template for specific use case
 */
async function createPromptTemplate(templateConfig) {
    const templateManager = new TemplateManager();
    
    return await templateManager.createPromptTemplate({
        name: 'template_name',
        category: 'business_operations',
        content: `You are a professional {{role}} for {{company_name}}.
        
        Context: {{context}}
        Request: {{request}}
        
        Please provide:
        1. Clear solution
        2. Next steps`,
        variables: ['role', 'company_name', 'context', 'request']
    });
}
```

### 2. Process n8n Workflow Data
```javascript
/**
 * Process incoming n8n workflow data
 */
async function processWorkflowData(workflowInput) {
    const templateManager = new TemplateManager();
    const claudeProvider = new ClaudeProvider(process.env.ANTHROPIC_API_KEY);
    
    // Get template
    const template = await templateManager.getTemplate(workflowInput.template_name);
    
    // Inject variables
    const prompt = templateManager.injectVariables(template.content, {
        customer_name: workflowInput.customer_name,
        issue_description: workflowInput.issue,
        priority_level: workflowInput.priority || 'Medium'
    });
    
    // Generate response
    return await claudeProvider.generateCompletion(prompt, {
        temperature: 0.7,
        maxTokens: 1000
    });
}
```

### 3. Customer Support Response Generation
```javascript
/**
 * Generate customer support response
 */
async function generateSupportResponse(customerData, issueData) {
    const templateManager = new TemplateManager();
    const claudeProvider = new ClaudeProvider(process.env.ANTHROPIC_API_KEY);
    
    const template = await templateManager.getTemplate('business_operations/customer_support_template');
    
    const variables = {
        company_name: process.env.COMPANY_NAME,
        customer_context: `${customerData.name} - ${customerData.tier} customer`,
        customer_issue: issueData.description,
        priority_level: issueData.priority,
        account_type: customerData.tier,
        tone: issueData.priority === 'Critical' ? 'urgent' : 'professional'
    };
    
    const prompt = templateManager.injectVariables(template.content, variables);
    
    return await claudeProvider.generateCompletion(prompt, {
        temperature: 0.3, // Lower for consistent support responses
        maxTokens: 800
    });
}
```

### 4. Content Generation Function
```javascript
/**
 * Generate content using Claude AI
 */
async function generateContent(contentType, parameters) {
    const templateManager = new TemplateManager();
    const claudeProvider = new ClaudeProvider(process.env.ANTHROPIC_API_KEY);
    
    const template = await templateManager.getTemplate(`content_creation/${contentType}`);
    
    const prompt = templateManager.injectVariables(template.content, {
        topic: parameters.topic,
        target_audience: parameters.audience,
        tone: parameters.tone || 'professional',
        word_count: parameters.wordCount || '500-800'
    });
    
    return await claudeProvider.generateCompletion(prompt, {
        model: 'claude-3-sonnet-20240229',
        temperature: 0.8, // Higher for creative content
        maxTokens: 2000
    });
}
```

### 5. Template Validation Function
```javascript
/**
 * Validate template variables before processing
 */
function validateTemplateVariables(template, providedVariables) {
    const requiredVariables = template.variables || [];
    const missing = requiredVariables.filter(variable => 
        !(variable in providedVariables) || 
        providedVariables[variable] === null || 
        providedVariables[variable] === undefined
    );
    
    if (missing.length > 0) {
        throw new ValidationError(`Missing required variables: ${missing.join(', ')}`);
    }
    
    return {
        valid: true,
        requiredVariables,
        providedVariables: Object.keys(providedVariables)
    };
}
```

## API Integration Patterns

### n8n HTTP Request Node Configuration
```javascript
// POST /api/generate
const requestConfig = {
    method: 'POST',
    url: 'http://localhost:3000/api/generate',
    headers: {
        'x-api-key': process.env.API_KEY,
        'Content-Type': 'application/json'
    },
    data: {
        template: 'business_operations/customer_support_template',
        variables: {
            company_name: $env.COMPANY_NAME,
            customer_name: $json.customer_name,
            customer_issue: $json.issue_description,
            priority_level: $json.priority || 'Medium'
        },
        options: {
            temperature: 0.3,
            maxTokens: 800
        }
    }
};
```

### Express Route Handler Pattern
```javascript
/**
 * Express route handler for template processing
 */
app.post('/api/generate', async (req, res, next) => {
    try {
        const { template, variables, options } = req.body;
        
        // Get template
        const templateData = await templateManager.getTemplate(template);
        
        // Process variables
        const prompt = templateManager.injectVariables(templateData.content, variables);
        
        // Generate response
        const result = await claudeProvider.generateCompletion(prompt, options);
        
        res.json({
            success: true,
            result: result.content,
            usage: result.usage
        });
    } catch (error) {
        next(error);
    }
});
```

## Variable Types and Patterns

### Standard Variables
```javascript
const commonVariables = {
    // Customer information
    customer_name: 'John Doe',
    customer_tier: 'Premium',
    account_type: 'Business',
    
    // Issue details
    issue_description: 'Cannot access premium features',
    issue_category: 'Technical',
    priority_level: 'High',
    
    // Company information
    company_name: process.env.COMPANY_NAME,
    support_email: process.env.SUPPORT_EMAIL,
    
    // Response configuration
    tone: 'professional',
    response_time: '24 hours'
};
```

### n8n Environment Variables
```javascript
// Common n8n environment variable patterns
const environmentVariables = {
    company_name: $env.COMPANY_NAME,
    api_url: $env.API_BASE_URL,
    support_email: $env.SUPPORT_EMAIL,
    department: $env.DEPARTMENT || 'Customer Service'
};
```

### Workflow Data Extraction
```javascript
// Extract data from n8n workflow context
const workflowVariables = {
    customer_name: $json.customer?.name || $json.customer_name,
    issue: $json.ticket?.description || $json.issue_description,
    priority: $json.metadata?.priority || 'Medium',
    source: $json.source || 'web'
};
```

## Error Handling Patterns

### Template Not Found
```javascript
async function safeGetTemplate(templateKey) {
    const template = await templateManager.getTemplate(templateKey);
    if (!template) {
        throw new Error(`Template not found: ${templateKey}`);
    }
    return template;
}
```

### Variable Validation
```javascript
function validateRequiredVariables(variables, required) {
    const missing = required.filter(key => 
        !variables.hasOwnProperty(key) || 
        variables[key] === null || 
        variables[key] === undefined
    );
    
    if (missing.length > 0) {
        throw new ValidationError(`Missing required variables: ${missing.join(', ')}`);
    }
}
```

## Performance Optimization Patterns

### Template Caching
```javascript
class OptimizedTemplateManager extends TemplateManager {
    constructor() {
        super();
        this.templateCache = new Map();
        this.cacheTimeout = 1000 * 60 * 60; // 1 hour
    }
    
    async getCachedTemplate(templateKey) {
        const cached = this.templateCache.get(templateKey);
        if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
            return cached.template;
        }
        
        const template = await this.getTemplate(templateKey);
        this.templateCache.set(templateKey, {
            template,
            timestamp: Date.now()
        });
        
        return template;
    }
}
```

## Testing Patterns

### Template Testing
```javascript
describe('Template Processing', () => {
    test('should inject variables correctly', async () => {
        const templateManager = new TemplateManager();
        const template = 'Hello {{name}}, your {{type}} account is {{status}}';
        const variables = { name: 'John', type: 'Premium', status: 'active' };
        
        const result = templateManager.injectVariables(template, variables);
        expect(result).toBe('Hello John, your Premium account is active');
    });
});
```

### API Endpoint Testing
```javascript
describe('API Generation Endpoint', () => {
    test('should generate completion successfully', async () => {
        const response = await request(app)
            .post('/api/generate')
            .set('x-api-key', 'test-key')
            .send({
                template: 'test/simple_template',
                variables: { name: 'Test User' },
                options: { temperature: 0.5 }
            });
            
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.result).toBeDefined();
    });
});
```

This documentation helps developers understand the expected patterns and improves IDE autocompletion and suggestions.
