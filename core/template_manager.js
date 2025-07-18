/**
 * Template Manager - Core component for template discovery, validation, and lifecycle management
 * Part of the n8n Claude Prompt System
 *
 * Features:
 * - Automatic template discovery and scanning
 * - Template validation and quality scoring
 * - Template caching and metadata management
 * - Version control integration
 * - Template lifecycle management (CRUD operations)
 *
 * @author Bader Abdulrahim
 * @version 1.0.0
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

class TemplateManager {
    constructor(options = {}) {
        this.templateDir = options.templateDir || path.join(__dirname, '../templates');
        this.configDir = options.configDir || path.join(__dirname, '../config');
        this.registryFile = path.join(this.configDir, 'template-registry.json');
        this.cacheFile = path.join(this.configDir, 'template-cache.json');
        this.scanInterval = options.scanInterval || 24 * 60 * 60 * 1000; // 24 hours
        this.registry = new Map();
        this.cache = new Map();
        this.isScanning = false;

        this.init();
    }

    /**
     * Initialize the template manager
     */
    async init() {
        try {
            await this.loadRegistry();
            await this.loadCache();
            await this.startAutoDiscovery();
            console.log('Template Manager initialized successfully');
        } catch (error) {
            console.error('Template Manager initialization failed:', error);
        }
    }

    /**
     * Load template registry from file
     */
    async loadRegistry() {
        try {
            const data = await fs.readFile(this.registryFile, 'utf8');
            const registryData = JSON.parse(data);
            this.registry = new Map(Object.entries(registryData.templates || {}));
            console.log(`Loaded ${this.registry.size} templates from registry`);
        } catch (error) {
            console.log('Creating new template registry...');
            this.registry = new Map();
        }
    }

    /**
     * Save template registry to file
     */
    async saveRegistry() {
        try {
            const registryData = {
                last_updated: new Date().toISOString(),
                version: '1.0.0',
                templates: Object.fromEntries(this.registry)
            };

            await fs.writeFile(this.registryFile, JSON.stringify(registryData, null, 2));
            console.log('Template registry saved successfully');
        } catch (error) {
            console.error('Failed to save template registry:', error);
        }
    }

    /**
     * Load template cache from file
     */
    async loadCache() {
        try {
            const data = await fs.readFile(this.cacheFile, 'utf8');
            const cacheData = JSON.parse(data);
            this.cache = new Map(Object.entries(cacheData.cache || {}));
            console.log(`Loaded ${this.cache.size} templates from cache`);
        } catch (error) {
            console.log('Creating new template cache...');
            this.cache = new Map();
        }
    }

    /**
     * Save template cache to file
     */
    async saveCache() {
        try {
            const cacheData = {
                last_updated: new Date().toISOString(),
                cache: Object.fromEntries(this.cache)
            };

            await fs.writeFile(this.cacheFile, JSON.stringify(cacheData, null, 2));
            console.log('Template cache saved successfully');
        } catch (error) {
            console.error('Failed to save template cache:', error);
        }
    }

    /**
     * Start automatic template discovery
     */
    async startAutoDiscovery() {
        // Initial scan
        await this.scanTemplates();

        // Schedule periodic scans
        setInterval(() => {
            this.scanTemplates();
        }, this.scanInterval);

        console.log('Auto-discovery started, scanning every 24 hours');
    }

    /**
     * Scan templates directory for new or updated templates
     */
    async scanTemplates() {
        if (this.isScanning) {
            console.log('Template scan already in progress...');
            return;
        }

        this.isScanning = true;
        console.log('Starting template scan...');

        try {
            const categories = await this.getTemplateCategories();
            let totalTemplates = 0;
            let newTemplates = 0;
            let updatedTemplates = 0;

            for (const category of categories) {
                const templates = await this.scanCategory(category);

                for (const template of templates) {
                    const templateKey = `${category}/${template.name}`;
                    const existingTemplate = this.registry.get(templateKey);

                    if (!existingTemplate) {
                        await this.addTemplate(template, category);
                        newTemplates++;
                    } else if (template.hash !== existingTemplate.hash) {
                        await this.updateTemplate(template, category);
                        updatedTemplates++;
                    }

                    totalTemplates++;
                }
            }

            console.log(`Template scan completed: ${totalTemplates} total, ${newTemplates} new, ${updatedTemplates} updated`);

            await this.saveRegistry();
            await this.saveCache();

        } catch (error) {
            console.error('Template scan failed:', error);
        } finally {
            this.isScanning = false;
        }
    }

    /**
     * Get template categories from directory structure
     */
    async getTemplateCategories() {
        try {
            const items = await fs.readdir(this.templateDir);
            const categories = [];

            for (const item of items) {
                const itemPath = path.join(this.templateDir, item);
                const stats = await fs.stat(itemPath);

                if (stats.isDirectory()) {
                    categories.push(item);
                }
            }

            return categories;
        } catch (error) {
            console.error('Failed to get template categories:', error);
            return [];
        }
    }

    /**
     * Scan a specific category for templates
     */
    async scanCategory(category) {
        const categoryPath = path.join(this.templateDir, category);
        const templates = [];

        try {
            const files = await fs.readdir(categoryPath);

            for (const file of files) {
                if (file.endsWith('.txt')) {
                    const templatePath = path.join(categoryPath, file);
                    const templateData = await this.loadTemplateFile(templatePath);

                    if (templateData) {
                        templates.push({
                            name: file.replace('.txt', ''),
                            path: templatePath,
                            category: category,
                            ...templateData
                        });
                    }
                }
            }
        } catch (error) {
            console.error(`Failed to scan category ${category}:`, error);
        }

        return templates;
    }

    /**
     * Load and analyze a template file
     */
    async loadTemplateFile(templatePath) {
        try {
            const content = await fs.readFile(templatePath, 'utf8');
            const stats = await fs.stat(templatePath);

            // Extract variables from template
            const variables = this.extractVariables(content);

            // Calculate content hash
            const hash = crypto.createHash('sha256').update(content).digest('hex');

            // Calculate quality score
            const qualityScore = this.calculateQualityScore(content, variables);

            return {
                content,
                variables,
                hash,
                qualityScore,
                fileSize: stats.size,
                lastModified: stats.mtime.toISOString(),
                characterCount: content.length,
                wordCount: content.split(/\s+/).length
            };
        } catch (error) {
            console.error(`Failed to load template file ${templatePath}:`, error);
            return null;
        }
    }

    /**
     * Extract variables from template content
     */
    extractVariables(content) {
        const variablePattern = /\{\{(\w+)\}\}/g;
        const variables = [];
        let match;

        while ((match = variablePattern.exec(content)) !== null) {
            if (!variables.includes(match[1])) {
                variables.push(match[1]);
            }
        }

        return variables;
    }

    /**
     * Calculate template quality score
     */
    calculateQualityScore(content, variables) {
        let score = 0;

        // Base score for having content
        if (content.length > 0) score += 10;

        // Score for structure and organization
        if (content.includes('Instructions:')) score += 15;
        if (content.includes('Context:')) score += 15;
        if (content.includes('Output:') || content.includes('Response:')) score += 15;

        // Score for variable usage
        if (variables.length > 0) score += 20;
        if (variables.length > 5) score += 10;

        // Score for content length (optimal range)
        if (content.length >= 200 && content.length <= 2000) score += 10;

        // Score for clear formatting
        if (content.includes('\n\n')) score += 5; // Has paragraph breaks
        if (content.includes('1.') || content.includes('-')) score += 5; // Has lists

        // Score for professional language
        if (content.includes('You are')) score += 5;
        if (content.includes('professional') || content.includes('expert')) score += 5;

        return Math.min(score, 100); // Cap at 100
    }

    /**
     * Add a new template to the registry
     */
    async addTemplate(template, category) {
        const templateKey = `${category}/${template.name}`;

        const templateMetadata = {
            name: template.name,
            category: category,
            version: '1.0.0',
            hash: template.hash,
            variables: template.variables,
            qualityScore: template.qualityScore,
            stats: {
                fileSize: template.fileSize,
                characterCount: template.characterCount,
                wordCount: template.wordCount,
                variableCount: template.variables.length
            },
            timestamps: {
                created: new Date().toISOString(),
                lastModified: template.lastModified,
                lastUsed: null
            },
            usage: {
                totalExecutions: 0,
                successfulExecutions: 0,
                failedExecutions: 0,
                averageResponseTime: 0,
                totalTokensUsed: 0,
                totalCost: 0
            },
            status: 'active'
        };

        this.registry.set(templateKey, templateMetadata);
        this.cache.set(templateKey, {
            content: template.content,
            variables: template.variables,
            lastCached: new Date().toISOString()
        });

        console.log(`Added new template: ${templateKey}`);
    }

    /**
     * Update an existing template in the registry
     */
    async updateTemplate(template, category) {
        const templateKey = `${category}/${template.name}`;
        const existingTemplate = this.registry.get(templateKey);

        if (existingTemplate) {
            // Increment version
            const versionParts = existingTemplate.version.split('.');
            versionParts[2] = (parseInt(versionParts[2]) + 1).toString();
            const newVersion = versionParts.join('.');

            existingTemplate.version = newVersion;
            existingTemplate.hash = template.hash;
            existingTemplate.variables = template.variables;
            existingTemplate.qualityScore = template.qualityScore;
            existingTemplate.stats = {
                fileSize: template.fileSize,
                characterCount: template.characterCount,
                wordCount: template.wordCount,
                variableCount: template.variables.length
            };
            existingTemplate.timestamps.lastModified = template.lastModified;

            this.registry.set(templateKey, existingTemplate);
            this.cache.set(templateKey, {
                content: template.content,
                variables: template.variables,
                lastCached: new Date().toISOString()
            });

            console.log(`Updated template: ${templateKey} -> v${newVersion}`);
        }
    }

    /**
     * Get template by key
     */
    async getTemplate(templateKey) {
        const template = this.registry.get(templateKey);
        const cachedContent = this.cache.get(templateKey);

        if (template && cachedContent) {
            return {
                ...template,
                content: cachedContent.content
            };
        }

        return null;
    }

    /**
     * Get all templates
     */
    getAllTemplates() {
        return Array.from(this.registry.entries()).map(([key, template]) => ({
            key,
            ...template
        }));
    }

    /**
     * Get templates by category
     */
    getTemplatesByCategory(category) {
        return this.getAllTemplates().filter(template => template.category === category);
    }

    /**
     * Search templates by name or content
     */
    searchTemplates(query) {
        const searchTerm = query.toLowerCase();
        return this.getAllTemplates().filter(template =>
            template.name.toLowerCase().includes(searchTerm) ||
            template.category.toLowerCase().includes(searchTerm) ||
            template.variables.some(variable => variable.toLowerCase().includes(searchTerm))
        );
    }

    /**
     * Update template usage statistics
     */
    async updateTemplateUsage(templateKey, executionData) {
        const template = this.registry.get(templateKey);

        if (template) {
            template.usage.totalExecutions++;

            if (executionData.success) {
                template.usage.successfulExecutions++;
            } else {
                template.usage.failedExecutions++;
            }

            // Update averages
            const totalExecutions = template.usage.totalExecutions;
            const currentAvgTime = template.usage.averageResponseTime;
            template.usage.averageResponseTime =
                (currentAvgTime * (totalExecutions - 1) + executionData.responseTime) / totalExecutions;

            template.usage.totalTokensUsed += executionData.tokensUsed || 0;
            template.usage.totalCost += executionData.cost || 0;
            template.timestamps.lastUsed = new Date().toISOString();

            this.registry.set(templateKey, template);
            await this.saveRegistry();
        }
    }

    /**
     * Get template statistics
     */
    getTemplateStats() {
        const templates = this.getAllTemplates();

        return {
            totalTemplates: templates.length,
            activeTemplates: templates.filter(t => t.status === 'active').length,
            deprecatedTemplates: templates.filter(t => t.status === 'deprecated').length,
            averageQualityScore: templates.reduce((sum, t) => sum + t.qualityScore, 0) / templates.length,
            totalExecutions: templates.reduce((sum, t) => sum + t.usage.totalExecutions, 0),
            totalTokensUsed: templates.reduce((sum, t) => sum + t.usage.totalTokensUsed, 0),
            totalCost: templates.reduce((sum, t) => sum + t.usage.totalCost, 0)
        };
    }

    /**
     * Remove template from registry
     */
    async removeTemplate(templateKey) {
        if (this.registry.has(templateKey)) {
            this.registry.delete(templateKey);
            this.cache.delete(templateKey);
            await this.saveRegistry();
            await this.saveCache();
            console.log(`Removed template: ${templateKey}`);
            return true;
        }
        return false;
    }

    /**
     * Refresh template cache
     */
    async refreshCache() {
        console.log('Refreshing template cache...');
        this.cache.clear();
        await this.scanTemplates();
        console.log('Template cache refreshed');
    }
}

module.exports = TemplateManager;
