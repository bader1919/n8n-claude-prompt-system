# Production Deployment Guide

This guide provides comprehensive instructions for deploying the n8n Claude Prompt System in production environments.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Environment Setup](#environment-setup)
3. [Docker Deployment](#docker-deployment)
4. [Kubernetes Deployment](#kubernetes-deployment)
5. [Security Configuration](#security-configuration)
6. [Monitoring and Logging](#monitoring-and-logging)
7. [Backup and Recovery](#backup-and-recovery)
8. [Troubleshooting](#troubleshooting)

## Prerequisites

### System Requirements

- **Node.js**: Version 16.x or higher
- **Docker**: Version 20.x or higher (for containerized deployment)
- **Memory**: Minimum 512MB RAM, recommended 2GB+
- **Storage**: Minimum 1GB free space
- **Network**: HTTPS capability for production

### Required API Keys

- **Anthropic API Key**: For Claude provider functionality
- **OpenAI API Key**: Optional, for OpenAI provider
- **API Keys**: For authentication (generate secure keys)

## Environment Setup

### 1. Clone and Configure

```bash
# Clone the repository
git clone https://github.com/bader1919/n8n-claude-prompt-system.git
cd n8n-claude-prompt-system

# Copy environment template
cp .env.example .env
```

### 2. Configure Environment Variables

Edit `.env` file with your production values:

```bash
# Production Environment
NODE_ENV=production
PORT=3000
HOST=0.0.0.0

# API Keys (REQUIRED)
ANTHROPIC_API_KEY=sk-ant-your-production-api-key-here
API_KEYS=prod-key-1,prod-key-2,admin-key-3

# Security Settings
ENABLE_HTTPS=true
CORS_ORIGINS=https://your-domain.com,https://n8n.your-domain.com
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# Logging
LOG_LEVEL=warn
ENABLE_DEBUG_MODE=false
ENABLE_VERBOSE_LOGGING=false
SANITIZE_ERRORS=true

# Production Security
ENABLE_STACK_TRACES=false
ENABLE_MOCK_PROVIDERS=false
```

### 3. SSL Certificate Setup

For HTTPS in production:

```bash
# Generate SSL certificates (Let's Encrypt recommended)
sudo certbot certonly --standalone -d your-domain.com

# Update environment
ENABLE_HTTPS=true
SSL_CERT_PATH=/etc/letsencrypt/live/your-domain.com/fullchain.pem
SSL_KEY_PATH=/etc/letsencrypt/live/your-domain.com/privkey.pem
```

## Docker Deployment

### 1. Build Production Image

```bash
# Build optimized production image
docker build -t n8n-claude-prompt-system:prod .

# Or pull from registry
docker pull your-registry/n8n-claude-prompt-system:latest
```

### 2. Docker Compose Production

Create `docker-compose.prod.yml`:

```yaml
version: '3.8'

services:
  n8n-claude-prompt-system:
    image: n8n-claude-prompt-system:prod
    ports:
      - "443:3000"
    environment:
      - NODE_ENV=production
    env_file:
      - .env
    volumes:
      - ./templates:/app/templates:ro
      - ./config:/app/config:rw
      - ./ssl:/app/ssl:ro
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3000/api/health/live"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    networks:
      - production

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./ssl:/etc/ssl:ro
    depends_on:
      - n8n-claude-prompt-system
    restart: unless-stopped
    networks:
      - production

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes --requirepass ${REDIS_PASSWORD}
    volumes:
      - redis_data:/data
    networks:
      - production
    restart: unless-stopped

networks:
  production:
    driver: bridge

volumes:
  redis_data:
```

### 3. Nginx Configuration

Create `nginx.conf`:

```nginx
events {
    worker_connections 1024;
}

http {
    upstream app {
        server n8n-claude-prompt-system:3000;
    }

    server {
        listen 80;
        server_name your-domain.com;
        return 301 https://$server_name$request_uri;
    }

    server {
        listen 443 ssl http2;
        server_name your-domain.com;

        ssl_certificate /etc/ssl/fullchain.pem;
        ssl_certificate_key /etc/ssl/privkey.pem;

        # Security headers
        add_header X-Frame-Options DENY;
        add_header X-Content-Type-Options nosniff;
        add_header X-XSS-Protection "1; mode=block";
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains";

        location / {
            proxy_pass http://app;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        location /api/health {
            proxy_pass http://app;
            access_log off;
        }
    }
}
```

### 4. Deploy with Docker Compose

```bash
# Deploy to production
docker-compose -f docker-compose.prod.yml up -d

# Check status
docker-compose -f docker-compose.prod.yml ps

# View logs
docker-compose -f docker-compose.prod.yml logs -f
```

## Kubernetes Deployment

### 1. Deployment Manifest

Create `k8s-deployment.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: n8n-claude-prompt-system
  labels:
    app: n8n-claude-prompt-system
spec:
  replicas: 3
  selector:
    matchLabels:
      app: n8n-claude-prompt-system
  template:
    metadata:
      labels:
        app: n8n-claude-prompt-system
    spec:
      containers:
      - name: app
        image: n8n-claude-prompt-system:prod
        ports:
        - containerPort: 3000
        env:
        - name: NODE_ENV
          value: "production"
        envFrom:
        - secretRef:
            name: app-secrets
        resources:
          requests:
            memory: "256Mi"
            cpu: "100m"
          limits:
            memory: "1Gi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /api/health/live
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /api/health/ready
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
        volumeMounts:
        - name: config-volume
          mountPath: /app/config
        - name: templates-volume
          mountPath: /app/templates
      volumes:
      - name: config-volume
        configMap:
          name: app-config
      - name: templates-volume
        configMap:
          name: app-templates
---
apiVersion: v1
kind: Service
metadata:
  name: n8n-claude-prompt-system-service
spec:
  selector:
    app: n8n-claude-prompt-system
  ports:
  - protocol: TCP
    port: 80
    targetPort: 3000
  type: ClusterIP
```

### 2. Secrets Configuration

```bash
# Create secrets
kubectl create secret generic app-secrets \
  --from-literal=ANTHROPIC_API_KEY="your-api-key" \
  --from-literal=API_KEYS="prod-key-1,prod-key-2"

# Create ConfigMaps
kubectl create configmap app-config \
  --from-file=config/

kubectl create configmap app-templates \
  --from-file=templates/
```

### 3. Deploy to Kubernetes

```bash
# Apply deployment
kubectl apply -f k8s-deployment.yaml

# Check status
kubectl get pods -l app=n8n-claude-prompt-system
kubectl get services

# View logs
kubectl logs -l app=n8n-claude-prompt-system -f
```

## Security Configuration

### 1. API Key Management

```bash
# Generate secure API keys
openssl rand -hex 32  # For each API key

# Store in environment or secrets manager
export API_KEYS="$(openssl rand -hex 32),$(openssl rand -hex 32)"
```

### 2. Network Security

- **Firewall**: Allow only ports 80, 443
- **VPC**: Deploy in private subnet with NAT gateway
- **WAF**: Use Web Application Firewall for additional protection

### 3. Application Security

- **Rate Limiting**: Configured per API key
- **Input Validation**: All inputs sanitized
- **Error Handling**: Sensitive information hidden
- **HTTPS**: Enforced in production

## Monitoring and Logging

### 1. Health Monitoring

```bash
# Health check endpoints
curl https://your-domain.com/api/health
curl https://your-domain.com/api/health/ready
curl https://your-domain.com/api/health/live
```

### 2. Metrics Collection

```bash
# Get system metrics
curl -H "x-api-key: your-api-key" https://your-domain.com/api/metrics
```

### 3. Log Configuration

For centralized logging:

```bash
# Using Docker logging driver
docker run --log-driver=syslog --log-opt syslog-address=tcp://log-server:514

# Using ELK Stack
docker run -e ELASTICSEARCH_URL=http://elasticsearch:9200
```

### 4. Monitoring Setup

**Prometheus Configuration** (`prometheus.yml`):

```yaml
scrape_configs:
- job_name: 'n8n-claude-prompt-system'
  static_configs:
  - targets: ['app:3000']
  metrics_path: '/api/metrics'
  scheme: 'https'
```

**Grafana Dashboard**: Import dashboard for system metrics visualization

## Backup and Recovery

### 1. Configuration Backup

```bash
# Backup configuration
tar -czf backup-$(date +%Y%m%d).tar.gz config/ templates/ .env

# Store in secure location
aws s3 cp backup-$(date +%Y%m%d).tar.gz s3://your-backup-bucket/
```

### 2. Template Backup

```bash
# Automated backup script
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
tar -czf templates-backup-$DATE.tar.gz templates/
find . -name "templates-backup-*.tar.gz" -mtime +30 -delete
```

### 3. Recovery Procedures

```bash
# Restore from backup
tar -xzf backup-20241218.tar.gz
docker-compose -f docker-compose.prod.yml restart
```

## Troubleshooting

### Common Issues

#### 1. Application Won't Start

```bash
# Check logs
docker-compose logs n8n-claude-prompt-system

# Common solutions
- Verify API keys in .env
- Check port availability
- Validate configuration files
```

#### 2. Authentication Failures

```bash
# Test API key
curl -H "x-api-key: your-key" https://your-domain.com/api/health

# Solutions
- Verify API_KEYS environment variable
- Check key format and encoding
```

#### 3. High Response Times

```bash
# Check metrics
curl -H "x-api-key: your-key" https://your-domain.com/api/metrics

# Solutions
- Scale horizontally (add replicas)
- Optimize template sizes
- Enable caching
```

#### 4. Health Check Failures

```bash
# Check service health
kubectl describe pod <pod-name>

# Solutions
- Verify health endpoints
- Check resource limits
- Review container logs
```

### Performance Optimization

#### 1. Scaling

```bash
# Docker Compose
docker-compose -f docker-compose.prod.yml up -d --scale n8n-claude-prompt-system=3

# Kubernetes
kubectl scale deployment n8n-claude-prompt-system --replicas=5
```

#### 2. Caching

- Enable Redis for template caching
- Configure response caching for static content
- Use CDN for static assets

#### 3. Load Balancing

- Use Nginx for load balancing
- Configure health checks
- Implement session affinity if needed

### Disaster Recovery

1. **Regular Backups**: Automated daily backups
2. **Multi-Region**: Deploy in multiple regions
3. **Database Replication**: If using external database
4. **Monitoring**: 24/7 monitoring with alerts

## Security Checklist

- [ ] API keys properly secured
- [ ] HTTPS enforced
- [ ] Rate limiting configured
- [ ] Input validation enabled
- [ ] Error messages sanitized
- [ ] Security headers configured
- [ ] Container running as non-root user
- [ ] Network segmentation implemented
- [ ] Monitoring and alerting active
- [ ] Backup procedures tested

## Conclusion

This deployment guide provides a comprehensive approach to running the n8n Claude Prompt System in production. Regular monitoring, security updates, and backup procedures are essential for maintaining a secure and reliable service.

For additional support, refer to the troubleshooting section or contact the development team.