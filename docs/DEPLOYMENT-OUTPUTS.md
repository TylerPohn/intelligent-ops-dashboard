# IOPS Dashboard - Deployment Outputs

**Deployment Date**: November 4, 2025
**Region**: us-east-2 (Ohio)

## 🚀 Core Stack Outputs

### API Gateway
- **Ingest API URL**: `https://dp41u4qn19.execute-api.us-east-2.amazonaws.com/prod/`
- **Ingest Endpoint**: `https://dp41u4qn19.execute-api.us-east-2.amazonaws.com/prod/ingest`

### EventBridge & SNS
- **Event Bus Name**: `iops-dashboard-alerts`
- **Event Bus ARN**: `arn:aws:events:us-east-2:971422717446:event-bus/iops-dashboard-alerts`
- **Critical Alerts Topic**: `arn:aws:sns:us-east-2:971422717446:iops-dashboard-critical-alerts`
- **Warning Alerts Topic**: `arn:aws:sns:us-east-2:971422717446:iops-dashboard-warning-alerts`
- **Info Alerts Topic**: `arn:aws:sns:us-east-2:971422717446:iops-dashboard-info-alerts`

### Dead Letter Queue
- **DLQ URL**: `https://sqs.us-east-2.amazonaws.com/971422717446/iops-dashboard-alert-dlq`
- **DLQ ARN**: `arn:aws:sqs:us-east-2:971422717446:iops-dashboard-alert-dlq`

### Lambda Functions
- **Simulator Function**: `IOpsDashboard-CoreStack-SimulatorFunctionD42EF994-cd8453lSxE5r`
- **Process Function**: `IOpsDashboard-CoreStack-ProcessFunction7E4ECD78-WUDOn8vzWuhD`
- **AI Function**: `IOpsDashboard-CoreStack-AIFunction3DD9AA07-StcOCQ4OUfo4`

### EventBridge Rule
- **Simulator Schedule**: `IOpsDashboard-CoreStack-SimulatorSchedule288280E4-84dlBbwVVZbI`

### Data Stores
- **DynamoDB Table**: `iops-dashboard-metrics`
- **DynamoDB Stream ARN**: `arn:aws:dynamodb:us-east-2:971422717446:table/iops-dashboard-metrics/stream/2025-11-04T21:14:00.447`
- **Kinesis Stream**: `iops-dashboard-events`

---

## 🌐 Experience Stack Outputs

### WebSocket API
- **WebSocket URL**: `wss://il7omaw929.execute-api.us-east-2.amazonaws.com/prod`
- **API ID**: `il7omaw929`

### Lambda Functions
- **Stream Processor**: `IOpsDashboard-ExperienceS-StreamProcessorFunctionC-7NEEOqG5nJf2`

### Data Stores
- **Connections Table**: `iops-dashboard-websocket-connections`

---

## ✅ Quick Start Commands

### Test Data Generation
```bash
# Invoke simulator manually
aws lambda invoke \
  --function-name IOpsDashboard-CoreStack-SimulatorFunctionD42EF994-cd8453lSxE5r \
  --payload '{}' \
  response.json

# Check response
cat response.json
```

### Enable Automatic Data Generation
```bash
# Enable EventBridge rule to run simulator every minute
aws events enable-rule \
  --name IOpsDashboard-CoreStack-SimulatorSchedule288280E4-84dlBbwVVZbI
```

### Test Alerts
```bash
# Get topic ARNs
CRITICAL_TOPIC="arn:aws:sns:us-east-2:971422717446:iops-dashboard-critical-alerts"
WARNING_TOPIC="arn:aws:sns:us-east-2:971422717446:iops-dashboard-warning-alerts"
INFO_TOPIC="arn:aws:sns:us-east-2:971422717446:iops-dashboard-info-alerts"

# Run test script
./scripts/test-alerts.sh $CRITICAL_TOPIC $WARNING_TOPIC $INFO_TOPIC
```

### Check Kinesis Stream
```bash
# Get shard iterator
SHARD_ITERATOR=$(aws kinesis get-shard-iterator \
  --stream-name iops-dashboard-events \
  --shard-id shardId-000000000000 \
  --shard-iterator-type LATEST \
  --query 'ShardIterator' \
  --output text)

# Get records
aws kinesis get-records --shard-iterator $SHARD_ITERATOR
```

### Monitor DynamoDB
```bash
# Scan table for metrics
aws dynamodb scan \
  --table-name iops-dashboard-metrics \
  --max-items 10
```

### Check CloudWatch Logs
```bash
# View simulator logs
aws logs tail /aws/lambda/IOpsDashboard-CoreStack-SimulatorFunctionD42EF994-cd8453lSxE5r --follow

# View processor logs
aws logs tail /aws/lambda/IOpsDashboard-CoreStack-ProcessFunction7E4ECD78-WUDOn8vzWuhD --follow

# View AI inference logs
aws logs tail /aws/lambda/IOpsDashboard-CoreStack-AIFunction3DD9AA07-StcOCQ4OUfo4 --follow
```

---

## 🎯 Frontend Configuration

Update `frontend/.env` with these values:

```bash
VITE_API_URL=https://dp41u4qn19.execute-api.us-east-2.amazonaws.com/prod
VITE_WEBSOCKET_URL=wss://il7omaw929.execute-api.us-east-2.amazonaws.com/prod
VITE_AWS_REGION=us-east-2
VITE_DYNAMODB_TABLE=iops-dashboard-metrics
VITE_KINESIS_STREAM=iops-dashboard-events
```

---

## 📧 Email Subscription

**IMPORTANT**: Confirm email subscriptions for SNS alerts!

1. Check your inbox for AWS SNS confirmation emails
2. Click "Confirm subscription" links
3. Verify subscriptions:

```bash
# Check critical alerts subscriptions
aws sns list-subscriptions-by-topic \
  --topic-arn arn:aws:sns:us-east-2:971422717446:iops-dashboard-critical-alerts

# Check warning alerts subscriptions
aws sns list-subscriptions-by-topic \
  --topic-arn arn:aws:sns:us-east-2:971422717446:iops-dashboard-warning-alerts

# Check info alerts subscriptions
aws sns list-subscriptions-by-topic \
  --topic-arn arn:aws:sns:us-east-2:971422717446:iops-dashboard-info-alerts
```

---

## 🔧 Troubleshooting

### Check Dead Letter Queue
```bash
# Check for failed messages
aws sqs get-queue-attributes \
  --queue-url https://sqs.us-east-2.amazonaws.com/971422717446/iops-dashboard-alert-dlq \
  --attribute-names ApproximateNumberOfMessages

# Retrieve failed messages
aws sqs receive-message \
  --queue-url https://sqs.us-east-2.amazonaws.com/971422717446/iops-dashboard-alert-dlq
```

### Check EventBridge Metrics
```bash
# Check rule invocations
aws cloudwatch get-metric-statistics \
  --namespace AWS/Events \
  --metric-name Invocations \
  --dimensions Name=RuleName,Value=IOpsDashboard-CoreStack-SimulatorSchedule288280E4-84dlBbwVVZbI \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum
```

---

## 🧹 Cleanup

To delete all resources:

```bash
cd cdk
cdk destroy --all
```

---

**Status**: ✅ All infrastructure deployed successfully!
