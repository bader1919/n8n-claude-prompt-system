/**
 * Template Version Management System
 * Handles template versioning, compatibility checking, and migration
 */
class VersionManager {
    constructor(config = {}) {
        this.baseUrl = config.baseUrl || 'https://raw.githubusercontent.com/bader1919/n8n-claude-prompt-system/main';
        this.defaultVersion = config.defaultVersion || '1.0';
        this.enableBackwardCompatibility = config.enableBackwardCompatibility !== false;
    }

    /**
     * Parse version string into comparable object
     * @param {string} version - Version string (e.g., "1.2.3")
     * @returns {Object} - Parsed version object
     */
    parseVersion(version) {
        if (!version || typeof version !== 'string') {
            return this.parseVersion(this.defaultVersion);
        }

        const parts = version.split('.').map(part => parseInt(part, 10));
        
        return {
            major: parts[0] || 1,
            minor: parts[1] || 0,
            patch: parts[2] || 0,
            original: version,
            comparable: (parts[0] || 1) * 10000 + (parts[1] || 0) * 100 + (parts[2] || 0)
        };
    }

    /**
     * Compare two versions
     * @param {string} version1 - First version
     * @param {string} version2 - Second version
     * @returns {number} - -1 if v1 < v2, 0 if equal, 1 if v1 > v2
     */
    compareVersions(version1, version2) {
        const v1 = this.parseVersion(version1);
        const v2 = this.parseVersion(version2);

        if (v1.comparable < v2.comparable) return -1;
        if (v1.comparable > v2.comparable) return 1;
        return 0;
    }

    /**
     * Check if a version is compatible with requirements
     * @param {string} templateVersion - Template version
     * @param {string} requiredVersion - Required minimum version
     * @param {string} maxVersion - Maximum supported version (optional)
     * @returns {Object} - Compatibility result
     */
    checkCompatibility(templateVersion, requiredVersion, maxVersion = null) {
        const template = this.parseVersion(templateVersion);
        const required = this.parseVersion(requiredVersion);
        const max = maxVersion ? this.parseVersion(maxVersion) : null;

        const compatibility = {
            isCompatible: true,
            version: templateVersion,
            requiredVersion,
            maxVersion,
            warnings: [],
            breakingChanges: []
        };

        // Check minimum version requirement
        if (this.compareVersions(templateVersion, requiredVersion) < 0) {
            compatibility.isCompatible = false;
            compatibility.warnings.push(`Template version ${templateVersion} is below required minimum ${requiredVersion}`);
        }

        // Check maximum version if specified
        if (max && this.compareVersions(templateVersion, maxVersion) > 0) {
            compatibility.isCompatible = false;
            compatibility.warnings.push(`Template version ${templateVersion} exceeds maximum supported version ${maxVersion}`);
        }

        // Check for potential breaking changes (major version differences)
        if (template.major !== required.major) {
            compatibility.breakingChanges.push(`Major version difference: template is v${template.major}, required is v${required.major}`);
            
            if (!this.enableBackwardCompatibility) {
                compatibility.isCompatible = false;
            }
        }

        return compatibility;
    }

    /**
     * Get available versions for a template
     * @param {string} templateName - Template name
     * @param {string} category - Template category
     * @returns {Promise<Array>} - List of available versions
     */
    async getAvailableVersions(templateName, category) {
        try {
            // Try to fetch version manifest first
            const manifestUrl = `${this.baseUrl}/templates/${category}/${templateName}_versions.json`;
            const manifestResponse = await fetch(manifestUrl);
            
            if (manifestResponse.ok) {
                const manifest = await manifestResponse.json();
                return manifest.versions || [];
            }

            // Fallback: try to detect versions by attempting to fetch common version patterns
            const commonVersions = ['1.0', '1.1', '1.2', '2.0', '2.1'];
            const availableVersions = [];

            for (const version of commonVersions) {
                try {
                    const versionUrl = `${this.baseUrl}/templates/${category}/${templateName}_v${version}.txt`;
                    const response = await fetch(versionUrl, { method: 'HEAD' });
                    
                    if (response.ok) {
                        availableVersions.push(version);
                    }
                } catch (error) {
                    // Version doesn't exist, continue
                }
            }

            // Always include the base version (no suffix)
            try {
                const baseUrl = `${this.baseUrl}/templates/${category}/${templateName}.txt`;
                const response = await fetch(baseUrl, { method: 'HEAD' });
                
                if (response.ok) {
                    availableVersions.unshift('latest');
                }
            } catch (error) {
                // Base version doesn't exist
            }

            return availableVersions;
        } catch (error) {
            throw new Error(`Failed to get available versions for ${templateName}: ${error.message}`);
        }
    }

    /**
     * Get template changelog
     * @param {string} templateName - Template name
     * @param {string} category - Template category
     * @returns {Promise<Array>} - Changelog entries
     */
    async getChangelog(templateName, category) {
        try {
            const changelogUrl = `${this.baseUrl}/templates/${category}/${templateName}_changelog.json`;
            const response = await fetch(changelogUrl);
            
            if (response.ok) {
                const changelog = await response.json();
                return changelog.entries || [];
            }

            return [];
        } catch (error) {
            return [];
        }
    }

    /**
     * Create version metadata for a template
     * @param {Object} templateInfo - Template information
     * @returns {Object} - Version metadata
     */
    createVersionMetadata(templateInfo) {
        const version = this.parseVersion(templateInfo.version || this.defaultVersion);
        
        return {
            version: version.original,
            version_info: {
                major: version.major,
                minor: version.minor,
                patch: version.patch,
                comparable: version.comparable
            },
            compatibility: {
                minimum_system_version: '1.0',
                maximum_system_version: null,
                breaking_changes: templateInfo.breakingChanges || [],
                deprecated_features: templateInfo.deprecatedFeatures || []
            },
            metadata: {
                created_date: templateInfo.createdDate || new Date().toISOString().split('T')[0],
                last_updated: new Date().toISOString().split('T')[0],
                author: templateInfo.author || 'System',
                description: templateInfo.description || '',
                changelog_url: `templates/${templateInfo.category}/${templateInfo.name}_changelog.json`
            },
            variables: {
                added: templateInfo.addedVariables || [],
                removed: templateInfo.removedVariables || [],
                modified: templateInfo.modifiedVariables || [],
                deprecated: templateInfo.deprecatedVariables || []
            }
        };
    }

    /**
     * Migrate template from old version to new version
     * @param {Object} oldTemplate - Old template data
     * @param {string} targetVersion - Target version
     * @returns {Object} - Migration result
     */
    async migrateTemplate(oldTemplate, targetVersion) {
        const migration = {
            success: false,
            oldVersion: oldTemplate.version || 'unknown',
            targetVersion,
            changes: [],
            warnings: [],
            errors: []
        };

        try {
            const compatibility = this.checkCompatibility(
                oldTemplate.version || this.defaultVersion,
                targetVersion
            );

            if (!compatibility.isCompatible) {
                migration.errors.push('Version incompatibility detected');
                migration.warnings.push(...compatibility.warnings);
                return migration;
            }

            // Get changelog to understand what changed
            const changelog = await this.getChangelog(oldTemplate.name, oldTemplate.category);
            const relevantChanges = changelog.filter(entry => 
                this.compareVersions(entry.version, oldTemplate.version || this.defaultVersion) > 0 &&
                this.compareVersions(entry.version, targetVersion) <= 0
            );

            // Apply migrations based on changelog
            for (const change of relevantChanges) {
                if (change.type === 'variable_added') {
                    migration.changes.push(`Added variable: ${change.variable}`);
                    migration.warnings.push(`New variable '${change.variable}' may require updating your input data`);
                }
                
                if (change.type === 'variable_removed') {
                    migration.changes.push(`Removed variable: ${change.variable}`);
                    migration.warnings.push(`Variable '${change.variable}' is no longer used`);
                }
                
                if (change.type === 'variable_renamed') {
                    migration.changes.push(`Renamed variable: ${change.oldName} -> ${change.newName}`);
                    migration.warnings.push(`Variable '${change.oldName}' was renamed to '${change.newName}'`);
                }
                
                if (change.type === 'breaking_change') {
                    migration.warnings.push(`Breaking change: ${change.description}`);
                }
            }

            migration.success = true;
            migration.changes.push(`Successfully migrated from ${migration.oldVersion} to ${targetVersion}`);

        } catch (error) {
            migration.errors.push(`Migration failed: ${error.message}`);
        }

        return migration;
    }

    /**
     * Validate version format
     * @param {string} version - Version string to validate
     * @returns {Object} - Validation result
     */
    validateVersionFormat(version) {
        const validation = {
            isValid: true,
            errors: [],
            normalized: version
        };

        if (!version || typeof version !== 'string') {
            validation.isValid = false;
            validation.errors.push('Version must be a non-empty string');
            return validation;
        }

        // Check semantic versioning format
        const semverPattern = /^(\d+)\.(\d+)(?:\.(\d+))?(?:-([a-zA-Z0-9\-\.]+))?(?:\+([a-zA-Z0-9\-\.]+))?$/;
        
        if (!semverPattern.test(version)) {
            validation.isValid = false;
            validation.errors.push('Version must follow semantic versioning format (e.g., 1.0.0)');
        }

        const parts = version.split('.');
        if (parts.length < 2) {
            validation.isValid = false;
            validation.errors.push('Version must have at least major.minor format');
        }

        // Normalize version (ensure patch version exists)
        if (parts.length === 2) {
            validation.normalized = `${version}.0`;
        }

        return validation;
    }
}

module.exports = VersionManager;
