# PR-07: EventBridge + SNS Alerts - Deployment Guide

## Summary

Successfully implemented EventBridge + SNS Alerts system with:
- Custom EventBridge event bus for alert routing
- Three SNS topics (critical, warning, info) with email subscriptions
- Dead Letter Queue (DLQ) for failed notifications
- Alert formatting Lambda (TypeScript)
- Comprehensive test script

## Files Created

### Lambda Functions
- `/Users/tyler/Desktop/Gauntlet/iops-dashboard/lambda/alert/format-alert.ts` - Alert email formatter
- `/Users/tyler/Desktop/Gauntlet/iops-dashboard/lambda/alert/package.json` - Dependencies
- `/Users/tyler/Desktop/Gauntlet/iops-dashboard/lambda/alert/tsconfig.json` - TypeScript config
- `/Users/tyler/Desktop/Gauntlet/iops-dashboard/lambda/alert/.gitignore` - Git ignore

### Scripts
- `/Users/tyler/Desktop/Gauntlet/iops-dashboard/scripts/test-alerts.sh` - Testing script (executable)

### Updated Files
- `/Users/tyler/Desktop/Gauntlet/iops-dashboard/cdk/lib/cdk-stack.ts` - Added EventBridge, SNS, and SQS resources

## Architecture Overview

```
Processing Lambda → EventBridge Bus (iops-dashboard-alerts)
                    ↓
                    EventBridge Rules (by severity)
                    ↓
                    ├─ Critical Rule → SNS Critical Topic → Email Subscribers
                    ├─ Warning Rule  → SNS Warning Topic  → Email Subscribers
                    └─ Info Rule     → SNS Info Topic     → Email Subscribers

                    Failed Messages → DLQ (14-day retention)
```

## Key Features

### 1. EventBridge Event Bus
- **Name**: `iops-dashboard-alerts`
- **Purpose**: Central routing hub for all alerts
- **Sources**: Processing Lambda, AI Lambda

### 2. SNS Topics
- **Critical**: `iops-dashboard-critical-alerts` (health score < 50, extreme risk)
- **Warning**: `iops-dashboard-warning-alerts` (health score 50-70, elevated risk)
- **Info**: `iops-dashboard-info-alerts` (supply/demand updates, general info)

### 3. EventBridge Rules
- **CriticalAlertRule**: Filters `severity: critical` → routes to Critical SNS
- **WarningAlertRule**: Filters `severity: warning` → routes to Warning SNS
- **InfoAlertRule**: Filters `severity: info` → routes to Info SNS

### 4. Dead Letter Queue
- **Name**: `iops-dashboard-alert-dlq`
- **Retention**: 14 days
- **Encryption**: SQS-managed
- **Purpose**: Capture failed SNS notifications for troubleshooting

### 5. Email Formatting
- Formatted with emojis and sections
- Risk scores and AI explanations
- Recommended actions
- Dashboard links

## Deployment Steps

### 1. Set Environment Variables

Before deploying, configure email addresses for each severity level:

```bash
export CRITICAL_ALERT_EMAILS="oncall@yourcompany.com,ops-critical@yourcompany.com"
export WARNING_ALERT_EMAILS="ops-team@yourcompany.com"
export INFO_ALERT_EMAILS="product-team@yourcompany.com"
```

**Multiple emails**: Separate with commas (no spaces after commas)

### 2. Build CDK Stack

```bash
cd /Users/tyler/Desktop/Gauntlet/iops-dashboard/cdk
npm run build
```

### 3. Deploy Updated Stack

```bash
cdk deploy IOpsDashboard-CdkStack
```

**Important**: This deploys to the core stack (CdkStack), not IntelligenceStack. All resources are now consolidated.

### 4. Confirm Email Subscriptions

After deployment:
1. Check email inbox for AWS SNS subscription confirmations
2. Click "Confirm subscription" in each email
3. Repeat for all configured email addresses

**Verify subscriptions**:
```bash
# Get Critical Topic ARN
CRITICAL_TOPIC=$(aws cloudformation describe-stacks \
  --stack-name IOpsDashboard-CdkStack \
  --query 'Stacks[0].Outputs[?OutputKey==`CriticalAlertTopicArn`].OutputValue' \
  --output text)

# List subscriptions
aws sns list-subscriptions-by-topic --topic-arn $CRITICAL_TOPIC
```

## Testing

### Quick Test (Manual SNS Publish)

```bash
# Get topic ARNs from CloudFormation outputs
CRITICAL_TOPIC=$(aws cloudformation describe-stacks \
  --stack-name IOpsDashboard-CdkStack \
  --query 'Stacks[0].Outputs[?OutputKey==`CriticalAlertTopicArn`].OutputValue' \
  --output text)

WARNING_TOPIC=$(aws cloudformation describe-stacks \
  --stack-name IOpsDashboard-CdkStack \
  --query 'Stacks[0].Outputs[?OutputKey==`WarningAlertTopicArn`].OutputValue' \
  --output text)

INFO_TOPIC=$(aws cloudformation describe-stacks \
  --stack-name IOpsDashboard-CdkStack \
  --query 'Stacks[0].Outputs[?OutputKey==`InfoAlertTopicArn`].OutputValue' \
  --output text)

# Run test script
./scripts/test-alerts.sh $CRITICAL_TOPIC $WARNING_TOPIC $INFO_TOPIC
```

### End-to-End Test (Full Pipeline)

```bash
# 1. Enable simulator to generate events
aws events enable-rule --name IOpsDashboard-CdkStack-SimulatorSchedule

# 2. Invoke simulator manually (optional, for immediate testing)
SIM_FUNCTION=$(aws cloudformation describe-stacks \
  --stack-name IOpsDashboard-CdkStack \
  --query 'Stacks[0].Outputs[?OutputKey==`SimulatorFunctionName`].OutputValue' \
  --output text)

aws lambda invoke --function-name $SIM_FUNCTION --payload '{}' response.json

# 3. Wait 2-3 minutes for processing pipeline to complete

# 4. Check EventBridge metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/Events \
  --metric-name Invocations \
  --dimensions Name=RuleName,Value=IOpsDashboard-CdkStack-CriticalAlertRule \
  --start-time $(date -u -d '10 minutes ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum

# 5. Check your email for alerts!
```

## Monitoring

### Check Dead Letter Queue

```bash
# Get DLQ URL
DLQ_URL=$(aws cloudformation describe-stacks \
  --stack-name IOpsDashboard-CdkStack \
  --query 'Stacks[0].Outputs[?OutputKey==`AlertDLQUrl`].OutputValue' \
  --output text)

# Check for failed messages
aws sqs get-queue-attributes \
  --queue-url $DLQ_URL \
  --attribute-names ApproximateNumberOfMessages

# Retrieve failed messages
aws sqs receive-message \
  --queue-url $DLQ_URL \
  --max-number-of-messages 10
```

### CloudWatch Logs

```bash
# Processing Lambda logs (where alerts are generated)
aws logs tail /aws/lambda/IOpsDashboard-CdkStack-ProcessFunction --follow

# Check for EventBridge PutEvents calls
aws logs filter-log-events \
  --log-group-name /aws/lambda/IOpsDashboard-CdkStack-ProcessFunction \
  --filter-pattern "EventBridge"
```

### EventBridge Metrics

```bash
# Check rule invocations
aws events describe-rule \
  --name IOpsDashboard-CdkStack-CriticalAlertRule \
  --event-bus-name iops-dashboard-alerts

# List all rules on the bus
aws events list-rules --event-bus-name iops-dashboard-alerts
```

## CloudFormation Outputs

After deployment, the following outputs are available:

| Output Key | Description |
|------------|-------------|
| `EventBusName` | Name of custom EventBridge bus |
| `EventBusArn` | ARN of EventBridge bus |
| `CriticalAlertTopicArn` | SNS topic ARN for critical alerts |
| `WarningAlertTopicArn` | SNS topic ARN for warning alerts |
| `InfoAlertTopicArn` | SNS topic ARN for info alerts |
| `AlertDLQUrl` | Dead letter queue URL |
| `AlertDLQArn` | Dead letter queue ARN |

**Retrieve all outputs**:
```bash
aws cloudformation describe-stacks \
  --stack-name IOpsDashboard-CdkStack \
  --query 'Stacks[0].Outputs[?contains(OutputKey, `Alert`) || contains(OutputKey, `EventBus`)]'
```

## Configuration Options

### Add More Email Subscribers

```bash
# Subscribe additional email
aws sns subscribe \
  --topic-arn $CRITICAL_TOPIC \
  --protocol email \
  --notification-endpoint new-operator@example.com

# Subscriber must confirm via email
```

### Add SMS Notifications

```bash
# Subscribe phone number (requires SMS enabled on AWS account)
aws sns subscribe \
  --topic-arn $CRITICAL_TOPIC \
  --protocol sms \
  --notification-endpoint +1234567890
```

### Add Lambda Function as Subscriber

```bash
# Subscribe Lambda for custom processing
aws sns subscribe \
  --topic-arn $CRITICAL_TOPIC \
  --protocol lambda \
  --notification-endpoint arn:aws:lambda:us-east-1:123456789012:function:MyCustomAlertProcessor
```

## Troubleshooting

### Issue: Email Subscription Not Confirmed

**Solution**:
```bash
# Resend confirmation
aws sns subscribe \
  --topic-arn $CRITICAL_TOPIC \
  --protocol email \
  --notification-endpoint your-email@example.com
```

### Issue: No Emails Received

**Check**:
1. Spam/junk folder
2. SNS subscription confirmed (check SNS console)
3. EventBridge rule enabled
4. Processing Lambda logs for errors
5. EventBridge bus name in Processing Lambda environment

**Debug**:
```bash
# Check Processing Lambda environment variables
aws lambda get-function-configuration \
  --function-name IOpsDashboard-CdkStack-ProcessFunction \
  --query 'Environment.Variables.EVENT_BUS_NAME'

# Should output: "iops-dashboard-alerts"
```

### Issue: Messages in DLQ

**Solution**:
```bash
# Retrieve failed messages
aws sqs receive-message \
  --queue-url $DLQ_URL \
  --max-number-of-messages 10 \
  --attribute-names All

# Investigate error in message attributes
# Common causes:
# - Invalid email address
# - SNS subscription not confirmed
# - SNS topic policy issue
```

### Issue: Too Many Emails

**Solution 1**: Add filtering to EventBridge rules (CDK code):
```typescript
eventPattern: {
  source: ['iops-dashboard.processor'],
  detail: {
    severity: ['critical'],
    'details.health_score': [{ numeric: ['<', 40] }], // Only very low scores
  },
},
```

**Solution 2**: Adjust alert thresholds in Processing Lambda:
- Edit `lambda/process/handler.py`
- Change `detect_anomalies()` logic
- Redeploy

## Alert Types Generated

### 1. Low Health Score
- **Severity**: Critical (< 50), Warning (50-70)
- **Entity**: Student
- **Triggers**: Health score drops below threshold
- **Details**: health_score, sessions_7d, ib_calls_14d

### 2. High IB Call Frequency
- **Severity**: Warning
- **Entity**: Student
- **Triggers**: 3+ IB calls in 14 days
- **Details**: ib_calls_14d, health_score

### 3. Supply Demand Imbalance
- **Severity**: Info
- **Entity**: Subject
- **Triggers**: High demand detected
- **Details**: balance_status, demand_score, supply_score

## Next Steps

### PR-08: DynamoDB Schema Enhancements
- Add alert history table
- Store alert notifications
- Track email delivery status

### Production Readiness
1. Configure production email distribution lists
2. Set up PagerDuty/Opsgenie integration via SNS
3. Add alert rate limiting
4. Implement alert aggregation
5. Add alert acknowledgement system

## Cost Estimation

**Monthly costs (approximate)**:
- SNS: $0.50 per 1M notifications ($0.50 for 1M emails)
- EventBridge: $1.00 per 1M events ($1.00 for 1M rules)
- SQS (DLQ): $0.40 per 1M requests (negligible for DLQ)
- Lambda (Alert Formatter): $0.20 per 1M requests (if implemented)

**Expected usage (500 events/min)**:
- 21.6M events/month
- ~500-1000 alerts/month (assuming 2-5% anomaly rate)
- **Estimated cost**: $25-30/month

## Security Considerations

1. **Email Privacy**: SNS email subscriptions expose email addresses
   - Use group aliases (ops-team@) instead of individual emails
   - Implement email address masking in production

2. **DLQ Access**: Restrict access to DLQ
   - Contains failed alert messages with sensitive data
   - Add IAM policies to limit access

3. **EventBridge Bus**: Currently allows all sources
   - Consider adding resource-based policy
   - Restrict PutEvents to specific IAM roles

## Support

- Lambda Functions: `/Users/tyler/Desktop/Gauntlet/iops-dashboard/lambda/alert/`
- CDK Infrastructure: `/Users/tyler/Desktop/Gauntlet/iops-dashboard/cdk/lib/cdk-stack.ts`
- Testing Scripts: `/Users/tyler/Desktop/Gauntlet/iops-dashboard/scripts/test-alerts.sh`
- Documentation: `/Users/tyler/Desktop/Gauntlet/iops-dashboard/docs/PR-07-EventBridge-SNS-Alerts.md`

---

**Status**: Ready for deployment
**Estimated Deployment Time**: 15-20 minutes
**Dependencies**: AWS Account, Configured Credentials, Confirmed Email Subscriptions
