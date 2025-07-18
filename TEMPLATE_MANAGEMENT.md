# Template Management Guide

This guide covers the comprehensive template management system of the n8n Claude Prompt System, including creation, validation, versioning, and optimization.

## Overview

The template management system provides:
- Automatic template discovery and scanning
- Template validation and quality scoring
- Version control and lifecycle management
- Usage tracking and analytics
- Template caching and performance optimization

## Template Structure

### Basic Template Format

Templates are stored as `.txt` files with the following structure:

```
Instructions: Clear instructions for the AI about the task
Context: Background information and constraints
Variables: {{variable_name}} placeholders for dynamic content
Output: Specification of expected output format

Example template content...
```

### Template Metadata

Each template includes metadata for management:

```json
{
  "name": "template_name",
  "category": "business|content|custom",
  "version": "1.0.0",
  "variables": ["var1", "var2"],
  "qualityScore": 85,
  "usage": {
    "totalExecutions": 0,
    "successfulExecutions": 0,
    "averageResponseTime": 0
  }
}
```

## Template Categories

### Business Templates
- Customer support responses
- Professional communications
- Business analysis prompts
- Meeting summaries

### Content Templates  
- Blog post generation
- Marketing copy
- Social media content
- Documentation

### Custom Templates
- Organization-specific prompts
- Specialized industry templates
- Experimental templates

## Creating Templates

### 1. Template File Creation

Create a new `.txt` file in the appropriate category directory:

```bash
# Business template
./templates/business/new_template.txt

# Content template  
./templates/content/new_template.txt

# Custom template
./templates/custom/new_template.txt
```

### 2. Template Content Guidelines

**Structure Requirements:**
- Clear instructions section
- Defined context and constraints
- Proper variable placeholders using `{{variable_name}}`
- Output format specification

**Quality Best Practices:**
- Use descriptive variable names
- Include examples where helpful
- Specify tone and style requirements
- Add error handling instructions

**Example Template:**
```
Instructions: You are a professional customer support agent responding to a customer inquiry.

Context: The customer has contacted us about {{issue_description}} regarding our {{product_name}} product. The customer's name is {{customer_name}} and the urgency level is {{urgency_level}}.

Requirements:
- Maintain a professional and empathetic tone
- Address the customer by name
- Provide clear next steps
- Include relevant contact information

Output: Generate a complete customer support response email.

Response:
Dear {{customer_name}},

Thank you for contacting {{company_name}} regarding {{issue_description}}...
```

### 3. Variable Definitions

Create a corresponding variables file in the `variables/` directory:

```json
{
  "template_name": "customer_support",
  "variables": [
    {
      "name": "customer_name",
      "type": "string",
      "required": true,
      "description": "The customer's full name",
      "example": "John Smith"
    },
    {
      "name": "issue_description",
      "type": "string", 
      "required": true,
      "description": "Brief description of the customer's issue",
      "example": "Unable to login to account"
    }
  ]
}
```

## Template Discovery

The system automatically discovers templates through:

### Automatic Scanning
- Scans template directories every 24 hours
- Detects new templates and updates
- Calculates content hashes for change detection
- Updates registry with metadata

### Manual Refresh
```javascript
const templateManager = new TemplateManager();
await templateManager.refreshCache();
```

### API Endpoint
```bash
POST /api/templates/refresh
```

## Quality Scoring

Templates are automatically scored (0-100) based on:

### Structure Quality (40 points)
- Has clear instructions section (15 points)
- Includes context section (15 points)  
- Specifies output format (15 points)

### Variable Usage (30 points)
- Uses variables effectively (20 points)
- Optimal variable count (5-15) (10 points)

### Content Quality (20 points)
- Appropriate length (200-2000 chars) (10 points)
- Good formatting with breaks (5 points)
- Professional language (5 points)

### Completeness (10 points)
- Has examples or demonstrations (5 points)
- Includes error handling (5 points)

## Version Management

### Automatic Versioning
- Version incremented on file changes
- Semantic versioning (major.minor.patch)
- Change detection via content hashing

### Manual Version Control
```javascript
// Update template version
await templateManager.updateTemplate(templateData, category);
```

### Version History
- Track version changes
- Maintain change logs
- Rollback capabilities

## Usage Tracking

### Metrics Collected
- Total executions
- Success/failure rates
- Average response times
- Token usage and costs
- User satisfaction scores

### Analytics Dashboard
```bash
GET /api/templates/analytics
GET /api/templates/:template/usage
```

### Usage Optimization
- Identify high-performing templates
- Detect problematic patterns
- Optimize based on metrics

## Template Validation

### Input Validation
- Variable name format checking
- Content length limits
- Suspicious pattern detection
- File format validation

### Security Checks
- Injection attack prevention
- Malicious code detection
- Variable sanitization
- Access control validation

### Quality Assurance
- Automated quality scoring
- Performance benchmarking
- A/B testing capabilities
- User feedback integration

## API Endpoints

### Template Management
```bash
# Get all templates
GET /api/templates

# Get templates by category
GET /api/templates/:category

# Get specific template
GET /api/templates/:category/:name

# Create new template
POST /api/templates

# Update template
PUT /api/templates/:category/:name

# Delete template
DELETE /api/templates/:category/:name
```

### Template Operations
```bash
# Generate with template
POST /api/generate
{
  "template": "business/customer_support",
  "variables": {
    "customer_name": "John Smith",
    "issue_description": "Login problem"
  }
}

# Validate template
POST /api/templates/validate

# Test template
POST /api/templates/:category/:name/test
```

## Best Practices

### Template Design
1. **Keep templates focused** - One clear purpose per template
2. **Use descriptive variables** - Clear, semantic variable names
3. **Include examples** - Show expected inputs/outputs
4. **Test thoroughly** - Validate with various inputs
5. **Document well** - Clear descriptions and instructions

### Performance Optimization
1. **Cache frequently used templates** - Reduce file I/O
2. **Optimize variable count** - Balance flexibility vs complexity
3. **Monitor usage patterns** - Identify optimization opportunities
4. **Regular cleanup** - Remove unused templates

### Security Considerations
1. **Validate all inputs** - Prevent injection attacks
2. **Sanitize variables** - Clean user-provided content
3. **Control access** - Implement proper authorization
4. **Audit usage** - Track template access and modifications

## Troubleshooting

### Common Issues

**Template Not Found**
- Check file path and naming
- Verify category structure
- Refresh template cache

**Variable Errors**
- Validate variable names (alphanumeric + underscore)
- Check variable definitions file
- Ensure all required variables provided

**Quality Score Low**
- Review scoring criteria
- Add missing structure elements
- Improve content organization

**Performance Issues**
- Check template file sizes
- Optimize variable complexity
- Review caching settings

### Debug Commands
```bash
# Check template registry
cat config/template-registry.json

# Validate template syntax
node -e "require('./core/template_manager.js')"

# Test template loading
curl http://localhost:3000/api/templates/test
```

## Integration with n8n

### Workflow Integration
Templates can be used in n8n workflows through:

1. **HTTP Request nodes** calling the API
2. **Function nodes** with direct template calls
3. **Webhook triggers** for template generation
4. **Database nodes** for template storage

### Example n8n Workflow
```json
{
  "nodes": [
    {
      "name": "Generate Response",
      "type": "n8n-nodes-base.httpRequest",
      "parameters": {
        "url": "http://localhost:3000/api/generate",
        "method": "POST",
        "body": {
          "template": "business/customer_support",
          "variables": "={{$json}}"
        }
      }
    }
  ]
}
```

## Conclusion

The template management system provides a robust foundation for organizing, validating, and optimizing AI prompts. By following these guidelines and best practices, you can create high-quality templates that deliver consistent results while maintaining security and performance standards.