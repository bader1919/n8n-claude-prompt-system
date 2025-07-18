/**
 * Version Manager - Semantic versioning and template lifecycle management
 * Part of the n8n Claude Prompt System
 *
 * Features:
 * - Semantic versioning (major.minor.patch)
 * - Template deprecation policies
 * - Migration support between versions
 * - Rollback capabilities
 * - Version history tracking
 * - Backward compatibility checks
 *
 * @author Bader Abdulrahim
 * @version 1.0.0
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

class VersionManager {
    constructor(options = {}) {
        this.configDir = options.configDir || path.join(__dirname, '../config');
        this.versionsFile = path.join(this.configDir, 'template-versions.json');
        this.backupDir = path.join(this.configDir, 'backups');
        this.versions = new Map();
        this.deprecationPolicies = {
            minor: 30 * 24 * 60 * 60 * 1000, // 30 days
            major: 90 * 24 * 60 * 60 * 1000, // 90 days
            patch: 7 * 24 * 60 * 60 * 1000   // 7 days
        };

        this.init();
    }

    /**
     * Initialize the version manager
     */
    async init() {
        try {
            await this.ensureBackupDir();
            await this.loadVersions();
            console.log('Version Manager initialized successfully');
        } catch (error) {
            console.error('Version Manager initialization failed:', error);
        }
    }

    /**
     * Ensure backup directory exists
     */
    async ensureBackupDir() {
        try {
            await fs.mkdir(this.backupDir, { recursive: true });
        } catch (error) {
            if (error.code !== 'EEXIST') {
                throw error;
            }
        }
    }

    /**
     * Load version history from file
     */
    async loadVersions() {
        try {
            const data = await fs.readFile(this.versionsFile, 'utf8');
            const versionData = JSON.parse(data);
            this.versions = new Map(Object.entries(versionData.versions || {}));
            console.log(`Loaded ${this.versions.size} template versions`);
        } catch (error) {
            console.log('Creating new version history...');
            this.versions = new Map();
        }
    }

    /**
     * Save version history to file
     */
    async saveVersions() {
        try {
            const versionData = {
                last_updated: new Date().toISOString(),
                schema_version: '1.0.0',
                versions: Object.fromEntries(this.versions)
            };

            await fs.writeFile(this.versionsFile, JSON.stringify(versionData, null, 2));
            console.log('Version history saved successfully');
        } catch (error) {
            console.error('Failed to save version history:', error);
        }
    }

    /**
     * Parse semantic version string
     */
    parseVersion(versionString) {
        const match = versionString.match(/^\d+\.\d+\.\d+(?:-(.+))?$/);
        if (!match) {
            throw new Error(`Invalid version format: ${versionString}`);
        }

        const parts = versionString.split('-')[0].split('.');
        return {
            major: parseInt(parts[0]),
            minor: parseInt(parts[1]),
            patch: parseInt(parts[2]),
            prerelease: match[1] || null,
            string: versionString
        };
    }

    /**
     * Compare two version objects
     */
    compareVersions(v1, v2) {
        if (v1.major !== v2.major) return v1.major - v2.major;
        if (v1.minor !== v2.minor) return v1.minor - v2.minor;
        if (v1.patch !== v2.patch) return v1.patch - v2.patch;

        // Handle prerelease versions
        if (v1.prerelease && !v2.prerelease) return -1;
        if (!v1.prerelease && v2.prerelease) return 1;
        if (v1.prerelease && v2.prerelease) {
            return v1.prerelease.localeCompare(v2.prerelease);
        }

        return 0;
    }

    /**
     * Get next version based on change type
     */
    getNextVersion(currentVersion, changeType) {
        const current = this.parseVersion(currentVersion);

        switch (changeType) {
        case 'major':
            return `${current.major + 1}.0.0`;
        case 'minor':
            return `${current.major}.${current.minor + 1}.0`;
        case 'patch':
            return `${current.major}.${current.minor}.${current.patch + 1}`;
        default:
            throw new Error(`Invalid change type: ${changeType}`);
        }
    }

    /**
     * Determine change type based on content differences
     */
    determineChangeType(oldContent, newContent) {
        const oldVariables = this.extractVariables(oldContent);
        const newVariables = this.extractVariables(newContent);

        // Check for breaking changes (removed variables)
        const removedVariables = oldVariables.filter(v => !newVariables.includes(v));
        if (removedVariables.length > 0) {
            return 'major';
        }

        // Check for new variables (minor change)
        const addedVariables = newVariables.filter(v => !oldVariables.includes(v));
        if (addedVariables.length > 0) {
            return 'minor';
        }

        // Check for significant content changes
        const contentDiff = this.calculateContentDifference(oldContent, newContent);
        if (contentDiff > 0.3) { // 30% content change
            return 'minor';
        }

        return 'patch';
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
     * Calculate content difference ratio
     */
    calculateContentDifference(oldContent, newContent) {
        const oldWords = oldContent.split(/\s+/);
        const newWords = newContent.split(/\s+/);

        const oldSet = new Set(oldWords);
        const newSet = new Set(newWords);

        const intersection = new Set([...oldSet].filter(x => newSet.has(x)));
        const union = new Set([...oldSet, ...newSet]);

        return 1 - (intersection.size / union.size);
    }

    /**
     * Create new version of a template
     */
    async createVersion(templateKey, content, metadata = {}) {
        const templateVersions = this.versions.get(templateKey) || {
            versions: [],
            current: null,
            deprecated: []
        };

        let newVersion;
        let changeType = 'patch';

        if (templateVersions.current) {
            const currentVersionData = templateVersions.versions.find(v => v.version === templateVersions.current);
            if (currentVersionData) {
                changeType = this.determineChangeType(currentVersionData.content, content);
                newVersion = this.getNextVersion(templateVersions.current, changeType);
            } else {
                newVersion = '1.0.0';
            }
        } else {
            newVersion = '1.0.0';
        }

        // Create backup of current version
        if (templateVersions.current) {
            await this.createBackup(templateKey, templateVersions.current);
        }

        // Create version entry
        const versionData = {
            version: newVersion,
            content: content,
            hash: crypto.createHash('sha256').update(content).digest('hex'),
            changeType: changeType,
            metadata: {
                ...metadata,
                created: new Date().toISOString(),
                variables: this.extractVariables(content),
                size: content.length,
                wordCount: content.split(/\s+/).length
            },
            compatibility: {
                backwardCompatible: changeType !== 'major',
                deprecationDate: null,
                migrationRequired: changeType === 'major'
            }
        };

        // Add to versions array
        templateVersions.versions.push(versionData);

        // Update current version
        templateVersions.current = newVersion;

        // Update versions map
        this.versions.set(templateKey, templateVersions);

        // Save to file
        await this.saveVersions();

        console.log(`Created ${changeType} version ${newVersion} for template ${templateKey}`);

        return {
            version: newVersion,
            changeType: changeType,
            previousVersion: templateVersions.versions.length > 1 ?
                templateVersions.versions[templateVersions.versions.length - 2].version : null
        };
    }

    /**
     * Get specific version of a template
     */
    getVersion(templateKey, version) {
        const templateVersions = this.versions.get(templateKey);
        if (!templateVersions) {
            return null;
        }

        const versionData = templateVersions.versions.find(v => v.version === version);
        return versionData || null;
    }

    /**
     * Get current version of a template
     */
    getCurrentVersion(templateKey) {
        const templateVersions = this.versions.get(templateKey);
        if (!templateVersions || !templateVersions.current) {
            return null;
        }

        return this.getVersion(templateKey, templateVersions.current);
    }

    /**
     * Get all versions of a template
     */
    getAllVersions(templateKey) {
        const templateVersions = this.versions.get(templateKey);
        if (!templateVersions) {
            return [];
        }

        return templateVersions.versions.sort((a, b) => {
            const vA = this.parseVersion(a.version);
            const vB = this.parseVersion(b.version);
            return this.compareVersions(vB, vA); // Descending order
        });
    }

    /**
     * Deprecate a version
     */
    async deprecateVersion(templateKey, version, reason = 'Superseded by newer version') {
        const templateVersions = this.versions.get(templateKey);
        if (!templateVersions) {
            throw new Error(`Template ${templateKey} not found`);
        }

        const versionData = templateVersions.versions.find(v => v.version === version);
        if (!versionData) {
            throw new Error(`Version ${version} not found for template ${templateKey}`);
        }

        // Calculate deprecation date based on change type
        const deprecationPeriod = this.deprecationPolicies[versionData.changeType] || this.deprecationPolicies.patch;
        const deprecationDate = new Date(Date.now() + deprecationPeriod);

        // Update version data
        versionData.compatibility.deprecationDate = deprecationDate.toISOString();
        versionData.compatibility.deprecationReason = reason;

        // Add to deprecated list
        if (!templateVersions.deprecated.includes(version)) {
            templateVersions.deprecated.push(version);
        }

        // Update versions map
        this.versions.set(templateKey, templateVersions);

        // Save to file
        await this.saveVersions();

        console.log(`Deprecated version ${version} of template ${templateKey}, will be removed on ${deprecationDate.toISOString()}`);

        return {
            version: version,
            deprecationDate: deprecationDate.toISOString(),
            reason: reason
        };
    }

    /**
     * Create backup of a template version
     */
    async createBackup(templateKey, version) {
        const versionData = this.getVersion(templateKey, version);
        if (!versionData) {
            throw new Error(`Version ${version} not found for template ${templateKey}`);
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupFileName = `${templateKey.replace('/', '_')}_v${version}_${timestamp}.json`;
        const backupPath = path.join(this.backupDir, backupFileName);

        const backupData = {
            templateKey: templateKey,
            version: version,
            timestamp: timestamp,
            data: versionData
        };

        await fs.writeFile(backupPath, JSON.stringify(backupData, null, 2));
        console.log(`Created backup: ${backupFileName}`);

        return backupPath;
    }

    /**
     * Rollback to a previous version
     */
    async rollbackToVersion(templateKey, targetVersion) {
        const templateVersions = this.versions.get(templateKey);
        if (!templateVersions) {
            throw new Error(`Template ${templateKey} not found`);
        }

        const targetVersionData = templateVersions.versions.find(v => v.version === targetVersion);
        if (!targetVersionData) {
            throw new Error(`Version ${targetVersion} not found for template ${templateKey}`);
        }

        // Create backup of current version
        if (templateVersions.current) {
            await this.createBackup(templateKey, templateVersions.current);
        }

        // Update current version
        const previousVersion = templateVersions.current;
        templateVersions.current = targetVersion;

        // Update versions map
        this.versions.set(templateKey, templateVersions);

        // Save to file
        await this.saveVersions();

        console.log(`Rolled back template ${templateKey} from ${previousVersion} to ${targetVersion}`);

        return {
            templateKey: templateKey,
            previousVersion: previousVersion,
            currentVersion: targetVersion,
            rollbackTime: new Date().toISOString()
        };
    }

    /**
     * Get migration requirements between versions
     */
    getMigrationRequirements(templateKey, fromVersion, toVersion) {
        const fromVersionData = this.getVersion(templateKey, fromVersion);
        const toVersionData = this.getVersion(templateKey, toVersion);

        if (!fromVersionData || !toVersionData) {
            return null;
        }

        const fromVariables = fromVersionData.metadata.variables;
        const toVariables = toVersionData.metadata.variables;

        const addedVariables = toVariables.filter(v => !fromVariables.includes(v));
        const removedVariables = fromVariables.filter(v => !toVariables.includes(v));

        const fromParsed = this.parseVersion(fromVersion);
        const toParsed = this.parseVersion(toVersion);
        const isBreaking = this.compareVersions(toParsed, fromParsed) > 0 &&
                           (toParsed.major > fromParsed.major);

        return {
            fromVersion: fromVersion,
            toVersion: toVersion,
            isBreaking: isBreaking,
            addedVariables: addedVariables,
            removedVariables: removedVariables,
            migrationRequired: isBreaking || removedVariables.length > 0,
            migrationSteps: this.generateMigrationSteps(addedVariables, removedVariables),
            estimatedEffort: this.estimateMigrationEffort(addedVariables, removedVariables, isBreaking)
        };
    }

    /**
     * Generate migration steps
     */
    generateMigrationSteps(addedVariables, removedVariables) {
        const steps = [];

        if (removedVariables.length > 0) {
            steps.push({
                type: 'remove',
                description: `Remove variables: ${removedVariables.join(', ')}`,
                variables: removedVariables,
                required: true
            });
        }

        if (addedVariables.length > 0) {
            steps.push({
                type: 'add',
                description: `Add variables: ${addedVariables.join(', ')}`,
                variables: addedVariables,
                required: true
            });
        }

        return steps;
    }

    /**
     * Estimate migration effort
     */
    estimateMigrationEffort(addedVariables, removedVariables, isBreaking) {
        let effort = 0;

        effort += addedVariables.length * 2; // 2 points per added variable
        effort += removedVariables.length * 3; // 3 points per removed variable

        if (isBreaking) {
            effort += 10; // 10 points for breaking changes
        }

        if (effort <= 5) return 'low';
        if (effort <= 15) return 'medium';
        return 'high';
    }

    /**
     * Get version statistics
     */
    getVersionStats() {
        const allTemplates = Array.from(this.versions.keys());
        const stats = {
            totalTemplates: allTemplates.length,
            totalVersions: 0,
            deprecatedVersions: 0,
            majorVersions: 0,
            minorVersions: 0,
            patchVersions: 0,
            templatesWithMultipleVersions: 0
        };

        for (const templateKey of allTemplates) {
            const templateVersions = this.versions.get(templateKey);
            stats.totalVersions += templateVersions.versions.length;
            stats.deprecatedVersions += templateVersions.deprecated.length;

            if (templateVersions.versions.length > 1) {
                stats.templatesWithMultipleVersions++;
            }

            for (const version of templateVersions.versions) {
                if (version.changeType === 'major') stats.majorVersions++;
                else if (version.changeType === 'minor') stats.minorVersions++;
                else if (version.changeType === 'patch') stats.patchVersions++;
            }
        }

        return stats;
    }

    /**
     * Clean up old deprecated versions
     */
    async cleanupDeprecatedVersions() {
        const now = new Date();
        let cleanedCount = 0;

        for (const [templateKey, templateVersions] of this.versions) {
            const versionsToRemove = [];

            for (const version of templateVersions.versions) {
                if (version.compatibility.deprecationDate) {
                    const deprecationDate = new Date(version.compatibility.deprecationDate);
                    if (now > deprecationDate) {
                        versionsToRemove.push(version.version);
                    }
                }
            }

            if (versionsToRemove.length > 0) {
                // Remove versions
                templateVersions.versions = templateVersions.versions.filter(
                    v => !versionsToRemove.includes(v.version)
                );

                // Remove from deprecated list
                templateVersions.deprecated = templateVersions.deprecated.filter(
                    v => !versionsToRemove.includes(v)
                );

                cleanedCount += versionsToRemove.length;
                console.log(`Cleaned up ${versionsToRemove.length} deprecated versions for ${templateKey}`);
            }
        }

        if (cleanedCount > 0) {
            await this.saveVersions();
            console.log(`Cleaned up ${cleanedCount} deprecated versions total`);
        }

        return cleanedCount;
    }
}

module.exports = VersionManager;
