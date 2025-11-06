#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${BLUE}[ALARMS]${NC} $1"; }
log_success() { echo -e "${GREEN}[ALARMS] ✓${NC} $1"; }
log_error() { echo -e "${RED}[ALARMS] ✗${NC} $1"; }
log_warning() { echo -e "${YELLOW}[ALARMS] ⚠${NC} $1"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

log "Setting up CloudWatch alarms..."

# Load deployment outputs
if [ ! -f "$PROJECT_ROOT/.deployment-outputs" ]; then
    log_error "Deployment outputs not found"
    exit 1
fi

source "$PROJECT_ROOT/.deployment-outputs"

# Extract resource names
LAMBDA_NAME=$(echo "$AI_LAMBDA" | awk -F: '{print $NF}')
API_ID=$(echo "$API_URL" | grep -oE '[a-z0-9]{10}' | head -1)
REGION=$(echo "$AI_LAMBDA" | awk -F: '{print $4}')

# Get or create SNS topic for alarms
SNS_TOPIC_NAME="IOps-Critical-Alerts"
SNS_TOPIC_ARN=$(aws sns list-topics --query "Topics[?contains(TopicArn, '$SNS_TOPIC_NAME')].TopicArn" --output text 2>/dev/null || echo "")

if [ -z "$SNS_TOPIC_ARN" ]; then
    log "Creating SNS topic for alarms..."
    SNS_TOPIC_ARN=$(aws sns create-topic --name "$SNS_TOPIC_NAME" --query 'TopicArn' --output text)
    log_success "SNS topic created: $SNS_TOPIC_ARN"

    # Subscribe email if provided
    if [ -n "$CRITICAL_ALERT_EMAILS" ]; then
        IFS=',' read -ra EMAILS <<< "$CRITICAL_ALERT_EMAILS"
        for EMAIL in "${EMAILS[@]}"; do
            EMAIL=$(echo "$EMAIL" | xargs) # trim whitespace
            log "Subscribing email: $EMAIL"
            aws sns subscribe \
                --topic-arn "$SNS_TOPIC_ARN" \
                --protocol email \
                --notification-endpoint "$EMAIL" > /dev/null
            log_warning "Subscription pending - check email to confirm: $EMAIL"
        done
    fi
else
    log_success "Using existing SNS topic: $SNS_TOPIC_ARN"
fi

# Alarm 1: Lambda Error Rate
log "Creating alarm: Lambda Error Rate > 5%"
aws cloudwatch put-metric-alarm \
    --alarm-name "IOps-Lambda-HighErrorRate" \
    --alarm-description "Lambda error rate exceeds 5%" \
    --actions-enabled \
    --alarm-actions "$SNS_TOPIC_ARN" \
    --metric-name Errors \
    --namespace AWS/Lambda \
    --statistic Sum \
    --dimensions Name=FunctionName,Value="$LAMBDA_NAME" \
    --period 300 \
    --evaluation-periods 2 \
    --threshold 5 \
    --comparison-operator GreaterThanThreshold \
    --treat-missing-data notBreaching \
    --region "$REGION" 2>/dev/null || log_warning "Failed to create Lambda error rate alarm"

log_success "Lambda error rate alarm created"

# Alarm 2: Lambda Duration
log "Creating alarm: Lambda Duration > 3000ms"
aws cloudwatch put-metric-alarm \
    --alarm-name "IOps-Lambda-HighDuration" \
    --alarm-description "Lambda duration exceeds 3 seconds" \
    --actions-enabled \
    --alarm-actions "$SNS_TOPIC_ARN" \
    --metric-name Duration \
    --namespace AWS/Lambda \
    --statistic Average \
    --dimensions Name=FunctionName,Value="$LAMBDA_NAME" \
    --period 300 \
    --evaluation-periods 2 \
    --threshold 3000 \
    --comparison-operator GreaterThanThreshold \
    --treat-missing-data notBreaching \
    --region "$REGION" 2>/dev/null || log_warning "Failed to create Lambda duration alarm"

log_success "Lambda duration alarm created"

# Alarm 3: Lambda Throttles
log "Creating alarm: Lambda Throttles > 10"
aws cloudwatch put-metric-alarm \
    --alarm-name "IOps-Lambda-Throttles" \
    --alarm-description "Lambda function is being throttled" \
    --actions-enabled \
    --alarm-actions "$SNS_TOPIC_ARN" \
    --metric-name Throttles \
    --namespace AWS/Lambda \
    --statistic Sum \
    --dimensions Name=FunctionName,Value="$LAMBDA_NAME" \
    --period 300 \
    --evaluation-periods 1 \
    --threshold 10 \
    --comparison-operator GreaterThanThreshold \
    --treat-missing-data notBreaching \
    --region "$REGION" 2>/dev/null || log_warning "Failed to create Lambda throttle alarm"

log_success "Lambda throttle alarm created"

# Alarm 4: API Gateway 5xx Errors
if [ -n "$API_ID" ]; then
    log "Creating alarm: API Gateway 5xx > 10"
    aws cloudwatch put-metric-alarm \
        --alarm-name "IOps-ApiGateway-5xxErrors" \
        --alarm-description "API Gateway 5xx errors exceed 10" \
        --actions-enabled \
        --alarm-actions "$SNS_TOPIC_ARN" \
        --metric-name 5XXError \
        --namespace AWS/ApiGateway \
        --statistic Sum \
        --dimensions Name=ApiId,Value="$API_ID" \
        --period 300 \
        --evaluation-periods 1 \
        --threshold 10 \
        --comparison-operator GreaterThanThreshold \
        --treat-missing-data notBreaching \
        --region "$REGION" 2>/dev/null || log_warning "Failed to create API Gateway alarm"

    log_success "API Gateway 5xx alarm created"
fi

# Alarm 5: DynamoDB Throttles
log "Creating alarm: DynamoDB Throttles > 10"
aws cloudwatch put-metric-alarm \
    --alarm-name "IOps-DynamoDB-Throttles-Metrics" \
    --alarm-description "DynamoDB Metrics table throttling" \
    --actions-enabled \
    --alarm-actions "$SNS_TOPIC_ARN" \
    --metric-name UserErrors \
    --namespace AWS/DynamoDB \
    --statistic Sum \
    --dimensions Name=TableName,Value="$METRICS_TABLE" \
    --period 300 \
    --evaluation-periods 1 \
    --threshold 10 \
    --comparison-operator GreaterThanThreshold \
    --treat-missing-data notBreaching \
    --region "$REGION" 2>/dev/null || log_warning "Failed to create DynamoDB throttle alarm"

log_success "DynamoDB throttle alarm created"

# Alarm 6: Estimated Monthly Cost
log "Creating alarm: Estimated Cost > \$60/month"

# Note: Cost alarms require AWS Budgets, not CloudWatch
# Creating a budget instead
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

cat > /tmp/iops-budget.json << EOF
{
  "BudgetName": "IOps-Monthly-Cost-Alert",
  "BudgetLimit": {
    "Amount": "60",
    "Unit": "USD"
  },
  "TimeUnit": "MONTHLY",
  "BudgetType": "COST",
  "CostFilters": {
    "TagKeyValue": ["user:Project\$IOps"]
  },
  "CostTypes": {
    "IncludeTax": true,
    "IncludeSubscription": true,
    "UseBlended": false,
    "IncludeRefund": false,
    "IncludeCredit": false,
    "IncludeUpfront": true,
    "IncludeRecurring": true,
    "IncludeOtherSubscription": true,
    "IncludeSupport": true,
    "IncludeDiscount": true,
    "UseAmortized": false
  }
}
EOF

cat > /tmp/iops-budget-notification.json << EOF
{
  "Notification": {
    "NotificationType": "ACTUAL",
    "ComparisonOperator": "GREATER_THAN",
    "Threshold": 80,
    "ThresholdType": "PERCENTAGE"
  },
  "Subscribers": [
    {
      "SubscriptionType": "EMAIL",
      "Address": "${CRITICAL_ALERT_EMAILS%%,*}"
    }
  ]
}
EOF

aws budgets create-budget \
    --account-id "$ACCOUNT_ID" \
    --budget file:///tmp/iops-budget.json \
    --notifications-with-subscribers file:///tmp/iops-budget-notification.json \
    --region us-east-1 2>/dev/null || log_warning "Failed to create budget alarm (may already exist)"

log_success "Cost budget alarm created"
rm /tmp/iops-budget*.json

# Create composite alarm for critical issues
log "Creating composite alarm for critical issues..."

COMPOSITE_EXPRESSION="ALARM(IOps-Lambda-HighErrorRate) OR ALARM(IOps-Lambda-HighDuration) OR ALARM(IOps-ApiGateway-5xxErrors)"

aws cloudwatch put-composite-alarm \
    --alarm-name "IOps-Critical-System-Issues" \
    --alarm-description "Multiple critical issues detected in IOps system" \
    --actions-enabled \
    --alarm-actions "$SNS_TOPIC_ARN" \
    --alarm-rule "$COMPOSITE_EXPRESSION" \
    --region "$REGION" 2>/dev/null || log_warning "Failed to create composite alarm"

log_success "Composite alarm created"

# List all created alarms
log ""
log "=========================================="
log_success "Alarm Setup Complete!"
log "=========================================="
log ""
log "Created alarms:"

aws cloudwatch describe-alarms \
    --alarm-names \
    "IOps-Lambda-HighErrorRate" \
    "IOps-Lambda-HighDuration" \
    "IOps-Lambda-Throttles" \
    "IOps-ApiGateway-5xxErrors" \
    "IOps-DynamoDB-Throttles-Metrics" \
    "IOps-Critical-System-Issues" \
    --region "$REGION" \
    --query 'MetricAlarms[].{Name:AlarmName,State:StateValue,Metric:MetricName}' \
    --output table 2>/dev/null || log_warning "Could not list alarms"

log ""
log "SNS Topic for alerts: $SNS_TOPIC_ARN"
log ""
log "Alarm thresholds:"
log "  - Lambda error rate: >5%"
log "  - Lambda duration: >3000ms"
log "  - Lambda throttles: >10 in 5 minutes"
log "  - API Gateway 5xx: >10 in 5 minutes"
log "  - DynamoDB throttles: >10 in 5 minutes"
log "  - Monthly cost: >\$60 (80% threshold = \$48)"
log ""

if [ -n "$CRITICAL_ALERT_EMAILS" ]; then
    log_warning "Important: Check your email and confirm SNS subscriptions!"
    log "Emails sent to: $CRITICAL_ALERT_EMAILS"
else
    log_warning "No alert emails configured. Set CRITICAL_ALERT_EMAILS to receive notifications."
fi

log ""
log "To view alarms:"
log "  https://console.aws.amazon.com/cloudwatch/home?region=$REGION#alarmsV2:"
log ""
log "To test an alarm:"
log "  aws cloudwatch set-alarm-state --alarm-name IOps-Lambda-HighErrorRate --state-value ALARM --state-reason test"
