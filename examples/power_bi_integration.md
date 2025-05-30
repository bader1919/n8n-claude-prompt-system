# Power BI Integration Examples

## Overview
This document shows how to integrate the n8n Claude prompt system with Power BI for analytics and monitoring.

## 1. Template Usage Analytics

### Data Sources
Connect Power BI to your n8n execution logs or database where you store results:

```sql
-- Sample query for template usage analytics
SELECT 
    template_name,
    template_category,
    COUNT(*) as usage_count,
    AVG(DATEDIFF(second, start_time, end_time)) as avg_processing_time,
    SUM(tokens_used) as total_tokens,
    DATE(created_at) as date
FROM n8n_executions 
WHERE workflow_name LIKE '%Claude%'
GROUP BY template_name, template_category, DATE(created_at)
ORDER BY date DESC, usage_count DESC
```

### Power BI Measures
```dax
// Total Template Executions
Total Executions = COUNT(ExecutionLog[execution_id])

// Average Response Time
Avg Response Time = AVERAGE(ExecutionLog[processing_time_seconds])

// Token Cost Analysis (assuming $0.003 per 1K tokens for Claude)
Total Token Cost = 
    SUM(ExecutionLog[tokens_used]) * 0.003 / 1000

// Success Rate
Success Rate = 
    DIVIDE(
        COUNTROWS(FILTER(ExecutionLog, ExecutionLog[status] = "success")),
        COUNTROWS(ExecutionLog)
    ) * 100
```

## 2. Template Performance Dashboard

### Key Visualizations

#### 2.1 Template Usage Trends
- **Chart Type**: Line chart
- **X-Axis**: Date
- **Y-Axis**: Number of executions
- **Legend**: Template category
- **Filter**: Last 30 days

#### 2.2 Processing Time Analysis
- **Chart Type**: Box plot or scatter chart
- **X-Axis**: Template name
- **Y-Axis**: Processing time (seconds)
- **Size**: Token count
- **Color**: Success/Failure status

#### 2.3 Cost Analysis
```dax
// Monthly cost breakdown
Monthly Cost = 
    SUMX(
        VALUES(ExecutionLog[template_name]),
        CALCULATE(
            SUM(ExecutionLog[tokens_used]) * 0.003 / 1000,
            DATESINPERIOD(ExecutionLog[date], MAX(ExecutionLog[date]), -1, MONTH)
        )
    )
```

#### 2.4 Error Rate by Template
- **Chart Type**: Donut chart
- **Values**: Error count by template
- **Legend**: Template names
- **Tooltip**: Error details

## 3. Business Impact Metrics

### Customer Support Templates
```dax
// Customer satisfaction correlation
Support Satisfaction = 
    CALCULATE(
        AVERAGE(SupportTickets[satisfaction_score]),
        SupportTickets[used_ai_template] = TRUE
    )

// Response time improvement
AI vs Manual Response Time = 
    DIVIDE(
        CALCULATE(AVERAGE(SupportTickets[response_time]), SupportTickets[used_ai_template] = FALSE),
        CALCULATE(AVERAGE(SupportTickets[response_time]), SupportTickets[used_ai_template] = TRUE)
    ) - 1
```

### Content Performance
```dax
// Blog post engagement for AI-generated content
AI Content Engagement = 
    CALCULATE(
        AVERAGE(BlogPosts[engagement_rate]),
        BlogPosts[created_with_ai] = TRUE
    )
```

## 4. Data Connection Examples

### 4.1 Direct Database Connection
If storing n8n execution data in SQL database:

```json
{
  "connection_string": "Server=your-server;Database=n8n_analytics;Trusted_Connection=true;",
  "query": "SELECT * FROM execution_logs WHERE workflow_type = 'claude_template'"
}
```

### 4.2 REST API Connection
If using n8n webhook to send data to Power BI:

```javascript
// n8n webhook payload for Power BI
{
  "execution_id": "uuid",
  "template_name": "customer_support_template",
  "template_category": "business_operations",
  "start_time": "2025-01-15T10:30:00Z",
  "end_time": "2025-01-15T10:30:05Z",
  "tokens_used": 150,
  "cost_usd": 0.45,
  "status": "success",
  "variables_count": 8,
  "response_quality_score": 4.2
}
```

### 4.3 Excel/CSV Export
For simpler setups, export execution logs as CSV:

```csv
date,template_name,category,executions,avg_time,tokens,cost,success_rate
2025-01-15,customer_support_template,business_operations,25,3.2,3750,11.25,96%
2025-01-15,data_analysis_template,business_operations,12,8.1,7200,21.60,100%
2025-01-15,blog_post_template,content_creation,8,12.5,12000,36.00,87.5%
```

## 5. Alert Configuration

### Performance Alerts
```dax
// High processing time alert
Processing Time Alert = 
    IF(
        [Avg Response Time] > 10, // seconds
        " 26A0 A0High Processing Time",
        " 705 A0Normal"
    )

// High cost alert  
Cost Alert = 
    IF(
        [Total Token Cost] > 100, // USD per day
        " 6A8 A0High Daily Cost",
        " 705 A0Within Budget"
    )

// Low success rate alert
Success Alert = 
    IF(
        [Success Rate] < 95, // percentage
        " 74C A0Low Success Rate", 
        " 705 A0Healthy"
    )
```

## 6. Sample Power BI Report Structure

### Page 1: Executive Dashboard
- Total executions (card)
- Total cost (card) 
- Success rate (gauge)
- Template usage trends (line chart)
- Cost breakdown by category (pie chart)

### Page 2: Template Performance
- Processing time by template (bar chart)
- Token usage patterns (scatter plot)
- Error analysis (table with drill-down)
- Success rate trends (line chart)

### Page 3: Business Impact
- Customer satisfaction correlation
- Content engagement metrics
- ROI analysis
- Efficiency improvements

## 7. Refresh Schedule

### Automated Refresh
- **Frequency**: Every 4 hours during business hours
- **Data Source**: Direct database connection
- **Incremental**: Only fetch new records since last refresh

### Manual Refresh Triggers
- After major template updates
- Before executive presentations
- During system troubleshooting

---

This Power BI integration gives you complete visibility into your AI prompt system performance and business impact! 4CA
