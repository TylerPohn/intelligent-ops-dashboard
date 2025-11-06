# AI Analysis Lambda

## Overview

This Lambda function provides AI-powered analysis of InfiniBand storage metrics using AWS Bedrock (Claude 3.5 Haiku) and optionally SageMaker endpoints.

## Features

- **Multi-Source AI**: Primary SageMaker support with Bedrock fallback
- **Exponential Backoff**: Automatic retry with 1s, 2s, 4s backoff for throttling/timeouts
- **Rules-Based Fallback**: Pattern matching when AI services are unavailable
- **InfiniBand Optimization**: Specialized prompts for storage protocol analysis
- **Risk Detection**: Automatic EventBridge alerts for risk scores ≥80
- **DynamoDB Persistence**: 30-day TTL for insights

## Configuration

### Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `USE_SAGEMAKER` | Enable SageMaker endpoint | `false` | No |
| `SAGEMAKER_ENDPOINT` | SageMaker endpoint name | - | If USE_SAGEMAKER=true |
| `AWS_REGION` | AWS region | `us-east-1` | No |
| `INSIGHTS_TABLE` | DynamoDB table name | `IOPSInsights` | No |
| `EVENT_BUS_NAME` | EventBridge bus | `default` | No |

### Model Configuration

- **Bedrock Model**: `anthropic.claude-3-5-haiku-20241022-v1:0`
- **Temperature**: `0.3` (consistent analysis)
- **Max Retries**: `3`
- **Backoff**: Exponential (1s → 2s → 4s)

## Analysis Flow

```
Input Metrics → SageMaker (if enabled)
                    ↓ (on failure)
                Bedrock with Retry
                    ↓ (on failure)
                Rules-Based Analysis
                    ↓
                DynamoDB Write
                    ↓
            EventBridge (if risk ≥ 80)
```

## Input Format

```json
{
  "timestamp": 1699564800000,
  "nodeId": "ib-node-01",
  "iops": 85000,
  "latency": 12.5,
  "errorRate": 0.8,
  "throughput": 1250,
  "queueDepth": 48,
  "activeConnections": 24
}
```

## Output Format

```json
{
  "success": true,
  "insight": {
    "timestamp": 1699564800000,
    "nodeId": "ib-node-01",
    "riskScore": 75,
    "analysis": "High latency detected...",
    "recommendations": [
      "Investigate network congestion",
      "Scale storage tier"
    ],
    "source": "bedrock",
    "modelUsed": "anthropic.claude-3-5-haiku-20241022-v1:0"
  }
}
```

## Rules-Based Thresholds

| Metric | Threshold | Risk Weight |
|--------|-----------|-------------|
| IOPS | >100,000 | +20 |
| Latency | >10ms | +25 |
| Error Rate | >1% | +30 |
| Queue Depth | >64 | +15 |
| Throughput/IOPS | <1000 MB/s @ >50K IOPS | +10 |

## IAM Permissions Required

```json
{
  "Effect": "Allow",
  "Action": [
    "bedrock:InvokeModel",
    "sagemaker:InvokeEndpoint",
    "dynamodb:PutItem",
    "events:PutEvents"
  ],
  "Resource": "*"
}
```

## Deployment

This Lambda is deployed as part of the CDK stack in `/cdk` directory.

## Testing

```bash
# Local invocation
npm test

# With test event
npm run test:event
```

## Monitoring

- **CloudWatch Logs**: `/aws/lambda/iops-ai-analysis`
- **Metrics**: Duration, Errors, Throttles
- **X-Ray**: Distributed tracing enabled

## Canary Deployment Strategy

1. **Phase 1**: Deploy with `USE_SAGEMAKER=false` (Bedrock only)
2. **Phase 2**: Enable SageMaker for 10% traffic
3. **Phase 3**: Gradually increase to 100%
4. **Rollback**: Set `USE_SAGEMAKER=false` if issues detected
