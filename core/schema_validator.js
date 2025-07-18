/**
 * Schema Validation System
 * Part of the n8n Claude Prompt System
 *
 * Features:
 * - JSON Schema validation for requests and responses
 * - Custom validation rules and sanitization
 * - File upload validation
 * - Multipart data handling
 *
 * @author Bader Abdulrahim
 * @version 1.0.0
 */

const { Validator } = require('jsonschema');
const fs = require('fs');
const path = require('path');
const { ValidationError } = require('./error_types');

class SchemaValidator {
    constructor() {
        this.validator = new Validator();
        this.schemas = new Map();
        this.loadSchemas();
    }

    /**
     * Load all JSON schemas from the schemas directory
     */
    loadSchemas() {
        try {
            const schemasDir = path.join(__dirname, '..', 'schemas');
            const schemaFiles = fs.readdirSync(schemasDir).filter(file => file.endsWith('.json'));

            for (const file of schemaFiles) {
                const schemaPath = path.join(schemasDir, file);
                const schemaName = path.basename(file, '.json');
                
                try {
                    const schemaContent = fs.readFileSync(schemaPath, 'utf8');
                    const schema = JSON.parse(schemaContent);
                    this.schemas.set(schemaName, schema);
                    
                    // Add to validator instance for $ref support
                    if (schema.$id || schema.id) {
                        this.validator.addSchema(schema, schema.$id || schema.id);
                    }
                } catch (error) {
                    console.error(`Failed to load schema ${file}:`, error.message);
                }
            }

            console.log(`Loaded ${this.schemas.size} validation schemas`);
        } catch (error) {
            console.error('Failed to load schemas directory:', error.message);
        }
    }

    /**
     * Validate data against a named schema
     */
    validate(data, schemaName, options = {}) {
        const schema = this.schemas.get(schemaName);
        if (!schema) {
            throw new ValidationError(`Schema '${schemaName}' not found`);
        }

        return this.validateAgainstSchema(data, schema, options);
    }

    /**
     * Validate data against a schema object
     */
    validateAgainstSchema(data, schema, options = {}) {
        const result = this.validator.validate(data, schema);
        
        if (!result.valid) {
            const errors = result.errors.map(error => {
                let message = `${error.property}: ${error.message}`;
                if (error.value !== undefined) {
                    message += ` (received: ${JSON.stringify(error.value)})`;
                }
                return message;
            });

            throw new ValidationError(
                `Validation failed: ${errors.join(', ')}`,
                errors,
                {
                    code: 'SCHEMA_VALIDATION_FAILED',
                    context: {
                        schemaTitle: schema.title || 'Unknown',
                        errorCount: errors.length
                    }
                }
            );
        }

        return {
            valid: true,
            data: options.sanitize ? this.sanitizeData(data, schema) : data
        };
    }

    /**
     * Validate API request based on endpoint
     */
    validateApiRequest(req, res, next) {
        try {
            const schemaName = this.getSchemaNameForEndpoint(req.path, req.method);
            
            if (schemaName) {
                const validation = this.validate(req.body, schemaName, { sanitize: true });
                req.body = validation.data;
            }

            // Additional custom validations
            this.performCustomValidations(req);
            
            next();
        } catch (error) {
            next(error);
        }
    }

    /**
     * Get schema name based on endpoint and method
     */
    getSchemaNameForEndpoint(path, method) {
        const routeMap = {
            'POST /api/generate': 'generate_request',
            'POST /api/templates': 'template_schema',
            'PUT /api/templates': 'template_schema'
        };

        const key = `${method} ${path}`;
        return routeMap[key] || null;
    }

    /**
     * Perform custom validations beyond schema
     */
    performCustomValidations(req) {
        // Validate file uploads
        if (req.files) {
            this.validateFileUploads(req.files);
        }

        // Validate multipart data
        if (req.headers['content-type']?.includes('multipart/form-data')) {
            this.validateMultipartData(req);
        }

        // Validate request size
        this.validateRequestSize(req);

        // Custom business logic validations
        this.validateBusinessRules(req);
    }

    /**
     * Validate file uploads
     */
    validateFileUploads(files) {
        const allowedMimeTypes = [
            'text/plain',
            'application/json',
            'text/markdown',
            'application/pdf'
        ];
        
        const maxFileSize = 10 * 1024 * 1024; // 10MB
        const maxFiles = 5;

        const fileArray = Array.isArray(files) ? files : [files];
        
        if (fileArray.length > maxFiles) {
            throw new ValidationError(`Too many files. Maximum ${maxFiles} files allowed.`);
        }

        for (const file of fileArray) {
            // Check file size
            if (file.size > maxFileSize) {
                throw new ValidationError(`File ${file.name} exceeds maximum size of ${maxFileSize / 1024 / 1024}MB`);
            }

            // Check MIME type
            if (!allowedMimeTypes.includes(file.mimetype)) {
                throw new ValidationError(`File type ${file.mimetype} not allowed for file ${file.name}`);
            }

            // Check file name
            if (!/^[a-zA-Z0-9._-]+$/.test(file.name)) {
                throw new ValidationError(`Invalid file name: ${file.name}. Only alphanumeric characters, dots, underscores, and hyphens allowed.`);
            }

            // Scan for malicious content
            this.scanFileContent(file);
        }
    }

    /**
     * Scan file content for malicious patterns
     */
    scanFileContent(file) {
        const maliciousPatterns = [
            /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
            /eval\s*\(/gi,
            /Function\s*\(/gi,
            /javascript:/gi,
            /on\w+\s*=/gi
        ];

        // Only scan text files
        if (file.mimetype.startsWith('text/')) {
            const content = file.data.toString();
            
            for (const pattern of maliciousPatterns) {
                if (pattern.test(content)) {
                    throw new ValidationError(`File ${file.name} contains potentially malicious content`);
                }
            }
        }
    }

    /**
     * Validate multipart form data
     */
    validateMultipartData(req) {
        const maxFields = 20;
        const maxFieldSize = 1024 * 1024; // 1MB per field

        if (req.body && typeof req.body === 'object') {
            const fieldCount = Object.keys(req.body).length;
            
            if (fieldCount > maxFields) {
                throw new ValidationError(`Too many form fields. Maximum ${maxFields} fields allowed.`);
            }

            for (const [key, value] of Object.entries(req.body)) {
                if (typeof value === 'string' && value.length > maxFieldSize) {
                    throw new ValidationError(`Field ${key} exceeds maximum size of ${maxFieldSize / 1024}KB`);
                }
            }
        }
    }

    /**
     * Validate request size
     */
    validateRequestSize(req) {
        const maxRequestSize = 50 * 1024 * 1024; // 50MB
        
        if (req.headers['content-length']) {
            const contentLength = parseInt(req.headers['content-length']);
            
            if (contentLength > maxRequestSize) {
                throw new ValidationError(`Request too large. Maximum size is ${maxRequestSize / 1024 / 1024}MB`);
            }
        }
    }

    /**
     * Validate business rules
     */
    validateBusinessRules(req) {
        // Template-specific validations
        if (req.path.includes('/generate') && req.body.template) {
            this.validateTemplateRequest(req.body);
        }

        // Provider-specific validations
        if (req.body.provider) {
            this.validateProviderRequest(req.body);
        }
    }

    /**
     * Validate template generation request
     */
    validateTemplateRequest(body) {
        const { template, variables = {}, options = {} } = body;

        // Validate template name format
        if (!/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/.test(template)) {
            throw new ValidationError('Template name must be in format "category/name"');
        }

        // Validate variable count and content
        const variableCount = Object.keys(variables).length;
        if (variableCount > 50) {
            throw new ValidationError('Too many variables. Maximum 50 variables allowed.');
        }

        // Validate options
        if (options.maxTokens && (options.maxTokens < 1 || options.maxTokens > 8192)) {
            throw new ValidationError('maxTokens must be between 1 and 8192');
        }

        if (options.temperature && (options.temperature < 0 || options.temperature > 1)) {
            throw new ValidationError('temperature must be between 0 and 1');
        }
    }

    /**
     * Validate provider request
     */
    validateProviderRequest(body) {
        const { provider, options = {} } = body;
        
        const allowedProviders = ['claude', 'openai', 'local'];
        if (!allowedProviders.includes(provider)) {
            throw new ValidationError(`Invalid provider. Allowed providers: ${allowedProviders.join(', ')}`);
        }

        // Provider-specific validations
        if (provider === 'claude' && options.model) {
            const allowedModels = [
                'claude-3-opus-20240229',
                'claude-3-sonnet-20240229',
                'claude-3-haiku-20240307',
                'claude-3-5-sonnet-20241022'
            ];
            
            if (!allowedModels.includes(options.model)) {
                throw new ValidationError(`Invalid Claude model. Allowed models: ${allowedModels.join(', ')}`);
            }
        }
    }

    /**
     * Sanitize data based on schema
     */
    sanitizeData(data, schema) {
        if (!data || typeof data !== 'object') {
            return data;
        }

        const sanitized = Array.isArray(data) ? [] : {};

        for (const [key, value] of Object.entries(data)) {
            const property = schema.properties?.[key];
            
            if (property) {
                if (property.type === 'string' && typeof value === 'string') {
                    // Sanitize string values
                    sanitized[key] = this.sanitizeString(value);
                } else if (property.type === 'object' && typeof value === 'object') {
                    // Recursively sanitize objects
                    sanitized[key] = this.sanitizeData(value, property);
                } else {
                    sanitized[key] = value;
                }
            } else {
                // Property not in schema - keep as is for now
                sanitized[key] = value;
            }
        }

        return sanitized;
    }

    /**
     * Sanitize string values
     */
    sanitizeString(str) {
        if (typeof str !== 'string') {
            return str;
        }

        // Remove potential XSS patterns
        return str
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/on\w+\s*=/gi, '')
            .replace(/javascript:/gi, '')
            .replace(/eval\s*\(/gi, '')
            .replace(/Function\s*\(/gi, '')
            .trim();
    }

    /**
     * Validate response before sending
     */
    validateResponse(data, schemaName) {
        try {
            return this.validate(data, schemaName);
        } catch (error) {
            console.error(`Response validation failed for schema ${schemaName}:`, error.message);
            // Don't throw error for response validation to avoid breaking the response
            return { valid: false, error: error.message };
        }
    }

    /**
     * Get validation middleware for Express
     */
    getValidationMiddleware() {
        return this.validateApiRequest.bind(this);
    }
}

// Global schema validator instance
const globalSchemaValidator = new SchemaValidator();

module.exports = {
    SchemaValidator,
    schemaValidator: globalSchemaValidator
};