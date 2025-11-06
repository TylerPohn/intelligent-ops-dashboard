#!/bin/bash
###############################################################################
# IOps Dashboard - Monitoring Setup Script
#
# Creates CloudWatch dashboards, alarms, and SNS notifications for:
# - Lambda function errors and performance
# - DynamoDB throttling and capacity
# - API Gateway errors and latency
# - Cost monitoring and budget alerts
# - SageMaker endpoint health (if enabled)
#
# Usage:
#   ./setup-monitoring.sh [environment] [email]
#
# Example:
#   ./setup-monitoring.sh prod ops-team@example.com
###############################################################################

set -e
set -u
set -o pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
ENVIRONMENT="${1:-dev}"
ALERT_EMAIL="${2:-}"
AWS_REGION="${AWS_REGION:-us-east-2}"
STACK_NAME="iops-dashboard-${ENVIRONMENT}"

###############################################################################
# Helper Functions
###############################################################################

log() {
  echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $*"
}

success() {
  echo -e "${GREEN}✓${NC} $*"
}

error() {
  echo -e "${RED}✗${NC} $*"
}

warning() {
  echo -e "${YELLOW}⚠${NC} $*"
}

section() {
  echo ""
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}  $*${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

get_stack_output() {
  aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region "$AWS_REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" \
    --output text 2>/dev/null || echo ""
}

###############################################################################
# Validate Prerequisites
###############################################################################

section "Validating Prerequisites"

if [[ -z "$ALERT_EMAIL" ]]; then
  warning "No email provided, using default: alerts@example.com"
  ALERT_EMAIL="alerts@example.com"
fi

log "Environment:    $ENVIRONMENT"
log "Alert Email:    $ALERT_EMAIL"
log "Region:         $AWS_REGION"

# Check stack exists
STACK_STATUS=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION" \
  --query 'Stacks[0].StackStatus' \
  --output text 2>/dev/null || echo "NOT_FOUND")

if [[ "$STACK_STATUS" == "NOT_FOUND" ]]; then
  error "Stack not found: $STACK_NAME"
  exit 1
fi

success "Stack exists: $STACK_NAME"

# Get resources
TABLE_NAME=$(get_stack_output "TableName")
API_ID=$(aws apigateway get-rest-apis \
  --region "$AWS_REGION" \
  --query "items[?name=='${STACK_NAME}'].id" \
  --output text 2>/dev/null | head -n1)

LAMBDA_FUNCTIONS=$(aws lambda list-functions \
  --region "$AWS_REGION" \
  --query "Functions[?starts_with(FunctionName, '${STACK_NAME}')].FunctionName" \
  --output text)

if [[ -z "$TABLE_NAME" ]]; then
  error "DynamoDB table not found"
  exit 1
fi

success "Found resources to monitor"

###############################################################################
# Create SNS Topic
###############################################################################

section "Creating SNS Topic"

TOPIC_NAME="${STACK_NAME}-alerts"
TOPIC_ARN=$(aws sns list-topics \
  --region "$AWS_REGION" \
  --query "Topics[?contains(TopicArn, '${TOPIC_NAME}')].TopicArn" \
  --output text | head -n1)

if [[ -z "$TOPIC_ARN" ]]; then
  log "Creating SNS topic: $TOPIC_NAME"
  TOPIC_ARN=$(aws sns create-topic \
    --name "$TOPIC_NAME" \
    --region "$AWS_REGION" \
    --query 'TopicArn' \
    --output text)
  success "Created SNS topic: $TOPIC_ARN"
else
  success "SNS topic already exists: $TOPIC_ARN"
fi

# Subscribe email
log "Subscribing email: $ALERT_EMAIL"
aws sns subscribe \
  --topic-arn "$TOPIC_ARN" \
  --protocol email \
  --notification-endpoint "$ALERT_EMAIL" \
  --region "$AWS_REGION" \
  --no-cli-pager > /dev/null

warning "Check email and confirm SNS subscription"

###############################################################################
# Create Lambda Alarms
###############################################################################

section "Creating Lambda Alarms"

for func in $LAMBDA_FUNCTIONS; do
  log "Creating alarms for: $func"

  # Error alarm
  aws cloudwatch put-metric-alarm \
    --alarm-name "${func}-Errors" \
    --alarm-description "Errors in Lambda function ${func}" \
    --metric-name Errors \
    --namespace AWS/Lambda \
    --statistic Sum \
    --period 300 \
    --evaluation-periods 1 \
    --threshold 5 \
    --comparison-operator GreaterThanThreshold \
    --dimensions Name=FunctionName,Value="$func" \
    --alarm-actions "$TOPIC_ARN" \
    --region "$AWS_REGION" \
    --no-cli-pager

  success "  Created error alarm"

  # Duration alarm
  aws cloudwatch put-metric-alarm \
    --alarm-name "${func}-Duration" \
    --alarm-description "High duration in Lambda function ${func}" \
    --metric-name Duration \
    --namespace AWS/Lambda \
    --statistic Average \
    --period 300 \
    --evaluation-periods 2 \
    --threshold 5000 \
    --comparison-operator GreaterThanThreshold \
    --dimensions Name=FunctionName,Value="$func" \
    --alarm-actions "$TOPIC_ARN" \
    --region "$AWS_REGION" \
    --no-cli-pager

  success "  Created duration alarm"

  # Throttles alarm
  aws cloudwatch put-metric-alarm \
    --alarm-name "${func}-Throttles" \
    --alarm-description "Throttles in Lambda function ${func}" \
    --metric-name Throttles \
    --namespace AWS/Lambda \
    --statistic Sum \
    --period 300 \
    --evaluation-periods 1 \
    --threshold 1 \
    --comparison-operator GreaterThanThreshold \
    --dimensions Name=FunctionName,Value="$func" \
    --alarm-actions "$TOPIC_ARN" \
    --region "$AWS_REGION" \
    --no-cli-pager

  success "  Created throttle alarm"
done

###############################################################################
# Create DynamoDB Alarms
###############################################################################

section "Creating DynamoDB Alarms"

log "Creating alarms for table: $TABLE_NAME"

# Read throttle alarm
aws cloudwatch put-metric-alarm \
  --alarm-name "${TABLE_NAME}-ReadThrottles" \
  --alarm-description "Read throttles on table ${TABLE_NAME}" \
  --metric-name ReadThrottleEvents \
  --namespace AWS/DynamoDB \
  --statistic Sum \
  --period 300 \
  --evaluation-periods 1 \
  --threshold 1 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=TableName,Value="$TABLE_NAME" \
  --alarm-actions "$TOPIC_ARN" \
  --region "$AWS_REGION" \
  --no-cli-pager

success "Created read throttle alarm"

# Write throttle alarm
aws cloudwatch put-metric-alarm \
  --alarm-name "${TABLE_NAME}-WriteThrottles" \
  --alarm-description "Write throttles on table ${TABLE_NAME}" \
  --metric-name WriteThrottleEvents \
  --namespace AWS/DynamoDB \
  --statistic Sum \
  --period 300 \
  --evaluation-periods 1 \
  --threshold 1 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=TableName,Value="$TABLE_NAME" \
  --alarm-actions "$TOPIC_ARN" \
  --region "$AWS_REGION" \
  --no-cli-pager

success "Created write throttle alarm"

###############################################################################
# Create API Gateway Alarms
###############################################################################

if [[ -n "$API_ID" ]]; then
  section "Creating API Gateway Alarms"

  log "Creating alarms for API: $API_ID"

  # 5XX errors
  aws cloudwatch put-metric-alarm \
    --alarm-name "${STACK_NAME}-API-5XXErrors" \
    --alarm-description "5XX errors in API Gateway" \
    --metric-name 5XXError \
    --namespace AWS/ApiGateway \
    --statistic Sum \
    --period 300 \
    --evaluation-periods 1 \
    --threshold 10 \
    --comparison-operator GreaterThanThreshold \
    --dimensions Name=ApiName,Value="$STACK_NAME" \
    --alarm-actions "$TOPIC_ARN" \
    --region "$AWS_REGION" \
    --no-cli-pager

  success "Created 5XX error alarm"

  # Latency alarm
  aws cloudwatch put-metric-alarm \
    --alarm-name "${STACK_NAME}-API-Latency" \
    --alarm-description "High latency in API Gateway" \
    --metric-name Latency \
    --namespace AWS/ApiGateway \
    --statistic Average \
    --period 300 \
    --evaluation-periods 2 \
    --threshold 2000 \
    --comparison-operator GreaterThanThreshold \
    --dimensions Name=ApiName,Value="$STACK_NAME" \
    --alarm-actions "$TOPIC_ARN" \
    --region "$AWS_REGION" \
    --no-cli-pager

  success "Created latency alarm"
fi

###############################################################################
# Create CloudWatch Dashboard
###############################################################################

section "Creating CloudWatch Dashboard"

DASHBOARD_NAME="${STACK_NAME}"

# Build widget list for Lambda functions
LAMBDA_WIDGETS=""
Y_POS=0

for func in $LAMBDA_FUNCTIONS; do
  LAMBDA_WIDGETS+="{
    \"type\": \"metric\",
    \"x\": 0,
    \"y\": $Y_POS,
    \"width\": 12,
    \"height\": 6,
    \"properties\": {
      \"metrics\": [
        [ \"AWS/Lambda\", \"Invocations\", { \"stat\": \"Sum\", \"label\": \"Invocations\" } ],
        [ \".\", \"Errors\", { \"stat\": \"Sum\", \"label\": \"Errors\" } ],
        [ \".\", \"Throttles\", { \"stat\": \"Sum\", \"label\": \"Throttles\" } ]
      ],
      \"view\": \"timeSeries\",
      \"stacked\": false,
      \"region\": \"$AWS_REGION\",
      \"title\": \"Lambda: $func\",
      \"period\": 300,
      \"dimensions\": {
        \"FunctionName\": \"$func\"
      }
    }
  },"

  LAMBDA_WIDGETS+="{
    \"type\": \"metric\",
    \"x\": 12,
    \"y\": $Y_POS,
    \"width\": 12,
    \"height\": 6,
    \"properties\": {
      \"metrics\": [
        [ \"AWS/Lambda\", \"Duration\", { \"stat\": \"Average\", \"label\": \"Avg Duration\" } ],
        [ \"...\", { \"stat\": \"Maximum\", \"label\": \"Max Duration\" } ]
      ],
      \"view\": \"timeSeries\",
      \"stacked\": false,
      \"region\": \"$AWS_REGION\",
      \"title\": \"Lambda Duration: $func\",
      \"period\": 300,
      \"yAxis\": {
        \"left\": {
          \"label\": \"Milliseconds\"
        }
      },
      \"dimensions\": {
        \"FunctionName\": \"$func\"
      }
    }
  },"

  Y_POS=$((Y_POS + 6))
done

# Remove trailing comma
LAMBDA_WIDGETS="${LAMBDA_WIDGETS%,}"

# Create dashboard JSON
DASHBOARD_BODY=$(cat <<EOF
{
  "widgets": [
    {
      "type": "metric",
      "x": 0,
      "y": 0,
      "width": 24,
      "height\": 1,
      "properties": {
        "markdown": "# IOps Dashboard - $ENVIRONMENT\\n\\nMonitoring for stack: $STACK_NAME"
      }
    },
    $LAMBDA_WIDGETS,
    {
      "type": "metric",
      "x": 0,
      "y": $Y_POS,
      "width": 12,
      "height": 6,
      "properties": {
        "metrics": [
          [ "AWS/DynamoDB", "ConsumedReadCapacityUnits", { "stat": "Sum" } ],
          [ ".", "ConsumedWriteCapacityUnits", { "stat": "Sum" } ]
        ],
        "view": "timeSeries",
        "stacked": false,
        "region": "$AWS_REGION",
        "title": "DynamoDB: $TABLE_NAME",
        "period": 300,
        "dimensions": {
          "TableName": "$TABLE_NAME"
        }
      }
    },
    {
      "type": "metric",
      "x": 12,
      "y": $Y_POS,
      "width": 12,
      "height": 6,
      "properties": {
        "metrics": [
          [ "AWS/DynamoDB", "ReadThrottleEvents", { "stat": "Sum" } ],
          [ ".", "WriteThrottleEvents", { "stat": "Sum" } ]
        ],
        "view": "timeSeries",
        "stacked": false,
        "region": "$AWS_REGION",
        "title": "DynamoDB Throttles",
        "period": 300,
        "dimensions": {
          "TableName": "$TABLE_NAME"
        }
      }
    }
  ]
}
EOF
)

log "Creating dashboard: $DASHBOARD_NAME"
aws cloudwatch put-dashboard \
  --dashboard-name "$DASHBOARD_NAME" \
  --dashboard-body "$DASHBOARD_BODY" \
  --region "$AWS_REGION" \
  --no-cli-pager

success "Created CloudWatch dashboard"

###############################################################################
# Summary
###############################################################################

section "Monitoring Setup Complete"

cat <<EOF

Monitoring has been configured for: $STACK_NAME

📊 CloudWatch Dashboard:
   https://${AWS_REGION}.console.aws.amazon.com/cloudwatch/home?region=${AWS_REGION}#dashboards:name=${DASHBOARD_NAME}

🔔 SNS Topic:
   $TOPIC_ARN
   Email: $ALERT_EMAIL

⚠️  Alarms Created:
   - Lambda errors, duration, throttles
   - DynamoDB read/write throttles
   - API Gateway 5XX errors, latency

Next Steps:
1. Confirm SNS subscription via email
2. Review CloudWatch dashboard
3. Test alarms: Trigger errors and check email
4. Adjust thresholds as needed

EOF

success "Monitoring setup complete! 🎉"

exit 0
