#!/bin/bash
###############################################################################
# IOps Dashboard - Switch to SageMaker Inference
#
# This script performs a canary deployment to switch from local ML inference
# to AWS SageMaker endpoints for production-grade AI predictions.
#
# Process:
# 1. Train ML model and deploy to SageMaker endpoint
# 2. Update Lambda environment to enable SageMaker
# 3. Gradually roll out traffic: 10% → 25% → 50% → 100%
# 4. Monitor performance and costs at each stage
# 5. Rollback if issues detected
#
# Usage:
#   ./switch-to-sagemaker.sh [environment] [options]
#
# Options:
#   --stage STAGE       Deployment stage (10|25|50|100) [default: 10]
#   --monitor-time MIN  Minutes to monitor before next stage [default: 30]
#   --auto-rollout      Automatically progress through stages
#   --rollback          Rollback to local inference
#
# Example:
#   # Manual canary with monitoring
#   ./switch-to-sagemaker.sh prod --stage 10
#   # Check metrics for 30 min, then:
#   ./switch-to-sagemaker.sh prod --stage 25
#
#   # Automated rollout
#   ./switch-to-sagemaker.sh prod --auto-rollout
#
#   # Emergency rollback
#   ./switch-to-sagemaker.sh prod --rollback
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

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Configuration
ENVIRONMENT="${1:-dev}"
STAGE=10
MONITOR_TIME=30
AUTO_ROLLOUT=false
ROLLBACK=false

# Parse options
shift || true
while [[ $# -gt 0 ]]; do
  case $1 in
    --stage)
      STAGE="$2"
      shift 2
      ;;
    --monitor-time)
      MONITOR_TIME="$2"
      shift 2
      ;;
    --auto-rollout)
      AUTO_ROLLOUT=true
      shift
      ;;
    --rollback)
      ROLLBACK=true
      shift
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      exit 1
      ;;
  esac
done

# AWS Configuration
AWS_REGION="${AWS_REGION:-us-east-2}"
STACK_NAME="iops-dashboard-${ENVIRONMENT}"

# Validate stage
if [[ ! "$STAGE" =~ ^(10|25|50|100)$ ]]; then
  echo -e "${RED}Invalid stage: $STAGE${NC}"
  echo "Valid stages: 10, 25, 50, 100"
  exit 1
fi

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

get_lambda_function() {
  aws lambda list-functions \
    --region "$AWS_REGION" \
    --query "Functions[?starts_with(FunctionName, '${STACK_NAME}') && contains(FunctionName, 'AI')].FunctionName" \
    --output text 2>/dev/null | head -n1
}

update_lambda_env() {
  local func_name="$1"
  local use_sagemaker="$2"
  local traffic_percentage="$3"

  log "Updating Lambda environment: USE_SAGEMAKER=$use_sagemaker, SAGEMAKER_TRAFFIC_PCT=$traffic_percentage"

  aws lambda update-function-configuration \
    --function-name "$func_name" \
    --region "$AWS_REGION" \
    --environment "Variables={
      USE_SAGEMAKER=$use_sagemaker,
      SAGEMAKER_TRAFFIC_PCT=$traffic_percentage,
      SAGEMAKER_ENDPOINT=iops-ml-endpoint-${ENVIRONMENT}
    }" \
    --no-cli-pager > /dev/null

  # Wait for update to complete
  aws lambda wait function-updated \
    --function-name "$func_name" \
    --region "$AWS_REGION"
}

get_current_metrics() {
  local func_name="$1"
  local metric_name="$2"
  local start_time="$3"

  aws cloudwatch get-metric-statistics \
    --namespace AWS/Lambda \
    --metric-name "$metric_name" \
    --dimensions Name=FunctionName,Value="$func_name" \
    --start-time "$start_time" \
    --end-time "$(date -u +%Y-%m-%dT%H:%M:%S)" \
    --period 300 \
    --statistics Average,Sum \
    --region "$AWS_REGION" \
    --query 'Datapoints[0]' \
    --output json 2>/dev/null || echo "{}"
}

check_sagemaker_endpoint() {
  local endpoint_name="iops-ml-endpoint-${ENVIRONMENT}"

  local status=$(aws sagemaker describe-endpoint \
    --endpoint-name "$endpoint_name" \
    --region "$AWS_REGION" \
    --query 'EndpointStatus' \
    --output text 2>/dev/null || echo "NOT_FOUND")

  echo "$status"
}

###############################################################################
# Rollback Function
###############################################################################

perform_rollback() {
  section "Rolling Back to Local Inference"

  local func_name=$(get_lambda_function)

  if [[ -z "$func_name" ]]; then
    error "AI Lambda function not found"
    exit 1
  fi

  log "Disabling SageMaker for function: $func_name"

  update_lambda_env "$func_name" "false" "0"

  success "Rolled back to local inference"
  log "All traffic now using local ML inference"

  exit 0
}

###############################################################################
# Main Deployment Logic
###############################################################################

if [[ "$ROLLBACK" == "true" ]]; then
  perform_rollback
fi

section "SageMaker Canary Deployment - Stage: ${STAGE}%"

log "Environment:     $ENVIRONMENT"
log "Target Stage:    ${STAGE}%"
log "Monitor Time:    ${MONITOR_TIME} minutes"
log "Auto Rollout:    $AUTO_ROLLOUT"

###############################################################################
# Step 1: Verify Prerequisites
###############################################################################

section "Verifying Prerequisites"

# Check if SageMaker endpoint exists
log "Checking SageMaker endpoint..."
ENDPOINT_STATUS=$(check_sagemaker_endpoint)

if [[ "$ENDPOINT_STATUS" == "InService" ]]; then
  success "SageMaker endpoint is InService"
elif [[ "$ENDPOINT_STATUS" == "NOT_FOUND" ]]; then
  error "SageMaker endpoint not found"
  echo ""
  echo "You must train and deploy the ML model first:"
  echo "  1. Run training script: npm run train:ml"
  echo "  2. Wait for training to complete (~10 minutes)"
  echo "  3. Re-run this script"
  exit 1
else
  error "SageMaker endpoint is not ready: $ENDPOINT_STATUS"
  echo "Wait for endpoint to reach InService status"
  exit 1
fi

# Find AI Lambda function
LAMBDA_FUNCTION=$(get_lambda_function)

if [[ -z "$LAMBDA_FUNCTION" ]]; then
  error "AI Lambda function not found in stack: $STACK_NAME"
  exit 1
fi

success "Found AI Lambda function: $LAMBDA_FUNCTION"

# Check current configuration
CURRENT_USE_SAGEMAKER=$(aws lambda get-function-configuration \
  --function-name "$LAMBDA_FUNCTION" \
  --region "$AWS_REGION" \
  --query 'Environment.Variables.USE_SAGEMAKER' \
  --output text 2>/dev/null || echo "false")

CURRENT_TRAFFIC=$(aws lambda get-function-configuration \
  --function-name "$LAMBDA_FUNCTION" \
  --region "$AWS_REGION" \
  --query 'Environment.Variables.SAGEMAKER_TRAFFIC_PCT' \
  --output text 2>/dev/null || echo "0")

log "Current configuration: USE_SAGEMAKER=$CURRENT_USE_SAGEMAKER, TRAFFIC=${CURRENT_TRAFFIC}%"

###############################################################################
# Step 2: Baseline Metrics Capture
###############################################################################

section "Capturing Baseline Metrics"

START_TIME=$(date -u -d '5 minutes ago' +%Y-%m-%dT%H:%M:%S)

log "Collecting metrics from last 5 minutes..."

BASELINE_ERRORS=$(get_current_metrics "$LAMBDA_FUNCTION" "Errors" "$START_TIME" | jq -r '.Sum // 0')
BASELINE_DURATION=$(get_current_metrics "$LAMBDA_FUNCTION" "Duration" "$START_TIME" | jq -r '.Average // 0')
BASELINE_INVOCATIONS=$(get_current_metrics "$LAMBDA_FUNCTION" "Invocations" "$START_TIME" | jq -r '.Sum // 0')

success "Baseline Errors:      $BASELINE_ERRORS"
success "Baseline Duration:    ${BASELINE_DURATION}ms"
success "Baseline Invocations: $BASELINE_INVOCATIONS"

###############################################################################
# Step 3: Deploy New Configuration
###############################################################################

section "Deploying Stage ${STAGE}%"

log "Updating Lambda configuration to route ${STAGE}% traffic to SageMaker..."

update_lambda_env "$LAMBDA_FUNCTION" "true" "$STAGE"

success "Configuration updated"
log "Waiting 30 seconds for changes to propagate..."
sleep 30

###############################################################################
# Step 4: Monitor Metrics
###############################################################################

section "Monitoring Deployment (${MONITOR_TIME} minutes)"

log "Monitoring Lambda metrics for issues..."
log "Will check every minute for $MONITOR_TIME minutes"
log "Press Ctrl+C to stop monitoring and rollback"

MONITOR_SECONDS=$((MONITOR_TIME * 60))
CHECK_INTERVAL=60
CHECKS=$((MONITOR_SECONDS / CHECK_INTERVAL))

ISSUES_DETECTED=false

for ((i=1; i<=CHECKS; i++)); do
  sleep $CHECK_INTERVAL

  CHECK_START=$(date -u -d '2 minutes ago' +%Y-%m-%dT%H:%M:%S)

  # Get current metrics
  CURRENT_ERRORS=$(get_current_metrics "$LAMBDA_FUNCTION" "Errors" "$CHECK_START" | jq -r '.Sum // 0')
  CURRENT_DURATION=$(get_current_metrics "$LAMBDA_FUNCTION" "Duration" "$CHECK_START" | jq -r '.Average // 0')
  CURRENT_INVOCATIONS=$(get_current_metrics "$LAMBDA_FUNCTION" "Invocations" "$CHECK_START" | jq -r '.Sum // 0')

  # Calculate changes
  ERROR_INCREASE=$(echo "$CURRENT_ERRORS - $BASELINE_ERRORS" | bc 2>/dev/null || echo "0")
  DURATION_INCREASE=$(echo "scale=2; (($CURRENT_DURATION - $BASELINE_DURATION) / $BASELINE_DURATION) * 100" | bc 2>/dev/null || echo "0")

  log "Check $i/$CHECKS - Errors: $CURRENT_ERRORS (+$ERROR_INCREASE), Duration: ${CURRENT_DURATION}ms (+${DURATION_INCREASE}%), Invocations: $CURRENT_INVOCATIONS"

  # Check for issues
  if (( $(echo "$ERROR_INCREASE > 5" | bc -l) )); then
    error "Error rate increased significantly: +$ERROR_INCREASE errors"
    ISSUES_DETECTED=true
    break
  fi

  if (( $(echo "$DURATION_INCREASE > 50" | bc -l) )); then
    error "Duration increased significantly: +${DURATION_INCREASE}%"
    ISSUES_DETECTED=true
    break
  fi

  if (( $(echo "$CURRENT_ERRORS > 10" | bc -l) )); then
    error "High error count: $CURRENT_ERRORS errors"
    ISSUES_DETECTED=true
    break
  fi
done

###############################################################################
# Step 5: Decision Point
###############################################################################

section "Deployment Assessment"

if [[ "$ISSUES_DETECTED" == "true" ]]; then
  error "Issues detected during monitoring"
  echo ""
  echo "Recommendation: ROLLBACK"
  echo ""
  read -p "Rollback to local inference? (y/N) " -n 1 -r
  echo

  if [[ $REPLY =~ ^[Yy]$ ]]; then
    perform_rollback
  else
    warning "Continuing with SageMaker deployment (manual override)"
  fi
else
  success "No issues detected during monitoring period"

  if [[ "$STAGE" == "100" ]]; then
    success "Full rollout complete! 🎉"
    echo ""
    echo "100% of traffic is now using SageMaker inference"
    echo ""
    echo "Monitor costs and performance:"
    echo "  CloudWatch: https://console.aws.amazon.com/cloudwatch"
    echo "  SageMaker:  https://console.aws.amazon.com/sagemaker"
    exit 0
  fi

  # Suggest next stage
  NEXT_STAGE=25
  if [[ "$STAGE" == "25" ]]; then
    NEXT_STAGE=50
  elif [[ "$STAGE" == "50" ]]; then
    NEXT_STAGE=100
  fi

  echo ""
  echo "Current stage (${STAGE}%) is stable"
  echo ""

  if [[ "$AUTO_ROLLOUT" == "true" ]]; then
    log "Auto-rollout enabled, proceeding to ${NEXT_STAGE}%..."
    sleep 5
    exec "$0" "$ENVIRONMENT" --stage "$NEXT_STAGE" --monitor-time "$MONITOR_TIME" --auto-rollout
  else
    echo "Next steps:"
    echo "  1. Review metrics in CloudWatch"
    echo "  2. Check SageMaker endpoint health"
    echo "  3. When ready, deploy next stage:"
    echo "     ./switch-to-sagemaker.sh $ENVIRONMENT --stage $NEXT_STAGE"
  fi
fi

###############################################################################
# Summary
###############################################################################

section "Deployment Summary"

cat <<EOF

Stage ${STAGE}% deployment complete!

Configuration:
  Environment:        $ENVIRONMENT
  Lambda Function:    $LAMBDA_FUNCTION
  SageMaker Traffic:  ${STAGE}%
  Local Traffic:      $((100 - STAGE))%

Current Metrics:
  Invocations:        $CURRENT_INVOCATIONS
  Errors:             $CURRENT_ERRORS
  Avg Duration:       ${CURRENT_DURATION}ms

Next Steps:
EOF

if [[ "$STAGE" == "100" ]]; then
cat <<EOF
  ✓ Full rollout complete
  - Monitor costs daily
  - Set up budget alerts
  - Review model performance weekly
EOF
else
cat <<EOF
  - Monitor for ${MONITOR_TIME} more minutes
  - Review CloudWatch metrics
  - If stable, proceed to ${NEXT_STAGE}%:
    ./switch-to-sagemaker.sh $ENVIRONMENT --stage $NEXT_STAGE
  - If issues, rollback:
    ./switch-to-sagemaker.sh $ENVIRONMENT --rollback
EOF
fi

echo ""
success "Canary deployment successful! 🚀"

exit 0
