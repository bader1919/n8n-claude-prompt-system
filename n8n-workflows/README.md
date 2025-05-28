# n8n Workflow Files

## Master Template Processor

This is the core workflow that handles template fetching, variable processing, and Claude API integration.

### Required Input Format:
```json
{
  "template_name": "customer_support_template",
  "template_category": "business_operations", 
  "variables": {
    "company_name": "Your Company",
    "customer_issue": "Login problems",
    "priority_level": "High",
    "account_type": "Premium",
    "tone": "empathetic",
    "response_time": "2 hours",
    "issue_category": "Technical"
  }
}
```

### Workflow Components:
1. **Manual Trigger** - Receives template and variable data
2. **Fetch Template** - Downloads template from GitHub
3. **Process Variables** - Validates and injects variables
4. **Claude API Call** - Sends processed prompt to Claude
5. **Response Handler** - Processes and logs the response

### Setup Instructions:
1. Import the workflow JSON into your n8n instance
2. Set up environment variable: `ANTHROPIC_API_KEY`
3. Configure GitHub access if using private templates
4. Test with sample data

### Environment Variables Needed:
- `ANTHROPIC_API_KEY`: Your Anthropic API key for Claude access