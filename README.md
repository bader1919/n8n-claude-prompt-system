# n8n Claude Prompt System

A comprehensive, production-ready template management framework for integrating Claude AI with n8n workflows. This system provides secure, scalable prompt template management with comprehensive monitoring, authentication, and deployment capabilities.

## 🚀 Features

### Core Functionality
- **Template Management**: Automatic discovery, validation, and quality scoring
- **Multi-Provider Support**: Claude, OpenAI, and local LLM providers
- **n8n Integration**: Seamless workflow integration with REST API
- **Version Control**: Semantic versioning with change tracking

### Security & Authentication
- **Input Sanitization**: Comprehensive validation against injection attacks
- **API Key Authentication**: Secure access control with rate limiting
- **Error Handling**: Sanitized error messages without information disclosure
- **HTTPS Support**: Production-ready SSL/TLS configuration

### Monitoring & Operations
- **Health Checks**: Comprehensive service monitoring with readiness/liveness probes
- **Metrics Collection**: Performance tracking and usage analytics
- **Request Monitoring**: Real-time request/response tracking
- **Logging**: Structured logging with configurable levels

### Deployment & DevOps
- **Docker Support**: Multi-stage production builds with security best practices
- **Kubernetes Ready**: Complete K8s manifests with auto-scaling
- **CI/CD Pipeline**: GitHub Actions with automated testing and deployment
- **Environment Management**: Comprehensive configuration management

## 🏗️ Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   n8n Workflow │────│   API Gateway    │────│  Claude API     │
└─────────────────┘    │  (Rate Limiting) │    └─────────────────┘
                       │  (Authentication)│
┌─────────────────┐    │  (Input Valid.)  │    ┌─────────────────┐
│  External Apps  │────│                  │────│  OpenAI API     │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │
                       ┌──────────────────┐
                       │ Template Manager │
                       │ - Discovery      │
                       │ - Validation     │
                       │ - Caching        │
                       │ - Quality Score  │
                       └──────────────────┘
```

## 📦 Quick Start

### Prerequisites
- Node.js 16.x or higher
- Docker (optional, for containerized deployment)
- Anthropic API key

### Installation

```bash
# Clone the repository
git clone https://github.com/bader1919/n8n-claude-prompt-system.git
cd n8n-claude-prompt-system

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your API keys and configuration
```

### Configuration

Edit `.env` file:

```bash
# Required
ANTHROPIC_API_KEY=sk-ant-your-api-key-here
API_KEYS=your-secure-api-key,another-key

# Optional
NODE_ENV=development
PORT=3000
LOG_LEVEL=info
```

### Running the Application

```bash
# Development
npm run dev

# Production
npm start

# Using Docker
docker-compose up -d
```

### Health Check

```bash
curl http://localhost:3000/api/health
```

## 🔧 API Usage

### Authentication

All API requests require authentication via API key:

```bash
curl -H "x-api-key: your-api-key" http://localhost:3000/api/templates
```

### Generate Completion

```bash
curl -X POST http://localhost:3000/api/generate \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key" \
  -d '{
    "template": "business/customer_support",
    "variables": {
      "customer_name": "John Doe",
      "issue_description": "Login problem",
      "urgency_level": "high"
    },
    "options": {
      "temperature": 0.7,
      "maxTokens": 1000
    }
  }'
```

### List Templates

```bash
# All templates
curl -H "x-api-key: your-api-key" http://localhost:3000/api/templates

# By category
curl -H "x-api-key: your-api-key" http://localhost:3000/api/templates/business
```

### System Metrics

```bash
curl -H "x-api-key: your-api-key" http://localhost:3000/api/metrics
```

## 🐳 Docker Deployment

### Quick Deploy

```bash
# Build and run
docker-compose up -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f
```

### Production Deployment

```bash
# Use production compose file
docker-compose -f docker-compose.prod.yml up -d
```

### Kubernetes

```bash
# Deploy to Kubernetes
kubectl apply -f k8s-deployment.yaml

# Scale horizontally
kubectl scale deployment n8n-claude-prompt-system --replicas=3
```

## 🧪 Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run linter
npm run lint

# Fix linting issues
npm run lint:fix
```

### Test Coverage

- **Security**: Input validation, authentication, sanitization
- **API Endpoints**: All REST endpoints with various scenarios
- **Providers**: Claude API integration and error handling
- **Error Handling**: Comprehensive error scenarios

## 📊 Monitoring

### Health Endpoints

- `/api/health` - Overall system health
- `/api/health/ready` - Readiness probe (for load balancers)
- `/api/health/live` - Liveness probe (for container orchestration)
- `/api/metrics` - Performance and usage metrics

### Metrics Collected

- Request count and error rates
- Response time percentiles
- Template usage statistics
- Provider performance metrics
- System resource utilization

## 🔒 Security Features

### Input Validation
- Template injection prevention
- Variable sanitization
- Malicious pattern detection
- Content length limits

### Authentication & Authorization
- API key-based authentication
- Rate limiting per key
- Request origin validation
- Secure error responses

### Production Security
- HTTPS enforcement
- Security headers (Helmet)
- Non-root container execution
- Secrets management best practices

## 📝 Template Management

### Creating Templates

1. Create template file in `templates/category/name.txt`
2. Define variables using `{{variable_name}}` syntax
3. Create variable definitions in `variables/name.json`
4. System automatically discovers and validates

### Template Structure

```
Instructions: Clear instructions for the AI
Context: Background information about the task
Variables: {{variable_name}} placeholders
Output: Expected response format

Example content...
```

### Quality Scoring

Templates are automatically scored (0-100) based on:
- Structure completeness
- Variable usage
- Content quality
- Best practices compliance

## 🚀 Advanced Features

### Multi-Provider Support
- **Claude**: Latest Anthropic API with proper error handling
- **OpenAI**: GPT models with function calling
- **Local**: Support for local LLM deployments

### Performance Optimization
- Template caching with TTL
- Response time tracking
- Automatic rate limiting
- Resource usage monitoring

### Integration Ready
- **n8n Workflows**: Pre-built workflow templates
- **REST API**: Complete OpenAPI specification
- **Webhook Support**: Event-driven template updates
- **Database Ready**: Schema for persistent storage

## 📚 Documentation

- **[Setup Guide](SETUP_GUIDE.md)**: Comprehensive setup instructions
- **[Template Management](TEMPLATE_MANAGEMENT.md)**: Template creation and management
- **[Deployment Guide](DEPLOYMENT_GUIDE.md)**: Production deployment instructions
- **[API Documentation](docs/api.md)**: Complete API reference

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Run tests (`npm test`)
4. Commit changes (`git commit -m 'Add amazing feature'`)
5. Push to branch (`git push origin feature/amazing-feature`)
6. Open Pull Request

### Development Setup

```bash
# Install development dependencies
npm install

# Run in development mode with auto-reload
npm run dev

# Run tests with coverage
npm run test:coverage

# Lint and fix code style
npm run lint:fix
```

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

- **Issues**: [GitHub Issues](https://github.com/bader1919/n8n-claude-prompt-system/issues)
- **Discussions**: [GitHub Discussions](https://github.com/bader1919/n8n-claude-prompt-system/discussions)
- **Documentation**: [Wiki](https://github.com/bader1919/n8n-claude-prompt-system/wiki)

## 🎯 Roadmap

- [ ] Database integration for persistent storage
- [ ] Advanced analytics and reporting
- [ ] Template marketplace
- [ ] Multi-tenant support
- [ ] Advanced caching strategies
- [ ] GraphQL API
- [ ] Real-time collaboration features

---

**Note**: This system is designed for production use with comprehensive security, monitoring, and deployment features. For development purposes, see the simplified setup in the basic branch.