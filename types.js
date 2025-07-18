/**
 * @fileoverview Type definitions for n8n Claude Prompt System
 * This file provides TypeScript-like type definitions to improve IDE support and Copilot suggestions
 */

/**
 * @typedef {Object} TemplateConfig
 * @property {string} name - Template name in snake_case
 * @property {string} category - Template category (e.g., 'business_operations', 'content_creation')
 * @property {string} content - Template content with {{variable}} placeholders
 * @property {string[]} variables - Array of variable names used in template
 * @property {Object} [metadata] - Additional template metadata
 */

/**
 * @typedef {Object} TemplateData
 * @property {string} name - Template name
 * @property {string} category - Template category
 * @property {string} content - Template content
 * @property {string[]} variables - Available variables
 * @property {string} hash - Content hash for change detection
 * @property {number} qualityScore - Template quality score (0-100)
 * @property {Object} stats - Template statistics
 * @property {Object} timestamps - Creation and modification timestamps
 * @property {Object} usage - Usage metrics
 */

/**
 * @typedef {Object} WorkflowVariables
 * @property {string} customer_name - Customer name from n8n workflow
 * @property {string} customer_tier - Customer subscription tier (Basic, Premium, Enterprise)
 * @property {string} issue_description - Description of customer issue
 * @property {string} priority_level - Issue priority (Low, Medium, High, Critical)
 * @property {string} company_name - Company name from environment
 * @property {string} [account_type] - Account type classification
 * @property {string} [tone] - Response tone (professional, friendly, empathetic, urgent)
 */

/**
 * @typedef {Object} ClaudeOptions
 * @property {string} [model] - Claude model to use (default: 'claude-3-haiku-20240307')
 * @property {number} [temperature] - Response creativity (0-1, default: 0.7)
 * @property {number} [maxTokens] - Maximum tokens to generate (default: 1000)
 * @property {string} [systemPrompt] - System-level instructions
 * @property {string[]} [stopSequences] - Sequences to stop generation
 * @property {number} [timeout] - Request timeout in milliseconds
 */

/**
 * @typedef {Object} AIResponse
 * @property {string} content - Generated content
 * @property {Object} usage - Token usage statistics
 * @property {string} model - Model used for generation
 * @property {number} [cost] - Estimated cost of the request
 */

/**
 * @typedef {Object} N8nWorkflowData
 * @property {string} template_name - Template to use for processing
 * @property {Object} variables - Variables extracted from workflow
 * @property {Object} [options] - Additional options for AI generation
 * @property {string} [provider] - AI provider to use (claude, openai, local)
 */

/**
 * @typedef {Object} CustomerSupportData
 * @property {string} customer_name - Customer's name
 * @property {string} customer_tier - Customer subscription level
 * @property {string} issue_description - Description of the issue
 * @property {string} issue_category - Category of the issue
 * @property {string} priority_level - Issue priority level
 * @property {string} [account_type] - Type of customer account
 * @property {string} [interaction_history] - Previous interaction context
 */

/**
 * @typedef {Object} ContentGenerationParams
 * @property {string} topic - Content topic
 * @property {string} target_audience - Intended audience
 * @property {string} tone - Content tone
 * @property {string} [word_count] - Target word count
 * @property {string} [content_type] - Type of content (blog, email, etc.)
 * @property {string[]} [keywords] - SEO keywords to include
 */

/**
 * @typedef {Object} APIGenerateRequest
 * @property {string} template - Template key in format "category/name"
 * @property {WorkflowVariables} variables - Variables to inject
 * @property {string} [provider] - AI provider ('claude', 'openai', 'local')
 * @property {ClaudeOptions} [options] - Provider-specific options
 */

/**
 * @typedef {Object} APIGenerateResponse
 * @property {boolean} success - Whether the request was successful
 * @property {Object} result - Generation result
 * @property {string} result.content - Generated content
 * @property {string} result.template - Template used
 * @property {string} result.provider - Provider used
 * @property {Object} result.usage - Usage metrics
 * @property {number} result.responseTime - Processing time in milliseconds
 */

// Export types for JSDoc usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        // This file is for type definitions only
        // Actual implementations are in their respective modules
    };
}
