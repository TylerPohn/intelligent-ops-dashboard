#!/bin/bash
###############################################################################
# IOps Dashboard - Health Check Script
#
# Quick health check for all AWS resources:
# - CloudFormation stack status
# - Lambda function health
# - DynamoDB table status
# - API Gateway availability
# - Recent errors and throttles
#
# Usage:
#   ./check-health.sh [environment]
#
# Returns:
#   0 if all checks pass
#   1 if any critical issues found
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

CRITICAL_ISSUES=0
WARNINGS=0

###############################################################################
# Helper Functions
###############################################################################

healthy() {
  echo -e "${GREEN}✓${NC} $*"
}

unhealthy() {
  echo -e "${RED}✗${NC} $*"
  ((CRITICAL_ISSUES++))
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

get_metric() {
  local namespace="$1"
  local metric="$2"
  local dimensions="$3"

  aws cloudwatch get-metric-statistics \
    --namespace "$namespace" \
    --metric-name "$metric" \
    --dimensions "$dimensions" \
    --start-time "$(date -u -d '5 minutes ago' +%Y-%m-%dT%H:%M:%S)" \
    --end-time "$(date -u +%Y-%m-%dT%H:%M:%S)" \
    --period 300 \
    --statistics Sum \
    --region "$AWS_REGION" \
    --query 'Datapoints[0].Sum' \
    --output text 2>/dev/null || echo "0"
}

###############################################################################
# Health Checks
###############################################################################

section "IOps Dashboard Health Check - $ENVIRONMENT"

echo "Timestamp: $(date)"
echo "Region:    $AWS_REGION"
echo ""

###############################################################################
# Check 1: CloudFormation Stack
###############################################################################

section "CloudFormation Stack"

STACK_STATUS=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION" \
  --query 'Stacks[0].StackStatus' \
  --output text 2>/dev/null || echo "NOT_FOUND")

if [[ "$STACK_STATUS" =~ (CREATE_COMPLETE|UPDATE_COMPLETE) ]]; then
  healthy "Stack status: $STACK_STATUS"
else
  unhealthy "Stack status: $STACK_STATUS"
fi

###############################################################################
# Check 2: Lambda Functions
###############################################################################

section "Lambda Functions"

LAMBDA_FUNCTIONS=$(aws lambda list-functions \
  --region "$AWS_REGION" \
  --query "Functions[?starts_with(FunctionName, '${STACK_NAME}')].FunctionName" \
  --output text)

if [[ -z "$LAMBDA_FUNCTIONS" ]]; then
  unhealthy "No Lambda functions found"
else
  for func in $LAMBDA_FUNCTIONS; do
    # Check state
    STATE=$(aws lambda get-function \
      --function-name "$func" \
      --region "$AWS_REGION" \
      --query 'Configuration.State' \
      --output text)

    if [[ "$STATE" == "Active" ]]; then
      healthy "$(basename "$func"): Active"
    else
      unhealthy "$(basename "$func"): $STATE"
    fi

    # Check recent errors
    ERRORS=$(get_metric "AWS/Lambda" "Errors" "Name=FunctionName,Value=$func")

    if [[ "$ERRORS" == "None" || "$ERRORS" == "0" || "$ERRORS" == "0.0" ]]; then
      healthy "  No errors in last 5 minutes"
    else
      warn "  $ERRORS errors in last 5 minutes"
    fi

    # Check throttles
    THROTTLES=$(get_metric "AWS/Lambda" "Throttles" "Name=FunctionName,Value=$func")

    if [[ "$THROTTLES" == "None" || "$THROTTLES" == "0" || "$THROTTLES" == "0.0" ]]; then
      healthy "  No throttles"
    else
      warn "  $THROTTLES throttles in last 5 minutes"
    fi
  done
fi

###############################################################################
# Check 3: DynamoDB Table
###############################################################################

section "DynamoDB Table"

TABLE_NAME=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='TableName'].OutputValue" \
  --output text 2>/dev/null || echo "")

if [[ -z "$TABLE_NAME" ]]; then
  unhealthy "Table name not found"
else
  TABLE_STATUS=$(aws dynamodb describe-table \
    --table-name "$TABLE_NAME" \
    --region "$AWS_REGION" \
    --query 'Table.TableStatus' \
    --output text)

  if [[ "$TABLE_STATUS" == "ACTIVE" ]]; then
    healthy "Table status: ACTIVE"
  else
    unhealthy "Table status: $TABLE_STATUS"
  fi

  # Check item count
  ITEM_COUNT=$(aws dynamodb describe-table \
    --table-name "$TABLE_NAME" \
    --region "$AWS_REGION" \
    --query 'Table.ItemCount' \
    --output text)

  healthy "Item count: $ITEM_COUNT"

  # Check throttles
  READ_THROTTLES=$(get_metric "AWS/DynamoDB" "ReadThrottleEvents" "Name=TableName,Value=$TABLE_NAME")
  WRITE_THROTTLES=$(get_metric "AWS/DynamoDB" "WriteThrottleEvents" "Name=TableName,Value=$TABLE_NAME")

  if [[ "$READ_THROTTLES" == "0" && "$WRITE_THROTTLES" == "0" ]]; then
    healthy "No throttling"
  else
    warn "Read throttles: $READ_THROTTLES, Write throttles: $WRITE_THROTTLES"
  fi
fi

###############################################################################
# Check 4: API Gateway
###############################################################################

section "API Gateway"

API_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='ApiEndpoint'].OutputValue" \
  --output text 2>/dev/null || echo "")

if [[ -z "$API_ENDPOINT" ]]; then
  unhealthy "API endpoint not found"
else
  # Test health endpoint
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${API_ENDPOINT}/health" --connect-timeout 5 2>/dev/null || echo "000")

  if [[ "$HTTP_CODE" == "200" ]]; then
    healthy "API health endpoint: HTTP $HTTP_CODE"
  else
    unhealthy "API health endpoint: HTTP $HTTP_CODE"
  fi

  # Check 5XX errors
  API_5XX=$(get_metric "AWS/ApiGateway" "5XXError" "Name=ApiName,Value=$STACK_NAME")

  if [[ "$API_5XX" == "None" || "$API_5XX" == "0" || "$API_5XX" == "0.0" ]]; then
    healthy "No 5XX errors"
  else
    warn "$API_5XX 5XX errors in last 5 minutes"
  fi
fi

###############################################################################
# Check 5: CloudWatch Alarms
###############################################################################

section "CloudWatch Alarms"

ALARMS=$(aws cloudwatch describe-alarms \
  --alarm-name-prefix "$STACK_NAME" \
  --state-value ALARM \
  --region "$AWS_REGION" \
  --query 'MetricAlarms[].AlarmName' \
  --output text 2>/dev/null || echo "")

if [[ -z "$ALARMS" ]]; then
  healthy "No alarms in ALARM state"
else
  ALARM_COUNT=$(echo "$ALARMS" | wc -w)
  unhealthy "$ALARM_COUNT alarm(s) in ALARM state:"
  for alarm in $ALARMS; do
    echo "    - $alarm"
  done
fi

###############################################################################
# Summary
###############################################################################

section "Health Check Summary"

echo ""
echo "Status:"
if [[ $CRITICAL_ISSUES -eq 0 ]]; then
  echo -e "  ${GREEN}●${NC} HEALTHY"
else
  echo -e "  ${RED}●${NC} UNHEALTHY"
fi

echo ""
echo "Issues:"
echo -e "  ${RED}Critical:${NC} $CRITICAL_ISSUES"
echo -e "  ${YELLOW}Warnings:${NC} $WARNINGS"
echo ""

if [[ $CRITICAL_ISSUES -eq 0 ]]; then
  echo -e "${GREEN}All systems operational${NC}"
  exit 0
else
  echo -e "${RED}Critical issues detected - review logs and metrics${NC}"
  echo ""
  echo "Investigate:"
  echo "  CloudWatch Logs:  https://${AWS_REGION}.console.aws.amazon.com/cloudwatch/home?region=${AWS_REGION}#logsV2:"
  echo "  CloudWatch Alarms: https://${AWS_REGION}.console.aws.amazon.com/cloudwatch/home?region=${AWS_REGION}#alarmsV2:"
  exit 1
fi
