# Logging and Monitoring Documentation

## Overview

The n8n Claude Prompt System includes a comprehensive logging and monitoring system designed for production deployment. The system provides structured JSON logging, performance monitoring, security event tracking, and integration capabilities with external monitoring tools.

## Features

### 1. Application Logging Infrastructure

- **Structured JSON Logging**: All logs are output in JSON format for easy parsing by external tools
- **Multiple Log Levels**: Support for debug, info, warn, and error levels with filtering
- **Request Correlation IDs**: Every request gets a unique correlation ID for tracing across services
- **Performance Metrics Logging**: Automatic tracking of response times, memory usage, and other metrics

### 2. Security Event Logging

- **Authentication Attempts**: All login attempts (successful and failed) are logged
- **Security Policy Violations**: Rate limiting triggers, input validation failures
- **Attack Pattern Detection**: Monitoring for suspicious request patterns
- **Data Sanitization Events**: Logging when input data is sanitized or blocked

### 3. API Request/Response Monitoring

- **Request Logging**: All incoming API requests with sanitized parameters
- **Response Tracking**: Response codes, response times, and content length
- **Provider Usage Monitoring**: Claude API usage, rate limits, and costs
- **Error Response Logging**: Detailed error information for debugging

### 4. Health and Performance Monitoring

- **Health Check Endpoints**: Multiple endpoints for different monitoring needs
- **System Resource Monitoring**: CPU, memory, and disk usage tracking
- **Service Availability Checks**: Monitoring of external dependencies
- **Performance Metrics**: Real-time performance tracking and alerting

### 5. Production Alerting Integration

- **External Tool Compatibility**: Ready for ELK Stack, Splunk, Prometheus
- **Error Aggregation**: Automatic error rate calculation and alerting
- **Log Rotation and Retention**: Configurable log file management
- **GDPR Compliance**: Automatic sanitization of sensitive data

## Configuration

### Environment Variables

```bash
# Log Level (debug, info, warn, error)
LOG_LEVEL=info

# Node Environment
NODE_ENV=production

# API Keys for authentication monitoring
API_KEYS=key1,key2,key3
```

### Logging Configuration

The logging system can be configured via `config/logging-config.json`:

```json
{
  "logging": {
    "level": "info",
    "logDir": "./logs",
    "maxFiles": "30d",
    "maxSize": "100m",
    "enableRotation": true
  },
  "monitoring": {
    "metricsInterval": 60000,
    "enableAlerting": true,
    "alertThresholds": {
      "errorRate": 5.0,
      "responseTime": 5000
    }
  }
}
```

## Log File Structure

The system creates several log files:

### Application Logs
- `logs/application-YYYY-MM-DD.log` - All application events
- `logs/error-YYYY-MM-DD.log` - Error events only
- `logs/security-YYYY-MM-DD.log` - Security events only

### Log Entry Format

All log entries follow this JSON structure:

```json
{
  "timestamp": "2024-01-01T12:00:00.000Z",
  "level": "info",
  "service": "n8n-claude-prompt-system",
  "version": "1.0.0",
  "environment": "production",
  "message": "API Request",
  "correlationId": "req_1704110400000_abc123",
  "eventType": "api_request",
  "method": "POST",
  "url": "/api/generate",
  "statusCode": 200,
  "responseTime": "250ms",
  "ip": "192.168.1.100",
  "userAgent": "Mozilla/5.0..."
}
```

## API Endpoints

### Health Monitoring

- `GET /api/health` - Overall system health
- `GET /api/health/ready` - Readiness check for load balancers
- `GET /api/health/live` - Liveness check for container orchestration

### Metrics

- `GET /api/metrics` - Basic system metrics
- `GET /api/monitoring` - Comprehensive monitoring data

### Example Health Response

```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "uptime": {
    "seconds": 3600,
    "human": "1h 0m 0s"
  },
  "services": {
    "templateManager": {
      "status": "healthy",
      "lastCheck": "2024-01-01T12:00:00.000Z"
    },
    "provider_claude": {
      "status": "healthy",
      "lastCheck": "2024-01-01T12:00:00.000Z"
    }
  }
}
```

## Event Types

### Application Events

- `server_start` - Server startup
- `server_shutdown` - Server shutdown
- `provider_initialization` - Provider setup
- `health_monitoring_start` - Health monitoring started

### Request/Response Events

- `api_request` - Incoming API request
- `api_response` - API response sent
- `performance` - Performance metrics

### Security Events

- `auth_success` - Successful authentication
- `auth_failure` - Failed authentication attempt
- `rate_limit_triggered` - Rate limit exceeded
- `input_validation_failure` - Invalid input detected
- `input_sanitization` - Input data sanitized

### Business Events

- `provider_usage` - AI provider usage
- `generation_request_started` - Content generation started
- `generation_request_completed` - Content generation completed
- `generation_request_failed` - Content generation failed

## Data Privacy and GDPR Compliance

### Automatic Data Sanitization

The system automatically removes or redacts sensitive information:

- API keys and tokens
- Passwords and secrets
- Personal identifiable information
- Long text content (truncated)

### Sensitive Field Detection

The following fields are automatically redacted:
- `password`, `secret`, `token`, `key`
- `apikey`, `api_key`, `authorization`
- `auth`, `bearer`, `cookie`, `session`
- `x-api-key`, `anthropic_api_key`

### Log Retention

- Development: 7 days retention
- Production: 90 days retention
- Automatic log rotation daily
- Configurable compression

## Integration with External Tools

### ELK Stack (Elasticsearch, Logstash, Kibana)

1. Configure Logstash to read from log files
2. Set up index patterns in Kibana
3. Create dashboards for monitoring

Example Logstash configuration:
```yaml
input {
  file {
    path => "/path/to/logs/application-*.log"
    start_position => "beginning"
    codec => "json"
  }
}

output {
  elasticsearch {
    hosts => ["localhost:9200"]
    index => "n8n-claude-logs-%{+YYYY.MM.dd}"
  }
}
```

### Splunk

1. Configure Splunk Universal Forwarder
2. Set up JSON parsing
3. Create custom dashboards

### Prometheus

The system can be extended to export metrics to Prometheus:

```javascript
// Example metrics endpoint for Prometheus
app.get('/metrics', (req, res) => {
  const metrics = monitoring.getMetrics();
  res.set('Content-Type', 'text/plain');
  res.send(prometheus.format(metrics));
});
```

### Webhook Alerts

Configure webhook endpoints for real-time alerting:

```json
{
  "integration": {
    "webhook": {
      "enabled": true,
      "alertEndpoint": "https://your-webhook-url",
      "headers": {
        "Authorization": "Bearer your-token"
      }
    }
  }
}
```

## Monitoring Dashboards

### Key Metrics to Monitor

1. **Request Metrics**
   - Total requests per minute
   - Error rate percentage
   - Average response time
   - P95/P99 response times

2. **Security Metrics**
   - Authentication failures
   - Rate limit triggers
   - Input validation failures
   - Suspicious request patterns

3. **System Metrics**
   - CPU usage percentage
   - Memory usage percentage
   - Disk usage percentage
   - Service health status

4. **Business Metrics**
   - AI provider usage
   - Template usage statistics
   - Generation success rate
   - Cost tracking

### Alert Thresholds

Default alert thresholds (configurable):

- Error rate > 5%
- Average response time > 5 seconds
- Memory usage > 85%
- CPU usage > 80%
- Failed authentication attempts > 10/hour

## Performance Considerations

### Minimal Performance Impact

- Asynchronous logging operations
- Configurable log levels
- Efficient JSON serialization
- Background metric collection

### Memory Management

- Automatic cleanup of old correlation IDs
- Configurable metric retention periods
- Log file rotation to prevent disk exhaustion

### Production Optimization

- Disable debug logging in production
- Use file-only logging (no console output)
- Enable log compression
- Set appropriate retention policies

## Troubleshooting

### Common Issues

1. **High Log Volume**
   - Increase log level to 'warn' or 'error'
   - Reduce metric collection interval
   - Enable log compression

2. **Disk Space Issues**
   - Reduce log retention period
   - Enable log rotation
   - Monitor disk usage alerts

3. **Performance Impact**
   - Disable console logging in production
   - Increase metrics collection interval
   - Optimize log file I/O

### Debug Mode

Enable debug logging for troubleshooting:

```bash
LOG_LEVEL=debug npm start
```

This will provide detailed logs for all operations.

## Security Considerations

### Log Security

- Logs contain no sensitive authentication data
- Automatic sanitization of user input
- Secure log file permissions
- Regular log rotation and cleanup

### Monitoring Security

- Health check endpoints require authentication
- Metrics endpoints can be secured separately
- Rate limiting on monitoring endpoints
- Audit logging for administrative actions

## Maintenance

### Regular Tasks

1. Monitor log file sizes and disk usage
2. Review error rates and investigate patterns
3. Update alert thresholds based on baseline metrics
4. Archive old log files as needed
5. Test external monitoring integrations

### Log Analysis

Use the correlation IDs to trace requests across the system:

```bash
# Find all logs for a specific request
grep "req_1704110400000_abc123" logs/application-*.log

# Analyze error patterns
grep '"level":"error"' logs/error-*.log | jq '.message'

# Monitor authentication failures
grep '"eventType":"auth_failure"' logs/security-*.log
```

This comprehensive logging and monitoring system provides enterprise-grade observability for the n8n Claude Prompt System, ensuring reliable operation and easy troubleshooting in production environments.