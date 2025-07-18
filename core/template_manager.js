/**
 * Template Discovery and Management System
 * Handles automatic template discovery, caching, and version management
 */
class TemplateManager {
    constructor(config = {}) {
        this.baseUrl = config.baseUrl || 'https://raw.githubusercontent.com/bader1919/n8n-claude-prompt-system/main';
        this.cache = new Map();
        this.cacheTimeout = config.cacheTimeout || 300000; // 5 minutes
        this.enableCache = config.enableCache !== false;
        this.autoDiscovery = config.autoDiscovery !== false;
        this.categories = ['business_operations', 'content_creation', 'technical', 'analytics'];
    }

    /**
     * Discover all available templates
     * @returns {Promise<Object>} - Map of templates by category
     */
    async discoverTemplates() {
        const cacheKey = 'template_discovery';
        
        if (this.enableCache && this._getCachedData(cacheKey)) {
            return this._getCachedData(cacheKey);
        }

        try {
            const templates = {};
            
            for (const category of this.categories) {
                templates[category] = await this._discoverCategoryTemplates(category);
            }

            if (this.enableCache) {
                this._setCachedData(cacheKey, templates);
            }

            return templates;
        } catch (error) {
            throw new Error(`Template discovery failed: ${error.message}`);
        }
    }

    /**
     * Get a specific template with version support
     * @param {string} templateName - Name of the template
     * @param {string} category - Template category
     * @param {string} version - Template version (optional)
     * @returns {Promise<Object>} - Template data with metadata
     */
    async getTemplate(templateName, category, version = 'latest') {
        const cacheKey = `template_${category}_${templateName}_${version}`;
        
        if (this.enableCache && this._getCachedData(cacheKey)) {
            return this._getCachedData(cacheKey);
        }

        try {
            const templateData = await this._fetchTemplate(templateName, category, version);
            
            if (this.enableCache) {
                this._setCachedData(cacheKey, templateData);
            }

            return templateData;
        } catch (error) {
            throw new Error(`Failed to get template ${templateName}: ${error.message}`);
        }
    }

    /**
     * Get template metadata and available versions
     * @param {string} templateName - Name of the template
     * @param {string} category - Template category
     * @returns {Promise<Object>} - Template metadata
     */
    async getTemplateMetadata(templateName, category) {
        try {
            const metadataUrl = `${this.baseUrl}/templates/${category}/${templateName}_metadata.json`;
            const response = await fetch(metadataUrl);
            
            if (response.ok) {
                return await response.json();
            } else {
                // Return default metadata if no metadata file exists
                return this._generateDefaultMetadata(templateName, category);
            }
        } catch (error) {
            return this._generateDefaultMetadata(templateName, category);
        }
    }

    /**
     * Validate template format and variables
     * @param {string} templateContent - Template content
     * @param {Object} variables - Variables to inject
     * @returns {Object} - Validation result
     */
    validateTemplate(templateContent, variables = {}) {
        const validation = {
            isValid: true,
            errors: [],
            warnings: [],
            requiredVariables: [],
            missingVariables: [],
            unusedVariables: []
        };

        try {
            // Extract variables from template
            const variablePattern = /\{\{(\w+)\}\}/g;
            const foundVariables = new Set();
            let match;

            while ((match = variablePattern.exec(templateContent)) !== null) {
                foundVariables.add(match[1]);
            }

            validation.requiredVariables = Array.from(foundVariables);

            // Check for missing variables
            for (const requiredVar of validation.requiredVariables) {
                if (!variables.hasOwnProperty(requiredVar) || 
                    variables[requiredVar] === null || 
                    variables[requiredVar] === '') {
                    validation.missingVariables.push(requiredVar);
                }
            }

            // Check for unused variables
            for (const providedVar in variables) {
                if (!validation.requiredVariables.includes(providedVar)) {
                    validation.unusedVariables.push(providedVar);
                }
            }

            // Set validation status
            if (validation.missingVariables.length > 0) {
                validation.isValid = false;
                validation.errors.push(`Missing required variables: ${validation.missingVariables.join(', ')}`);
            }

            if (validation.unusedVariables.length > 0) {
                validation.warnings.push(`Unused variables: ${validation.unusedVariables.join(', ')}`);
            }

            // Check template structure
            if (templateContent.length < 50) {
                validation.warnings.push('Template appears to be very short');
            }

            if (!templateContent.includes('{{')) {
                validation.warnings.push('Template contains no variables');
            }

        } catch (error) {
            validation.isValid = false;
            validation.errors.push(`Template validation error: ${error.message}`);
        }

        return validation;
    }

    /**
     * Process template with variables
     * @param {string} templateContent - Template content
     * @param {Object} variables - Variables to inject
     * @returns {Object} - Processed template and metadata
     */
    processTemplate(templateContent, variables = {}) {
        // First validate the template
        const validation = this.validateTemplate(templateContent, variables);
        
        if (!validation.isValid) {
            throw new Error(`Template validation failed: ${validation.errors.join(', ')}`);
        }

        // Process template with variables
        let processedPrompt = templateContent;
        const usedVariables = {};

        for (const [key, value] of Object.entries(variables)) {
            const regex = new RegExp(`\\{\\{${key}\\}\}`, 'g');
            if (processedPrompt.includes(`{{${key}}}`)) {
                processedPrompt = processedPrompt.replace(regex, value);
                usedVariables[key] = value;
            }
        }

        return {
            processedPrompt,
            metadata: {
                variables_used: Object.keys(usedVariables),
                character_count: processedPrompt.length,
                processing_time: new Date().toISOString(),
                validation_warnings: validation.warnings
            },
            validation,
            usedVariables
        };
    }

    /**
     * Clear template cache
     */
    clearCache() {
        this.cache.clear();
    }

    /**
     * Get cache statistics
     * @returns {Object} - Cache statistics
     */
    getCacheStats() {
        return {
            size: this.cache.size,
            enabled: this.enableCache,
            timeout: this.cacheTimeout
        };
    }

    // Private methods
    async _discoverCategoryTemplates(category) {
        try {
            // This is a simplified discovery - in reality you might want to 
            // query the GitHub API to list files in the directory
            const knownTemplates = {
                'business_operations': ['customer_support_template', 'data_analysis_template'],
                'content_creation': ['blog_post_template'],
                'technical': [],
                'analytics': []
            };

            const templates = [];
            for (const templateName of knownTemplates[category] || []) {
                try {
                    const metadata = await this.getTemplateMetadata(templateName, category);
                    templates.push({
                        name: templateName,
                        category,
                        ...metadata
                    });
                } catch (error) {
                    // Template might not exist, skip it
                    console.warn(`Could not load metadata for ${templateName}: ${error.message}`);
                }
            }

            return templates;
        } catch (error) {
            throw new Error(`Failed to discover templates in category ${category}: ${error.message}`);
        }
    }

    async _fetchTemplate(templateName, category, version) {
        const versionSuffix = version === 'latest' ? '' : `_v${version}`;
        const templateUrl = `${this.baseUrl}/templates/${category}/${templateName}${versionSuffix}.txt`;
        
        const response = await fetch(templateUrl);
        
        if (!response.ok) {
            throw new Error(`Template not found: ${response.status} - ${response.statusText}`);
        }

        const content = await response.text();
        const metadata = await this.getTemplateMetadata(templateName, category);

        return {
            name: templateName,
            category,
            version,
            content,
            metadata,
            url: templateUrl,
            fetchedAt: new Date().toISOString()
        };
    }

    _generateDefaultMetadata(templateName, category) {
        return {
            name: templateName,
            version: '1.0',
            category,
            description: `Auto-generated metadata for ${templateName}`,
            author: 'System',
            created_date: new Date().toISOString().split('T')[0],
            last_updated: new Date().toISOString().split('T')[0],
            variables: {
                required: [],
                optional: []
            }
        };
    }

    _getCachedData(key) {
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
            return cached.data;
        }
        this.cache.delete(key);
        return null;
    }

    _setCachedData(key, data) {
        this.cache.set(key, {
            data,
            timestamp: Date.now()
        });
    }
}

module.exports = TemplateManager;
