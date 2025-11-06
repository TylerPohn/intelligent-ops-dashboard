#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${BLUE}[CDK]${NC} $1"; }
log_success() { echo -e "${GREEN}[CDK] ✓${NC} $1"; }
log_error() { echo -e "${RED}[CDK] ✗${NC} $1"; }
log_warning() { echo -e "${YELLOW}[CDK] ⚠${NC} $1"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CDK_DIR="$PROJECT_ROOT/infrastructure"

log "Starting infrastructure deployment..."

# Validate environment variables
if [ -z "$CRITICAL_ALERT_EMAILS" ]; then
    log_warning "CRITICAL_ALERT_EMAILS not set, using default"
    export CRITICAL_ALERT_EMAILS="admin@example.com"
fi

# Navigate to CDK directory
cd "$CDK_DIR"

# Install CDK dependencies if needed
if [ ! -d "node_modules" ]; then
    log "Installing CDK dependencies..."
    npm install
fi

# Bootstrap CDK (if not already done)
log "Checking CDK bootstrap..."
aws cloudformation describe-stacks --stack-name CDKToolkit --region us-east-1 &>/dev/null || {
    log "Bootstrapping CDK..."
    npx cdk bootstrap
}
log_success "CDK bootstrap verified"

# Synthesize stack
log "Synthesizing CDK stack..."
npx cdk synth || {
    log_error "CDK synthesis failed"
    exit 1
}
log_success "CDK synthesis completed"

# Show diff
log "Showing infrastructure changes..."
npx cdk diff || log_warning "CDK diff showed changes"

# Deploy stack
log "Deploying CDK stack (this may take 5-10 minutes)..."
npx cdk deploy --require-approval never || {
    log_error "CDK deployment failed"
    exit 1
}
log_success "CDK stack deployed successfully"

# Verify resources
log "Verifying deployed resources..."

# Get stack outputs
STACK_NAME="IOpsInfrastructureStack"
log "Retrieving stack outputs..."

API_URL=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query 'Stacks[0].Outputs[?OutputKey==`ApiUrl`].OutputValue' \
    --output text 2>/dev/null || echo "")

METRICS_TABLE=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query 'Stacks[0].Outputs[?OutputKey==`MetricsTableName`].OutputValue' \
    --output text 2>/dev/null || echo "")

INSIGHTS_TABLE=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query 'Stacks[0].Outputs[?OutputKey==`InsightsTableName`].OutputValue' \
    --output text 2>/dev/null || echo "")

AI_LAMBDA=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query 'Stacks[0].Outputs[?OutputKey==`AiLambdaArn`].OutputValue' \
    --output text 2>/dev/null || echo "")

# Verify each resource
ERRORS=0

# API Gateway
if [ -n "$API_URL" ]; then
    log_success "API Gateway URL: $API_URL"
else
    log_error "API Gateway URL not found"
    ERRORS=$((ERRORS+1))
fi

# DynamoDB Tables
if [ -n "$METRICS_TABLE" ]; then
    log_success "Metrics Table: $METRICS_TABLE"
    # Verify table exists
    aws dynamodb describe-table --table-name "$METRICS_TABLE" &>/dev/null || {
        log_error "Metrics table not accessible"
        ERRORS=$((ERRORS+1))
    }
else
    log_error "Metrics table name not found"
    ERRORS=$((ERRORS+1))
fi

if [ -n "$INSIGHTS_TABLE" ]; then
    log_success "Insights Table: $INSIGHTS_TABLE"
    aws dynamodb describe-table --table-name "$INSIGHTS_TABLE" &>/dev/null || {
        log_error "Insights table not accessible"
        ERRORS=$((ERRORS+1))
    }
else
    log_error "Insights table name not found"
    ERRORS=$((ERRORS+1))
fi

# Lambda Functions
if [ -n "$AI_LAMBDA" ]; then
    log_success "AI Lambda ARN: $AI_LAMBDA"
    aws lambda get-function --function-name "$AI_LAMBDA" &>/dev/null || {
        log_error "AI Lambda not accessible"
        ERRORS=$((ERRORS+1))
    }
else
    log_error "AI Lambda ARN not found"
    ERRORS=$((ERRORS+1))
fi

# EventBridge Rules
RULE_COUNT=$(aws events list-rules --name-prefix "IOpsInfrastructureStack" --query 'length(Rules)' --output text 2>/dev/null || echo "0")
if [ "$RULE_COUNT" -gt 0 ]; then
    log_success "EventBridge Rules: $RULE_COUNT found"
else
    log_warning "No EventBridge rules found (expected at least 1)"
fi

# SNS Topics
TOPIC_COUNT=$(aws sns list-topics --query 'Topics[?contains(TopicArn, `IOps`)]' --output json 2>/dev/null | jq length || echo "0")
if [ "$TOPIC_COUNT" -gt 0 ]; then
    log_success "SNS Topics: $TOPIC_COUNT found"
    log_warning "Remember to confirm email subscriptions!"
else
    log_warning "No SNS topics found (expected at least 1)"
fi

# Summary
log "=========================================="
if [ $ERRORS -eq 0 ]; then
    log_success "Infrastructure deployment verified successfully!"
    log "All resources created and accessible"
else
    log_error "Infrastructure deployment completed with $ERRORS errors"
    log "Check CloudFormation console for details"
    exit 1
fi

log "=========================================="
log "Deployment Outputs:"
log "  API Gateway URL: ${API_URL:-'Not found'}"
log "  Metrics Table: ${METRICS_TABLE:-'Not found'}"
log "  Insights Table: ${INSIGHTS_TABLE:-'Not found'}"
log "  AI Lambda ARN: ${AI_LAMBDA:-'Not found'}"
log "=========================================="

# Save outputs to file for other scripts
OUTPUT_FILE="$PROJECT_ROOT/.deployment-outputs"
cat > "$OUTPUT_FILE" << EOF
API_URL=$API_URL
METRICS_TABLE=$METRICS_TABLE
INSIGHTS_TABLE=$INSIGHTS_TABLE
AI_LAMBDA=$AI_LAMBDA
EOF

log_success "Deployment outputs saved to: $OUTPUT_FILE"
