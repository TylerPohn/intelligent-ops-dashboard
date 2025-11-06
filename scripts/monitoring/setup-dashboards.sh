#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${BLUE}[DASHBOARD]${NC} $1"; }
log_success() { echo -e "${GREEN}[DASHBOARD] ✓${NC} $1"; }
log_error() { echo -e "${RED}[DASHBOARD] ✗${NC} $1"; }
log_warning() { echo -e "${YELLOW}[DASHBOARD] ⚠${NC} $1"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

log "Setting up CloudWatch dashboards..."

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

log "Creating dashboard for:"
log "  Lambda: $LAMBDA_NAME"
log "  API Gateway: $API_ID"
log "  DynamoDB: $METRICS_TABLE, $INSIGHTS_TABLE"
log "  Region: $REGION"

# Create comprehensive dashboard
DASHBOARD_NAME="IOps-System-Dashboard"
DASHBOARD_BODY=$(cat <<EOF
{
  "widgets": [
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["AWS/Lambda", "Invocations", {"stat": "Sum", "label": "Total Invocations"}],
          [".", "Errors", {"stat": "Sum", "label": "Errors"}],
          [".", "Throttles", {"stat": "Sum", "label": "Throttles"}]
        ],
        "view": "timeSeries",
        "stacked": false,
        "region": "$REGION",
        "title": "Lambda Invocations & Errors",
        "period": 300,
        "yAxis": {"left": {"min": 0}}
      },
      "width": 12,
      "height": 6,
      "x": 0,
      "y": 0
    },
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["AWS/Lambda", "Duration", {"stat": "Average", "label": "Avg Duration"}],
          ["...", {"stat": "p50", "label": "p50"}],
          ["...", {"stat": "p95", "label": "p95"}],
          ["...", {"stat": "p99", "label": "p99"}]
        ],
        "view": "timeSeries",
        "stacked": false,
        "region": "$REGION",
        "title": "Lambda Duration (ms)",
        "period": 300,
        "yAxis": {"left": {"min": 0}}
      },
      "width": 12,
      "height": 6,
      "x": 12,
      "y": 0
    },
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["AWS/ApiGateway", "Count", {"stat": "Sum", "label": "Requests"}],
          [".", "4XXError", {"stat": "Sum", "label": "4XX Errors"}],
          [".", "5XXError", {"stat": "Sum", "label": "5XX Errors"}]
        ],
        "view": "timeSeries",
        "stacked": false,
        "region": "$REGION",
        "title": "API Gateway Requests",
        "period": 300,
        "yAxis": {"left": {"min": 0}}
      },
      "width": 12,
      "height": 6,
      "x": 0,
      "y": 6
    },
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["AWS/ApiGateway", "Latency", {"stat": "Average", "label": "Avg Latency"}],
          ["...", {"stat": "p50", "label": "p50"}],
          ["...", {"stat": "p95", "label": "p95"}],
          ["...", {"stat": "p99", "label": "p99"}]
        ],
        "view": "timeSeries",
        "stacked": false,
        "region": "$REGION",
        "title": "API Gateway Latency (ms)",
        "period": 300,
        "yAxis": {"left": {"min": 0}}
      },
      "width": 12,
      "height": 6,
      "x": 12,
      "y": 6
    },
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["AWS/DynamoDB", "ConsumedReadCapacityUnits", {"stat": "Sum", "label": "Read Units ($METRICS_TABLE)"}],
          [".", "ConsumedWriteCapacityUnits", {"stat": "Sum", "label": "Write Units ($METRICS_TABLE)"}]
        ],
        "view": "timeSeries",
        "stacked": false,
        "region": "$REGION",
        "title": "DynamoDB Consumed Capacity - Metrics",
        "period": 300,
        "yAxis": {"left": {"min": 0}}
      },
      "width": 12,
      "height": 6,
      "x": 0,
      "y": 12
    },
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["AWS/DynamoDB", "ConsumedReadCapacityUnits", {"stat": "Sum", "label": "Read Units ($INSIGHTS_TABLE)"}],
          [".", "ConsumedWriteCapacityUnits", {"stat": "Sum", "label": "Write Units ($INSIGHTS_TABLE)"}]
        ],
        "view": "timeSeries",
        "stacked": false,
        "region": "$REGION",
        "title": "DynamoDB Consumed Capacity - Insights",
        "period": 300,
        "yAxis": {"left": {"min": 0}}
      },
      "width": 12,
      "height": 6,
      "x": 12,
      "y": 12
    },
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["AWS/DynamoDB", "UserErrors", {"stat": "Sum", "label": "Throttles ($METRICS_TABLE)"}],
          ["...", {"stat": "Sum", "label": "Throttles ($INSIGHTS_TABLE)"}]
        ],
        "view": "timeSeries",
        "stacked": false,
        "region": "$REGION",
        "title": "DynamoDB Throttling",
        "period": 300,
        "yAxis": {"left": {"min": 0}}
      },
      "width": 12,
      "height": 6,
      "x": 0,
      "y": 18
    },
    {
      "type": "log",
      "properties": {
        "query": "SOURCE '/aws/lambda/$LAMBDA_NAME' | fields @timestamp, @message | filter @message like /ERROR/ | sort @timestamp desc | limit 20",
        "region": "$REGION",
        "title": "Recent Lambda Errors",
        "stacked": false
      },
      "width": 12,
      "height": 6,
      "x": 12,
      "y": 18
    }
  ]
}
EOF
)

# Create dashboard
log "Creating CloudWatch dashboard: $DASHBOARD_NAME"

aws cloudwatch put-dashboard \
    --dashboard-name "$DASHBOARD_NAME" \
    --dashboard-body "$DASHBOARD_BODY" \
    --region "$REGION" > /dev/null

log_success "Dashboard created successfully"

# Get dashboard URL
DASHBOARD_URL="https://console.aws.amazon.com/cloudwatch/home?region=$REGION#dashboards:name=$DASHBOARD_NAME"

log ""
log "=========================================="
log_success "Dashboard Setup Complete!"
log "=========================================="
log ""
log "Access your dashboard:"
log "  $DASHBOARD_URL"
log ""
log "The dashboard includes:"
log "  - Lambda invocations, errors, and duration metrics"
log "  - API Gateway request counts and latency"
log "  - DynamoDB capacity usage and throttling"
log "  - Recent error logs from Lambda"
log ""

# Create additional SageMaker dashboard if endpoint exists
if [ -n "$SAGEMAKER_ENDPOINT" ]; then
    log "Creating SageMaker dashboard..."

    SAGEMAKER_DASHBOARD="IOps-SageMaker-Dashboard"
    SAGEMAKER_BODY=$(cat <<EOF
{
  "widgets": [
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["AWS/SageMaker", "ModelInvocations", {"stat": "Sum"}],
          [".", "ModelLatency", {"stat": "Average"}]
        ],
        "view": "timeSeries",
        "stacked": false,
        "region": "$REGION",
        "title": "SageMaker Endpoint Metrics",
        "period": 300
      },
      "width": 24,
      "height": 6,
      "x": 0,
      "y": 0
    },
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["AWS/SageMaker", "CPUUtilization", {"stat": "Average"}],
          [".", "MemoryUtilization", {"stat": "Average"}]
        ],
        "view": "timeSeries",
        "stacked": false,
        "region": "$REGION",
        "title": "SageMaker Resource Utilization",
        "period": 300
      },
      "width": 24,
      "height": 6,
      "x": 0,
      "y": 6
    }
  ]
}
EOF
)

    aws cloudwatch put-dashboard \
        --dashboard-name "$SAGEMAKER_DASHBOARD" \
        --dashboard-body "$SAGEMAKER_BODY" \
        --region "$REGION" > /dev/null

    log_success "SageMaker dashboard created"
    log "  https://console.aws.amazon.com/cloudwatch/home?region=$REGION#dashboards:name=$SAGEMAKER_DASHBOARD"
fi

log ""
log "Pro tips:"
log "  - Dashboards auto-refresh every minute"
log "  - Click any metric to view detailed statistics"
log "  - Add custom widgets using 'Add widget' button"
log "  - Export metrics to CSV for offline analysis"
log "  - Set up CloudWatch Insights for advanced log queries"
