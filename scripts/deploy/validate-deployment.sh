#!/bin/bash
###############################################################################
# IOps Dashboard - Deployment Validation Script
#
# Validates that all AWS resources are correctly deployed and functional:
# - CloudFormation stack status
# - DynamoDB table and GSI
# - Lambda functions
# - API Gateway endpoints
# - CloudWatch alarms
# - SNS topics
#
# Usage:
#   ./validate-deployment.sh [environment]
#
# Returns:
#   0 if all validations pass
#   1 if any validation fails
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
AWS_REGION="${AWS_REGION:-us-east-2}"
STACK_NAME="iops-dashboard-${ENVIRONMENT}"

PASSED=0
FAILED=0
WARNINGS=0

###############################################################################
# Helper Functions
###############################################################################

pass() {
  echo -e "${GREEN}✓${NC} $*"
  ((PASSED++))
}

fail() {
  echo -e "${RED}✗${NC} $*"
  ((FAILED++))
}

warn() {
  echo -e "${YELLOW}⚠${NC} $*"
  ((WARNINGS++))
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
# Validation Tests
###############################################################################

section "Environment Configuration"

echo "Environment:     $ENVIRONMENT"
echo "Stack Name:      $STACK_NAME"
echo "Region:          $AWS_REGION"
echo ""

###############################################################################
# Test 1: CloudFormation Stack
###############################################################################

section "CloudFormation Stack"

STACK_STATUS=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION" \
  --query 'Stacks[0].StackStatus' \
  --output text 2>/dev/null || echo "NOT_FOUND")

if [[ "$STACK_STATUS" == "CREATE_COMPLETE" || "$STACK_STATUS" == "UPDATE_COMPLETE" ]]; then
  pass "Stack exists and is in valid state: $STACK_STATUS"
else
  fail "Stack is not in valid state: $STACK_STATUS"
fi

# Check stack outputs
API_ENDPOINT=$(get_stack_output "ApiEndpoint")
TABLE_NAME=$(get_stack_output "TableName")
WEBSOCKET_URL=$(get_stack_output "WebSocketUrl")

if [[ -n "$API_ENDPOINT" ]]; then
  pass "API Endpoint output found: $API_ENDPOINT"
else
  fail "API Endpoint output not found"
fi

if [[ -n "$TABLE_NAME" ]]; then
  pass "Table Name output found: $TABLE_NAME"
else
  fail "Table Name output not found"
fi

###############################################################################
# Test 2: DynamoDB Table
###############################################################################

section "DynamoDB Table"

if [[ -n "$TABLE_NAME" ]]; then
  # Check table exists
  TABLE_STATUS=$(aws dynamodb describe-table \
    --table-name "$TABLE_NAME" \
    --region "$AWS_REGION" \
    --query 'Table.TableStatus' \
    --output text 2>/dev/null || echo "NOT_FOUND")

  if [[ "$TABLE_STATUS" == "ACTIVE" ]]; then
    pass "Table exists and is ACTIVE"
  else
    fail "Table is not ACTIVE: $TABLE_STATUS"
  fi

  # Check GSI exists
  GSI_COUNT=$(aws dynamodb describe-table \
    --table-name "$TABLE_NAME" \
    --region "$AWS_REGION" \
    --query 'length(Table.GlobalSecondaryIndexes)' \
    --output text 2>/dev/null || echo "0")

  if [[ "$GSI_COUNT" -gt 0 ]]; then
    pass "Global Secondary Index exists ($GSI_COUNT index(es))"

    # Check GSI status
    GSI_STATUS=$(aws dynamodb describe-table \
      --table-name "$TABLE_NAME" \
      --region "$AWS_REGION" \
      --query 'Table.GlobalSecondaryIndexes[0].IndexStatus' \
      --output text 2>/dev/null || echo "UNKNOWN")

    if [[ "$GSI_STATUS" == "ACTIVE" ]]; then
      pass "GSI is ACTIVE"
    else
      fail "GSI is not ACTIVE: $GSI_STATUS"
    fi
  else
    fail "No Global Secondary Indexes found"
  fi

  # Check table capacity
  BILLING_MODE=$(aws dynamodb describe-table \
    --table-name "$TABLE_NAME" \
    --region "$AWS_REGION" \
    --query 'Table.BillingModeSummary.BillingMode' \
    --output text 2>/dev/null || echo "PROVISIONED")

  if [[ "$BILLING_MODE" == "PAY_PER_REQUEST" ]]; then
    pass "Table billing mode: On-Demand"
  else
    pass "Table billing mode: Provisioned"
  fi

  # Check TTL
  TTL_STATUS=$(aws dynamodb describe-time-to-live \
    --table-name "$TABLE_NAME" \
    --region "$AWS_REGION" \
    --query 'TimeToLiveDescription.TimeToLiveStatus' \
    --output text 2>/dev/null || echo "DISABLED")

  if [[ "$TTL_STATUS" == "ENABLED" ]]; then
    pass "TTL is enabled"
  else
    warn "TTL is not enabled (optional)"
  fi
else
  fail "Cannot validate DynamoDB - table name not found"
fi

###############################################################################
# Test 3: Lambda Functions
###############################################################################

section "Lambda Functions"

# Find all Lambda functions for this stack
LAMBDA_FUNCTIONS=$(aws lambda list-functions \
  --region "$AWS_REGION" \
  --query "Functions[?starts_with(FunctionName, '${STACK_NAME}')].FunctionName" \
  --output text 2>/dev/null || echo "")

if [[ -n "$LAMBDA_FUNCTIONS" ]]; then
  LAMBDA_COUNT=$(echo "$LAMBDA_FUNCTIONS" | wc -w)
  pass "Found $LAMBDA_COUNT Lambda function(s)"

  for func in $LAMBDA_FUNCTIONS; do
    # Check function state
    STATE=$(aws lambda get-function \
      --function-name "$func" \
      --region "$AWS_REGION" \
      --query 'Configuration.State' \
      --output text 2>/dev/null || echo "UNKNOWN")

    if [[ "$STATE" == "Active" ]]; then
      pass "  $func: Active"
    else
      fail "  $func: $STATE"
    fi

    # Check last update status
    LAST_UPDATE=$(aws lambda get-function \
      --function-name "$func" \
      --region "$AWS_REGION" \
      --query 'Configuration.LastUpdateStatus' \
      --output text 2>/dev/null || echo "UNKNOWN")

    if [[ "$LAST_UPDATE" == "Successful" ]]; then
      pass "  $func: Last update successful"
    else
      warn "  $func: Last update status: $LAST_UPDATE"
    fi

    # Check recent errors (last 5 minutes)
    ERROR_COUNT=$(aws cloudwatch get-metric-statistics \
      --namespace AWS/Lambda \
      --metric-name Errors \
      --dimensions Name=FunctionName,Value="$func" \
      --start-time "$(date -u -d '5 minutes ago' +%Y-%m-%dT%H:%M:%S)" \
      --end-time "$(date -u +%Y-%m-%dT%H:%M:%S)" \
      --period 300 \
      --statistics Sum \
      --region "$AWS_REGION" \
      --query 'Datapoints[0].Sum' \
      --output text 2>/dev/null || echo "0")

    if [[ "$ERROR_COUNT" == "None" || "$ERROR_COUNT" == "0" || "$ERROR_COUNT" == "0.0" ]]; then
      pass "  $func: No recent errors"
    else
      warn "  $func: $ERROR_COUNT errors in last 5 minutes"
    fi
  done
else
  fail "No Lambda functions found for stack"
fi

###############################################################################
# Test 4: API Gateway
###############################################################################

section "API Gateway"

if [[ -n "$API_ENDPOINT" ]]; then
  # Test health endpoint
  HEALTH_CHECK=$(curl -s -o /dev/null -w "%{http_code}" "${API_ENDPOINT}/health" 2>/dev/null || echo "000")

  if [[ "$HEALTH_CHECK" == "200" ]]; then
    pass "Health endpoint responds: HTTP $HEALTH_CHECK"
  else
    fail "Health endpoint failed: HTTP $HEALTH_CHECK"
  fi

  # Test metrics endpoint (should return empty array or data)
  METRICS_CHECK=$(curl -s -o /dev/null -w "%{http_code}" "${API_ENDPOINT}/metrics?limit=1" 2>/dev/null || echo "000")

  if [[ "$METRICS_CHECK" == "200" ]]; then
    pass "Metrics endpoint responds: HTTP $METRICS_CHECK"
  else
    fail "Metrics endpoint failed: HTTP $METRICS_CHECK"
  fi

  # Test insights endpoint
  INSIGHTS_CHECK=$(curl -s -o /dev/null -w "%{http_code}" "${API_ENDPOINT}/insights/recent" 2>/dev/null || echo "000")

  if [[ "$INSIGHTS_CHECK" == "200" ]]; then
    pass "Insights endpoint responds: HTTP $INSIGHTS_CHECK"
  else
    fail "Insights endpoint failed: HTTP $INSIGHTS_CHECK"
  fi

  # Check CORS headers
  CORS_CHECK=$(curl -s -I -X OPTIONS "${API_ENDPOINT}/health" 2>/dev/null | grep -i "access-control-allow-origin" || echo "")

  if [[ -n "$CORS_CHECK" ]]; then
    pass "CORS headers present"
  else
    warn "CORS headers not found (may be expected)"
  fi
else
  fail "Cannot validate API Gateway - endpoint not found"
fi

###############################################################################
# Test 5: CloudWatch Alarms
###############################################################################

section "CloudWatch Alarms"

# Find all alarms for this stack
ALARMS=$(aws cloudwatch describe-alarms \
  --region "$AWS_REGION" \
  --alarm-name-prefix "$STACK_NAME" \
  --query 'MetricAlarms[].AlarmName' \
  --output text 2>/dev/null || echo "")

if [[ -n "$ALARMS" ]]; then
  ALARM_COUNT=$(echo "$ALARMS" | wc -w)
  pass "Found $ALARM_COUNT CloudWatch alarm(s)"

  for alarm in $ALARMS; do
    STATE=$(aws cloudwatch describe-alarms \
      --alarm-names "$alarm" \
      --region "$AWS_REGION" \
      --query 'MetricAlarms[0].StateValue' \
      --output text 2>/dev/null || echo "UNKNOWN")

    if [[ "$STATE" == "OK" ]]; then
      pass "  $alarm: OK"
    elif [[ "$STATE" == "INSUFFICIENT_DATA" ]]; then
      warn "  $alarm: INSUFFICIENT_DATA (expected for new deployment)"
    else
      fail "  $alarm: $STATE"
    fi
  done
else
  warn "No CloudWatch alarms found (may not be configured yet)"
fi

###############################################################################
# Test 6: SNS Topics
###############################################################################

section "SNS Topics"

# Find SNS topics for this stack
TOPICS=$(aws sns list-topics \
  --region "$AWS_REGION" \
  --query 'Topics[].TopicArn' \
  --output text 2>/dev/null | grep -i "$STACK_NAME" || echo "")

if [[ -n "$TOPICS" ]]; then
  TOPIC_COUNT=$(echo "$TOPICS" | wc -w)
  pass "Found $TOPIC_COUNT SNS topic(s)"

  for topic in $TOPICS; do
    # Check subscriptions
    SUB_COUNT=$(aws sns list-subscriptions-by-topic \
      --topic-arn "$topic" \
      --region "$AWS_REGION" \
      --query 'length(Subscriptions)' \
      --output text 2>/dev/null || echo "0")

    if [[ "$SUB_COUNT" -gt 0 ]]; then
      pass "  $(basename "$topic"): $SUB_COUNT subscription(s)"
    else
      warn "  $(basename "$topic"): No subscriptions"
    fi
  done
else
  warn "No SNS topics found (may not be configured yet)"
fi

###############################################################################
# Test 7: CloudWatch Log Groups
###############################################################################

section "CloudWatch Logs"

LOG_GROUPS=$(aws logs describe-log-groups \
  --region "$AWS_REGION" \
  --log-group-name-prefix "/aws/lambda/$STACK_NAME" \
  --query 'logGroups[].logGroupName' \
  --output text 2>/dev/null || echo "")

if [[ -n "$LOG_GROUPS" ]]; then
  LOG_COUNT=$(echo "$LOG_GROUPS" | wc -w)
  pass "Found $LOG_COUNT log group(s)"

  for log_group in $LOG_GROUPS; do
    # Check retention
    RETENTION=$(aws logs describe-log-groups \
      --log-group-name "$log_group" \
      --region "$AWS_REGION" \
      --query 'logGroups[0].retentionInDays' \
      --output text 2>/dev/null || echo "Never")

    if [[ "$RETENTION" != "Never" && "$RETENTION" != "None" ]]; then
      pass "  $(basename "$log_group"): Retention ${RETENTION} days"
    else
      warn "  $(basename "$log_group"): No retention policy"
    fi
  done
else
  warn "No log groups found yet"
fi

###############################################################################
# Test 8: Performance Check
###############################################################################

section "Performance Check"

if [[ -n "$API_ENDPOINT" ]]; then
  echo "Testing API response times..."

  # Measure health endpoint latency
  HEALTH_TIME=$( (time curl -s "${API_ENDPOINT}/health" > /dev/null) 2>&1 | grep real | awk '{print $2}')
  pass "Health endpoint latency: $HEALTH_TIME"

  # Measure metrics endpoint latency
  METRICS_TIME=$( (time curl -s "${API_ENDPOINT}/metrics?limit=10" > /dev/null) 2>&1 | grep real | awk '{print $2}')
  pass "Metrics endpoint latency: $METRICS_TIME"
fi

###############################################################################
# Test 9: Data Capacity Check
###############################################################################

section "Data Capacity"

if [[ -n "$TABLE_NAME" ]]; then
  # Check table item count
  ITEM_COUNT=$(aws dynamodb describe-table \
    --table-name "$TABLE_NAME" \
    --region "$AWS_REGION" \
    --query 'Table.ItemCount' \
    --output text 2>/dev/null || echo "0")

  TABLE_SIZE=$(aws dynamodb describe-table \
    --table-name "$TABLE_NAME" \
    --region "$AWS_REGION" \
    --query 'Table.TableSizeBytes' \
    --output text 2>/dev/null || echo "0")

  TABLE_SIZE_MB=$((TABLE_SIZE / 1024 / 1024))

  pass "Table item count: $ITEM_COUNT items"
  pass "Table size: ${TABLE_SIZE_MB} MB"

  # Check if at 0.5% capacity (200 streams target)
  if [[ "$ITEM_COUNT" -gt 0 ]]; then
    pass "Table has data"
  else
    warn "Table is empty - run data generation: npm run generate:demo"
  fi
fi

###############################################################################
# Summary
###############################################################################

section "Validation Summary"

echo ""
echo "Results:"
echo -e "  ${GREEN}Passed:${NC}   $PASSED"
echo -e "  ${RED}Failed:${NC}   $FAILED"
echo -e "  ${YELLOW}Warnings:${NC} $WARNINGS"
echo ""

if [[ $FAILED -eq 0 ]]; then
  echo -e "${GREEN}✓ All validation tests passed!${NC}"
  echo ""
  echo "Next steps:"
  echo "1. Generate test data: npm run generate:demo"
  echo "2. Monitor CloudWatch: AWS Console > CloudWatch"
  echo "3. Check costs: AWS Console > Cost Explorer"
  exit 0
else
  echo -e "${RED}✗ Some validation tests failed${NC}"
  echo ""
  echo "Review the failures above and check:"
  echo "1. CloudFormation stack events"
  echo "2. Lambda function logs"
  echo "3. API Gateway stages"
  exit 1
fi
