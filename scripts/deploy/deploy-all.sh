#!/bin/bash
###############################################################################
# IOps Dashboard - Complete Deployment Script
#
# This script deploys the entire IOps Dashboard infrastructure to AWS:
# - DynamoDB table with GSI
# - API Gateway REST endpoints
# - Lambda functions (ingest, query)
# - CloudWatch monitoring and alarms
# - SNS topics for alerts
#
# Usage:
#   ./deploy-all.sh [environment] [options]
#
# Arguments:
#   environment - Deployment environment (dev|staging|prod) [default: dev]
#
# Options:
#   --skip-tests       Skip validation tests after deployment
#   --enable-ai        Deploy with AI features enabled (USE_SAGEMAKER=false initially)
#   --dry-run          Show what would be deployed without deploying
#   --clean            Remove all resources before deployment
#
# Example:
#   ./deploy-all.sh prod --enable-ai
###############################################################################

set -e  # Exit on any error
set -u  # Exit on undefined variable
set -o pipefail  # Exit on pipe failures

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Default values
ENVIRONMENT="${1:-dev}"
SKIP_TESTS=false
ENABLE_AI=false
DRY_RUN=false
CLEAN=false

# Parse options
shift || true
while [[ $# -gt 0 ]]; do
  case $1 in
    --skip-tests)
      SKIP_TESTS=true
      shift
      ;;
    --enable-ai)
      ENABLE_AI=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --clean)
      CLEAN=true
      shift
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      exit 1
      ;;
  esac
done

# Validate environment
if [[ ! "$ENVIRONMENT" =~ ^(dev|staging|prod)$ ]]; then
  echo -e "${RED}Invalid environment: $ENVIRONMENT${NC}"
  echo "Valid environments: dev, staging, prod"
  exit 1
fi

# AWS Configuration
AWS_REGION="${AWS_REGION:-us-east-2}"
STACK_NAME="iops-dashboard-${ENVIRONMENT}"
CDK_DIR="${PROJECT_ROOT}/cdk"

# Deployment metadata
DEPLOYMENT_ID="deploy-$(date +%Y%m%d-%H%M%S)"
DEPLOYMENT_LOG="${PROJECT_ROOT}/logs/${DEPLOYMENT_ID}.log"

###############################################################################
# Helper Functions
###############################################################################

log() {
  echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $*" | tee -a "$DEPLOYMENT_LOG"
}

success() {
  echo -e "${GREEN}✓${NC} $*" | tee -a "$DEPLOYMENT_LOG"
}

error() {
  echo -e "${RED}✗${NC} $*" | tee -a "$DEPLOYMENT_LOG"
}

warning() {
  echo -e "${YELLOW}⚠${NC} $*" | tee -a "$DEPLOYMENT_LOG"
}

section() {
  echo ""
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}  $*${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
}

# Check if command exists
check_command() {
  if ! command -v "$1" &> /dev/null; then
    error "Required command not found: $1"
    return 1
  fi
  return 0
}

# Check AWS credentials
check_aws_credentials() {
  if ! aws sts get-caller-identity &> /dev/null; then
    error "AWS credentials not configured or invalid"
    echo "Run: aws configure"
    return 1
  fi
  return 0
}

# Get CloudFormation stack status
get_stack_status() {
  aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region "$AWS_REGION" \
    --query 'Stacks[0].StackStatus' \
    --output text 2>/dev/null || echo "NOT_FOUND"
}

# Wait for stack operation to complete
wait_for_stack() {
  local status
  log "Waiting for stack operation to complete..."

  while true; do
    status=$(get_stack_status)

    case $status in
      *_COMPLETE)
        success "Stack operation completed: $status"
        return 0
        ;;
      *_FAILED|*_ROLLBACK*)
        error "Stack operation failed: $status"
        return 1
        ;;
      NOT_FOUND)
        error "Stack not found"
        return 1
        ;;
      *)
        echo -n "."
        sleep 5
        ;;
    esac
  done
}

# Get stack outputs
get_stack_output() {
  local output_key="$1"
  aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region "$AWS_REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='${output_key}'].OutputValue" \
    --output text 2>/dev/null || echo ""
}

###############################################################################
# Pre-deployment Checks
###############################################################################

section "Pre-Deployment Checks"

log "Deployment Configuration:"
echo "  Environment:     $ENVIRONMENT"
echo "  Stack Name:      $STACK_NAME"
echo "  AWS Region:      $AWS_REGION"
echo "  Enable AI:       $ENABLE_AI"
echo "  Skip Tests:      $SKIP_TESTS"
echo "  Dry Run:         $DRY_RUN"
echo "  Clean Deploy:    $CLEAN"
echo "  Deployment ID:   $DEPLOYMENT_ID"

# Create logs directory
mkdir -p "${PROJECT_ROOT}/logs"

log "Checking required commands..."
check_command aws || exit 1
check_command npm || exit 1
check_command node || exit 1
check_command cdk || {
  warning "AWS CDK not found, installing..."
  npm install -g aws-cdk
}
success "All required commands available"

log "Checking AWS credentials..."
check_aws_credentials || exit 1
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
success "AWS credentials valid (Account: $ACCOUNT_ID)"

log "Checking project structure..."
[[ -d "$CDK_DIR" ]] || { error "CDK directory not found: $CDK_DIR"; exit 1; }
[[ -f "$CDK_DIR/package.json" ]] || { error "CDK package.json not found"; exit 1; }
success "Project structure valid"

# Check current stack status
CURRENT_STATUS=$(get_stack_status)
log "Current stack status: $CURRENT_STATUS"

if [[ "$CURRENT_STATUS" != "NOT_FOUND" && "$CLEAN" == "true" ]]; then
  warning "Clean deployment requested - will delete existing stack"
fi

if [[ "$DRY_RUN" == "true" ]]; then
  warning "DRY RUN MODE - No changes will be made"
fi

###############################################################################
# Clean Existing Resources (if requested)
###############################################################################

if [[ "$CLEAN" == "true" && "$CURRENT_STATUS" != "NOT_FOUND" ]]; then
  section "Cleaning Existing Resources"

  if [[ "$DRY_RUN" == "false" ]]; then
    log "Deleting existing stack: $STACK_NAME"
    aws cloudformation delete-stack \
      --stack-name "$STACK_NAME" \
      --region "$AWS_REGION"

    wait_for_stack || {
      error "Failed to delete stack"
      exit 1
    }
    success "Existing stack deleted"
  else
    log "Would delete stack: $STACK_NAME"
  fi
fi

###############################################################################
# Install Dependencies
###############################################################################

section "Installing Dependencies"

log "Installing CDK dependencies..."
cd "$CDK_DIR"
if [[ "$DRY_RUN" == "false" ]]; then
  npm install
  success "CDK dependencies installed"
else
  log "Would run: npm install"
fi

log "Installing frontend dependencies..."
cd "${PROJECT_ROOT}/frontend"
if [[ "$DRY_RUN" == "false" ]]; then
  npm install
  success "Frontend dependencies installed"
else
  log "Would run: npm install"
fi

cd "$PROJECT_ROOT"

###############################################################################
# Bootstrap CDK (if needed)
###############################################################################

section "CDK Bootstrap"

log "Checking CDK bootstrap status..."
BOOTSTRAP_STACK="CDKToolkit"
BOOTSTRAP_STATUS=$(aws cloudformation describe-stacks \
  --stack-name "$BOOTSTRAP_STACK" \
  --region "$AWS_REGION" \
  --query 'Stacks[0].StackStatus' \
  --output text 2>/dev/null || echo "NOT_FOUND")

if [[ "$BOOTSTRAP_STATUS" == "NOT_FOUND" ]]; then
  log "Bootstrapping CDK in account $ACCOUNT_ID / region $AWS_REGION"
  if [[ "$DRY_RUN" == "false" ]]; then
    cd "$CDK_DIR"
    npx cdk bootstrap "aws://${ACCOUNT_ID}/${AWS_REGION}"
    success "CDK bootstrapped"
    cd "$PROJECT_ROOT"
  else
    log "Would run: cdk bootstrap"
  fi
else
  success "CDK already bootstrapped"
fi

###############################################################################
# Synthesize CDK Stack
###############################################################################

section "Synthesizing CDK Stack"

cd "$CDK_DIR"

log "Running CDK synth..."
if [[ "$DRY_RUN" == "false" ]]; then
  npx cdk synth --app "npx ts-node bin/cdk.ts" > /dev/null
  success "CDK synthesis successful"
else
  log "Would run: cdk synth"
fi

###############################################################################
# Deploy CDK Stack
###############################################################################

section "Deploying CDK Stack"

log "Deploying stack: $STACK_NAME"

# Set environment variables for deployment
export ENVIRONMENT="$ENVIRONMENT"
if [[ "$ENABLE_AI" == "true" ]]; then
  export AI_ENABLED="true"
  export USE_SAGEMAKER="false"  # Start with local inference
  log "AI features will be enabled (USE_SAGEMAKER=false)"
else
  export AI_ENABLED="false"
  log "AI features disabled"
fi

if [[ "$DRY_RUN" == "false" ]]; then
  npx cdk deploy \
    --app "npx ts-node bin/cdk.ts" \
    --require-approval never \
    --region "$AWS_REGION" \
    --all

  success "Stack deployed successfully"
else
  log "Would run: cdk deploy --all"
fi

cd "$PROJECT_ROOT"

###############################################################################
# Capture Stack Outputs
###############################################################################

section "Capturing Stack Outputs"

if [[ "$DRY_RUN" == "false" ]]; then
  log "Retrieving stack outputs..."

  API_ENDPOINT=$(get_stack_output "ApiEndpoint")
  WEBSOCKET_URL=$(get_stack_output "WebSocketUrl")
  TABLE_NAME=$(get_stack_output "TableName")

  if [[ -n "$API_ENDPOINT" ]]; then
    success "API Endpoint: $API_ENDPOINT"
  else
    warning "API Endpoint not found in outputs"
  fi

  if [[ -n "$WEBSOCKET_URL" ]]; then
    success "WebSocket URL: $WEBSOCKET_URL"
  else
    warning "WebSocket URL not found in outputs"
  fi

  if [[ -n "$TABLE_NAME" ]]; then
    success "DynamoDB Table: $TABLE_NAME"
  else
    warning "Table name not found in outputs"
  fi

  # Save outputs to file
  OUTPUTS_FILE="${PROJECT_ROOT}/.deployment-outputs-${ENVIRONMENT}.json"
  cat > "$OUTPUTS_FILE" <<EOF
{
  "environment": "$ENVIRONMENT",
  "deploymentId": "$DEPLOYMENT_ID",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "region": "$AWS_REGION",
  "stackName": "$STACK_NAME",
  "apiEndpoint": "$API_ENDPOINT",
  "webSocketUrl": "$WEBSOCKET_URL",
  "tableName": "$TABLE_NAME",
  "aiEnabled": $ENABLE_AI
}
EOF
  success "Outputs saved to: $OUTPUTS_FILE"
else
  log "Would capture stack outputs"
fi

###############################################################################
# Post-Deployment Configuration
###############################################################################

section "Post-Deployment Configuration"

if [[ "$DRY_RUN" == "false" ]]; then
  # Configure frontend environment
  if [[ -n "$API_ENDPOINT" ]]; then
    log "Configuring frontend environment..."
    FRONTEND_ENV="${PROJECT_ROOT}/frontend/.env.${ENVIRONMENT}"
    cat > "$FRONTEND_ENV" <<EOF
# Generated by deployment script
# Deployment ID: $DEPLOYMENT_ID
VITE_API_ENDPOINT=$API_ENDPOINT
VITE_WEBSOCKET_URL=$WEBSOCKET_URL
VITE_ENVIRONMENT=$ENVIRONMENT
EOF
    success "Frontend environment configured: $FRONTEND_ENV"
  fi

  # Set up CloudWatch Logs retention
  log "Configuring CloudWatch Logs retention..."
  for log_group in $(aws logs describe-log-groups \
    --region "$AWS_REGION" \
    --log-group-name-prefix "/aws/lambda/${STACK_NAME}" \
    --query 'logGroups[].logGroupName' \
    --output text); do
    aws logs put-retention-policy \
      --log-group-name "$log_group" \
      --retention-in-days 7 \
      --region "$AWS_REGION" 2>/dev/null || true
  done
  success "CloudWatch Logs retention configured (7 days)"
else
  log "Would configure post-deployment settings"
fi

###############################################################################
# Validation Tests
###############################################################################

if [[ "$SKIP_TESTS" == "false" && "$DRY_RUN" == "false" ]]; then
  section "Running Validation Tests"

  log "Running validation script..."
  if [[ -x "${SCRIPT_DIR}/validate-deployment.sh" ]]; then
    "${SCRIPT_DIR}/validate-deployment.sh" "$ENVIRONMENT" || {
      error "Validation tests failed"
      exit 1
    }
    success "All validation tests passed"
  else
    warning "Validation script not found or not executable"
  fi
else
  warning "Skipping validation tests"
fi

###############################################################################
# Deployment Summary
###############################################################################

section "Deployment Summary"

cat <<EOF

Deployment completed successfully!

Environment:        $ENVIRONMENT
Deployment ID:      $DEPLOYMENT_ID
Stack Name:         $STACK_NAME
Region:             $AWS_REGION

EOF

if [[ -n "$API_ENDPOINT" ]]; then
cat <<EOF
📡 API Endpoint:    $API_ENDPOINT
🔌 WebSocket URL:   $WEBSOCKET_URL
💾 DynamoDB Table:  $TABLE_NAME

EOF
fi

cat <<EOF
📊 CloudWatch Dashboards:
   https://${AWS_REGION}.console.aws.amazon.com/cloudwatch/home?region=${AWS_REGION}#dashboards:name=${STACK_NAME}

📝 CloudWatch Logs:
   https://${AWS_REGION}.console.aws.amazon.com/cloudwatch/home?region=${AWS_REGION}#logsV2:log-groups/log-group/\$252Faws\$252Flambda\$252F${STACK_NAME}

💰 Cost Explorer:
   https://console.aws.amazon.com/cost-management/home?region=${AWS_REGION}#/cost-explorer

EOF

if [[ "$ENABLE_AI" == "true" ]]; then
cat <<EOF
🤖 AI Features:     ENABLED (USE_SAGEMAKER=false)

   To enable SageMaker inference:
   $ ./scripts/deploy/switch-to-sagemaker.sh $ENVIRONMENT

EOF
fi

cat <<EOF
📖 Documentation:   docs/deployment-guide.md
🔧 Logs:            $DEPLOYMENT_LOG

Next Steps:
1. Test the API endpoints: curl $API_ENDPOINT/health
2. Generate test data: npm run generate:demo
3. Open dashboard: cd frontend && npm run dev
4. Monitor metrics: Check CloudWatch dashboards

EOF

success "Deployment complete! 🚀"

# Cleanup
cd "$PROJECT_ROOT"
exit 0
