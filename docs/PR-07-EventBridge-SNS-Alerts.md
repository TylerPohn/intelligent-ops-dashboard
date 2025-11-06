# PR-07: EventBridge Rules + SNS Alerts

## Overview
Set up EventBridge rules for routing alerts and configure SNS topics for email notifications when critical alerts occur.

## Dependencies
- PR-05: AI Inference Lambda (Intelligence Stack with EventBridge bus)

## AWS Credentials Setup
**IMPORTANT**: Ensure AWS credentials are configured before running CDK/CLI commands.

See `/Users/tyler/Desktop/Gauntlet/iops-dashboard/docs/AWS-credentials.md` for setup instructions.

## Objectives
- Configure SNS topics for different alert severities
- Create EventBridge rules for alert routing
- Set up email subscriptions for operators
- Add dead letter queues for failed notifications
- Test end-to-end alert flow

## Step-by-Step Instructions

### 1. Update Intelligence Stack with SNS
**File:** `cdk/lib/intelligence-stack.ts` (update)

Add imports:
```typescript
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as sqs from 'aws-cdk-lib/aws-sqs';
```

Add to IntelligenceStack class properties:
```typescript
public readonly criticalAlertTopic: sns.Topic;
public readonly warningAlertTopic: sns.Topic;
public readonly infoAlertTopic: sns.Topic;
```

Add to constructor (after eventBus creation):
```typescript
// Create Dead Letter Queue for failed notifications
const alertDLQ = new sqs.Queue(this, 'AlertDLQ', {
  queueName: 'iops-dashboard-alert-dlq',
  retentionPeriod: cdk.Duration.days(14),
});

// Create SNS topics for different severity levels
this.criticalAlertTopic = new sns.Topic(this, 'CriticalAlertTopic', {
  topicName: 'iops-dashboard-critical-alerts',
  displayName: 'IOps Dashboard Critical Alerts',
  fifo: false,
});

this.warningAlertTopic = new sns.Topic(this, 'WarningAlertTopic', {
  topicName: 'iops-dashboard-warning-alerts',
  displayName: 'IOps Dashboard Warning Alerts',
  fifo: false,
});

this.infoAlertTopic = new sns.Topic(this, 'InfoAlertTopic', {
  topicName: 'iops-dashboard-info-alerts',
  displayName: 'IOps Dashboard Info Alerts',
  fifo: false,
});

// Add email subscriptions (configured via environment variables)
const criticalEmails = (process.env.CRITICAL_ALERT_EMAILS || '').split(',').filter(Boolean);
const warningEmails = (process.env.WARNING_ALERT_EMAILS || '').split(',').filter(Boolean);
const infoEmails = (process.env.INFO_ALERT_EMAILS || '').split(',').filter(Boolean);

criticalEmails.forEach(email => {
  this.criticalAlertTopic.addSubscription(
    new subscriptions.EmailSubscription(email.trim())
  );
});

warningEmails.forEach(email => {
  this.warningAlertTopic.addSubscription(
    new subscriptions.EmailSubscription(email.trim())
  );
});

infoEmails.forEach(email => {
  this.infoAlertTopic.addSubscription(
    new subscriptions.EmailSubscription(email.trim())
  );
});

// Create EventBridge rules to route alerts to SNS based on severity
const criticalRule = new events.Rule(this, 'CriticalAlertRule', {
  eventBus: this.eventBus,
  eventPattern: {
    source: ['iops-dashboard.processor', 'iops-dashboard.ai'],
    detail: {
      severity: ['critical'],
    },
  },
  description: 'Routes critical alerts to SNS for immediate notification',
});

criticalRule.addTarget(new targets.SnsTopic(this.criticalAlertTopic, {
  message: events.RuleTargetInput.fromEventPath('$.detail'),
  deadLetterQueue: alertDLQ,
}));

const warningRule = new events.Rule(this, 'WarningAlertRule', {
  eventBus: this.eventBus,
  eventPattern: {
    source: ['iops-dashboard.processor', 'iops-dashboard.ai'],
    detail: {
      severity: ['warning'],
    },
  },
  description: 'Routes warning alerts to SNS',
});

warningRule.addTarget(new targets.SnsTopic(this.warningAlertTopic, {
  message: events.RuleTargetInput.fromEventPath('$.detail'),
  deadLetterQueue: alertDLQ,
}));

const infoRule = new events.Rule(this, 'InfoAlertRule', {
  eventBus: this.eventBus,
  eventPattern: {
    source: ['iops-dashboard.processor', 'iops-dashboard.ai'],
    detail: {
      severity: ['info'],
    },
  },
  description: 'Routes info alerts to SNS',
});

infoRule.addTarget(new targets.SnsTopic(this.infoAlertTopic, {
  message: events.RuleTargetInput.fromEventPath('$.detail'),
  deadLetterQueue: alertDLQ,
}));

// Outputs
new cdk.CfnOutput(this, 'CriticalAlertTopicArn', {
  value: this.criticalAlertTopic.topicArn,
  description: 'SNS topic for critical alerts',
  exportName: 'IOpsDashboard-CriticalAlertTopicArn',
});

new cdk.CfnOutput(this, 'WarningAlertTopicArn', {
  value: this.warningAlertTopic.topicArn,
  description: 'SNS topic for warning alerts',
  exportName: 'IOpsDashboard-WarningAlertTopicArn',
});

new cdk.CfnOutput(this, 'InfoAlertTopicArn', {
  value: this.infoAlertTopic.topicArn,
  description: 'SNS topic for info alerts',
  exportName: 'IOpsDashboard-InfoAlertTopicArn',
});

new cdk.CfnOutput(this, 'AlertDLQUrl', {
  value: alertDLQ.queueUrl,
  description: 'Dead letter queue for failed alert notifications',
  exportName: 'IOpsDashboard-AlertDLQUrl',
});
```

### 2. Create SNS Message Formatter Lambda
To make SNS emails more readable, create a formatter Lambda:

**File:** `lambda/alert/format-alert.ts`

```typescript
import { SNSEvent, SNSEventRecord } from 'aws-lambda';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

const snsClient = new SNSClient({ region: process.env.AWS_REGION });

interface Alert {
  alert_type: string;
  severity: string;
  entity_id: string;
  entity_type: string;
  details: Record<string, any>;
  message: string;
  timestamp: string;
  explanation?: string;
  risk_score?: number;
  recommendations?: string[];
}

function formatAlertEmail(alert: Alert): { subject: string; body: string } {
  const emoji = alert.severity === 'critical' ? '🚨' : alert.severity === 'warning' ? '⚠️' : 'ℹ️';

  let subject = `${emoji} ${alert.severity.toUpperCase()}: ${alert.alert_type}`;

  let body = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IOps Dashboard Alert
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${emoji} Severity: ${alert.severity.toUpperCase()}
📋 Alert Type: ${alert.alert_type}
🆔 Entity: ${alert.entity_id} (${alert.entity_type})
⏰ Timestamp: ${new Date(alert.timestamp).toLocaleString()}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📄 Summary:
${alert.message}

${alert.risk_score ? `🎯 Risk Score: ${alert.risk_score}/100\n` : ''}
${alert.explanation ? `\n💡 AI Analysis:\n${alert.explanation}\n` : ''}

📊 Details:
${Object.entries(alert.details)
  .map(([key, value]) => `  • ${key}: ${value}`)
  .join('\n')}

${alert.recommendations && alert.recommendations.length > 0 ? `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Recommended Actions:
${alert.recommendations.map((rec, i) => `  ${i + 1}. ${rec}`).join('\n')}
` : ''}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔗 Dashboard: https://your-dashboard-url.com/alerts/${alert.entity_id}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`.trim();

  return { subject, body };
}

export const handler = async (event: SNSEvent): Promise<void> => {
  console.log('Formatting alerts for SNS:', JSON.stringify(event, null, 2));

  for (const record of event.Records) {
    try {
      const alert: Alert = JSON.parse(record.Sns.Message);
      const { subject, body } = formatAlertEmail(alert);

      console.log('Formatted alert:', subject);

      // Note: In production, this would publish to final SNS topic
      // For now, we'll just log it
      console.log(body);

    } catch (error) {
      console.error('Error formatting alert:', error);
    }
  }
};
```

**File:** `lambda/alert/package.json`

```json
{
  "name": "alert-lambda",
  "version": "1.0.0",
  "description": "Alert formatting for IOps Dashboard",
  "main": "index.js",
  "scripts": {
    "build": "tsc"
  },
  "dependencies": {
    "@aws-sdk/client-sns": "^3.450.0"
  },
  "devDependencies": {
    "@types/aws-lambda": "^8.10.130",
    "@types/node": "^20.10.0",
    "typescript": "^5.3.0"
  }
}
```

**File:** `lambda/alert/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "sourceMap": true
  },
  "include": ["*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

### 3. Build Alert Lambda
```bash
cd lambda/alert
npm install
npm run build
```

### 4. Set Environment Variables for Email Addresses
**File:** `.env.example`

```bash
# Email addresses for alert notifications (comma-separated)
CRITICAL_ALERT_EMAILS=ops-critical@yourcompany.com,oncall@yourcompany.com
WARNING_ALERT_EMAILS=ops-team@yourcompany.com
INFO_ALERT_EMAILS=product-team@yourcompany.com
```

Before deploying, set these in your shell:
```bash
export CRITICAL_ALERT_EMAILS="your-email@example.com"
export WARNING_ALERT_EMAILS="your-email@example.com"
export INFO_ALERT_EMAILS="your-email@example.com"
```

### 5. Deploy Updated Stack
```bash
cd cdk
npm run build
cdk deploy IOpsDashboard-IntelligenceStack
```

### 6. Confirm Email Subscriptions
After deployment, check your email for SNS subscription confirmation messages:

1. Open email from AWS Notifications
2. Click "Confirm subscription" link
3. Repeat for each email address configured

**Verify subscriptions:**
```bash
# Check critical alerts topic
aws sns list-subscriptions-by-topic \
  --topic-arn $(aws cloudformation describe-stacks \
    --stack-name IOpsDashboard-IntelligenceStack \
    --query 'Stacks[0].Outputs[?OutputKey==`CriticalAlertTopicArn`].OutputValue' \
    --output text)
```

## Verification Steps

### 1. Test SNS Publishing Manually
```bash
# Get topic ARN
CRITICAL_TOPIC=$(aws cloudformation describe-stacks \
  --stack-name IOpsDashboard-IntelligenceStack \
  --query 'Stacks[0].Outputs[?OutputKey==`CriticalAlertTopicArn`].OutputValue' \
  --output text)

# Publish test message
aws sns publish \
  --topic-arn $CRITICAL_TOPIC \
  --subject "Test Critical Alert" \
  --message '{
    "alert_type": "test_alert",
    "severity": "critical",
    "entity_id": "test_123",
    "entity_type": "test",
    "details": {
      "reason": "Manual test"
    },
    "message": "This is a test critical alert",
    "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"
  }'
```

Check your email for the test alert!

### 2. Test End-to-End Alert Flow
```bash
# 1. Trigger simulator to generate events
SIM_FUNCTION=$(aws cloudformation describe-stacks \
  --stack-name IOpsDashboard-CoreStack \
  --query 'Stacks[0].Outputs[?OutputKey==`SimulatorFunctionName`].OutputValue' \
  --output text)

aws lambda invoke --function-name $SIM_FUNCTION --payload '{}' response.json

# 2. Wait 1-2 minutes for processing

# 3. Check EventBridge bus for events
aws events list-rules --event-bus-name iops-dashboard-alerts

# 4. Check CloudWatch Logs for SNS publishes
```

### 3. Monitor EventBridge Metrics
```bash
# Check rule invocations
aws cloudwatch get-metric-statistics \
  --namespace AWS/Events \
  --metric-name Invocations \
  --dimensions Name=RuleName,Value=IOpsDashboard-IntelligenceStack-CriticalAlertRule \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum
```

### 4. Check Dead Letter Queue
```bash
# Get DLQ URL
DLQ_URL=$(aws cloudformation describe-stacks \
  --stack-name IOpsDashboard-IntelligenceStack \
  --query 'Stacks[0].Outputs[?OutputKey==`AlertDLQUrl`].OutputValue' \
  --output text)

# Check for failed messages
aws sqs get-queue-attributes \
  --queue-url $DLQ_URL \
  --attribute-names ApproximateNumberOfMessages

# If messages exist, retrieve them
aws sqs receive-message --queue-url $DLQ_URL
```

### 5. Create Test Script for All Alert Types
**File:** `scripts/test-alerts.sh`

```bash
#!/bin/bash

CRITICAL_TOPIC=$1
WARNING_TOPIC=$2
INFO_TOPIC=$3

if [ -z "$CRITICAL_TOPIC" ] || [ -z "$WARNING_TOPIC" ] || [ -z "$INFO_TOPIC" ]; then
  echo "Usage: $0 <critical-topic-arn> <warning-topic-arn> <info-topic-arn>"
  exit 1
fi

echo "Testing Critical Alert..."
aws sns publish \
  --topic-arn $CRITICAL_TOPIC \
  --subject "🚨 Critical: Low Health Score" \
  --message '{
    "alert_type": "low_health_score",
    "severity": "critical",
    "entity_id": "stu_9999",
    "entity_type": "student",
    "details": {
      "health_score": 35,
      "sessions_7d": 0,
      "ib_calls_14d": 8
    },
    "message": "Student stu_9999 has critically low health score",
    "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
    "risk_score": 95,
    "explanation": "Zero sessions in 7 days combined with 8 IB calls indicates extreme churn risk.",
    "recommendations": [
      "Immediate outreach from customer success team",
      "Offer free session with senior tutor",
      "Investigate root cause of IB call frequency"
    ]
  }'

echo ""
echo "Testing Warning Alert..."
aws sns publish \
  --topic-arn $WARNING_TOPIC \
  --subject "⚠️ Warning: High IB Call Frequency" \
  --message '{
    "alert_type": "high_ib_call_frequency",
    "severity": "warning",
    "entity_id": "stu_7777",
    "entity_type": "student",
    "details": {
      "ib_calls_14d": 4,
      "health_score": 68
    },
    "message": "Student stu_7777 has 4 IB calls in 14 days",
    "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
    "risk_score": 72,
    "explanation": "Elevated IB call frequency may indicate dissatisfaction.",
    "recommendations": [
      "Review IB call transcripts for patterns",
      "Schedule check-in call with student"
    ]
  }'

echo ""
echo "Testing Info Alert..."
aws sns publish \
  --topic-arn $INFO_TOPIC \
  --subject "ℹ️ Info: Supply Demand Update" \
  --message '{
    "alert_type": "supply_demand_imbalance",
    "severity": "info",
    "entity_id": "Mathematics",
    "entity_type": "subject",
    "details": {
      "balance_status": "high_demand",
      "demand_score": 92,
      "supply_score": 58
    },
    "message": "High demand detected for Mathematics",
    "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
    "explanation": "Demand significantly exceeds supply in Mathematics category.",
    "recommendations": [
      "Recruit additional math tutors",
      "Promote math tutoring to existing tutors",
      "Consider incentive programs"
    ]
  }'

echo ""
echo "✅ Test alerts sent! Check your email."
```

Make executable and run:
```bash
chmod +x scripts/test-alerts.sh

./scripts/test-alerts.sh \
  $(aws cloudformation describe-stacks --stack-name IOpsDashboard-IntelligenceStack --query 'Stacks[0].Outputs[?OutputKey==`CriticalAlertTopicArn`].OutputValue' --output text) \
  $(aws cloudformation describe-stacks --stack-name IOpsDashboard-IntelligenceStack --query 'Stacks[0].Outputs[?OutputKey==`WarningAlertTopicArn`].OutputValue' --output text) \
  $(aws cloudformation describe-stacks --stack-name IOpsDashboard-IntelligenceStack --query 'Stacks[0].Outputs[?OutputKey==`InfoAlertTopicArn`].OutputValue' --output text)
```

## Configuration Options

### Add More Email Subscribers
```bash
# Get topic ARN
TOPIC_ARN="<topic-arn>"

# Add email subscription
aws sns subscribe \
  --topic-arn $TOPIC_ARN \
  --protocol email \
  --notification-endpoint new-email@example.com

# Subscriber must confirm via email
```

### Add SMS Notifications
```bash
# Subscribe phone number (requires SMS enabled on AWS account)
aws sns subscribe \
  --topic-arn $TOPIC_ARN \
  --protocol sms \
  --notification-endpoint +1234567890
```

## Troubleshooting

### Issue: Email Subscription Not Confirmed
**Solution:**
```bash
# Resend confirmation
aws sns subscribe \
  --topic-arn $TOPIC_ARN \
  --protocol email \
  --notification-endpoint your-email@example.com
```

### Issue: No Emails Received
**Check:**
1. Spam folder
2. Subscription confirmed (check SNS console)
3. EventBridge rule enabled
4. CloudWatch Logs for errors

### Issue: Messages in DLQ
**Solution:**
```bash
# Retrieve failed messages
aws sqs receive-message \
  --queue-url $DLQ_URL \
  --max-number-of-messages 10

# Investigate error in message attributes
```

### Issue: Too Many Emails
**Solution:** Add filtering to EventBridge rules:
```typescript
eventPattern: {
  source: ['iops-dashboard.processor'],
  detail: {
    severity: ['critical'],
    'details.health_score': [{ numeric: ['<', 50] }], // Only very low scores
  },
},
```

## Files Created
- `cdk/lib/intelligence-stack.ts` (updated)
- `lambda/alert/format-alert.ts`
- `lambda/alert/package.json`
- `lambda/alert/tsconfig.json`
- `.env.example`
- `scripts/test-alerts.sh`

## Next Steps
- PR-08: DynamoDB Schema (store alert history)
- PR-12: Email Integration (enhanced formatting)
- Configure production email lists

## Estimated Time
- 45-60 minutes

## Skills Required
- SNS concepts
- EventBridge rule patterns
- Email configuration basics

## References
- [Amazon SNS](https://docs.aws.amazon.com/sns/)
- [EventBridge Event Patterns](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-event-patterns.html)
- [SNS Email Subscriptions](https://docs.aws.amazon.com/sns/latest/dg/sns-email-notifications.html)
- [SNS Message Filtering](https://docs.aws.amazon.com/sns/latest/dg/sns-message-filtering.html)
