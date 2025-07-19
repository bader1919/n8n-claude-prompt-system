# 680 Quick Setup Guide

## Prerequisites
- n8n instance (Cloud or Self-hosted)
- Anthropic API key for Claude access
- GitHub account (for template storage)

## Step 1: Environment Setup

### 1.1 Set Environment Variables in n8n
```bash
ANTHROPIC_API_KEY=your_anthropic_api_key_here
GITHUB_TOKEN=your_github_token_here  # Optional, for private repos
```

### 1.2 Enable Required Nodes
Ensure these nodes are available in your n8n instance:
- HTTP Request
- Code (JavaScript)
- Manual Trigger
- Webhook

## Step 2: Import Workflows

### 2.1 Template Fetcher (Part 1)
1. Go to n8n  Workflows  Import from File
2. Upload `n8n-workflows/part1-template-fetcher.json`
3. Activate the workflow

### 2.2 Claude Processor (Part 2)
1. Import `n8n-workflows/part2-claude-processor.json`
2. Note the webhook URL generated
3. Activate the workflow

## Step 3: Test the System

### 3.1 Test Template Fetching
1. Open "Template Fetcher - Part 1" workflow
2. Click "Execute Workflow" with this test data:
```json
{
  "template_name": "customer_support_template",
  "template_category": "business_operations",
  "variables": {
    "company_name": "Test Company",
    "customer_context": "Premium user",
    "customer_issue": "Login problem",
    "priority_level": "High",
    "account_type": "Premium",
    "tone": "empathetic",
    "response_time": "2 hours",
    "issue_category": "Technical"
  }
}
```

### 3.2 Test Full Pipeline
1. Take the output from Part 1
2. Send it to the Part 2 webhook
3. Verify Claude response is generated

## Step 4: Customize Templates

### 4.1 Fork This Repository
```bash
git clone https://github.com/bader1919/n8n-claude-prompt-system.git
cd n8n-claude-prompt-system
```

### 4.2 Create Your Templates
1. Add new `.txt` files in `templates/` folders
2. Define variables using `{{variable_name}}` syntax
3. Create corresponding variable definitions in `variables/`

### 4.3 Update Workflow URLs
Update the GitHub raw URL in your n8n workflows to point to your forked repository.

## Step 5: Production Deployment

### 5.1 Security
- Use environment variables for all API keys
- Consider using private GitHub repository
- Set up proper access controls in n8n

### 5.2 Monitoring
- Enable n8n workflow logging
- Set up alerts for failed executions
- Monitor Anthropic API usage and costs

### 5.3 Scaling
- Use n8n's queue mode for high-volume processing
- Implement caching for frequently used templates
- Consider template versioning for production stability

## Common Issues & Solutions

### Issue: "Template not found"
**Solution**: Check the GitHub URL format and repository access permissions

### Issue: "Missing required variables"
**Solution**: Review the variable definition files and ensure all required variables are provided

### Issue: "Claude API authentication failed"
**Solution**: Verify your `ANTHROPIC_API_KEY` environment variable is set correctly

### Issue: "Workflow execution timeout"
**Solution**: Increase n8n's execution timeout settings or optimize template size

## Next Steps

1. **Create Custom Templates**: Build templates specific to your business needs
2. **Set Up Analytics**: Connect to Power BI or other analytics tools
3. **Implement A/B Testing**: Use the framework provided in the documentation
4. **Scale Production**: Deploy monitoring and error handling

## Support

For issues or questions:
1. Check the `examples/` folder for sample requests
2. Review the main README.md for detailed documentation
3. Open an issue in this GitHub repository

---

389 **You're ready to start using your AI-powered prompt template system!** 389
