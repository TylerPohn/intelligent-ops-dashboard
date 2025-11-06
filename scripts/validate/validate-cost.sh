#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${BLUE}[COST]${NC} $1"; }
log_success() { echo -e "${GREEN}[COST] ✓${NC} $1"; }
log_error() { echo -e "${RED}[COST] ✗${NC} $1"; }
log_warning() { echo -e "${YELLOW}[COST] ⚠${NC} $1"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

log "Starting cost validation..."

# Get current month dates
START_DATE=$(date -u +"%Y-%m-01")
END_DATE=$(date -u -v+1m +"%Y-%m-01")

log "Analyzing costs from $START_DATE to $END_DATE"

# Query AWS Cost Explorer
log "Querying AWS Cost Explorer API..."

COST_DATA=$(aws ce get-cost-and-usage \
    --time-period Start="$START_DATE",End="$END_DATE" \
    --granularity MONTHLY \
    --metrics UnblendedCost \
    --group-by Type=SERVICE \
    2>/dev/null || echo "{}")

if [ "$COST_DATA" == "{}" ]; then
    log_warning "Could not retrieve cost data from AWS Cost Explorer"
    log "Note: Cost data may take up to 24 hours to appear"
    log "Estimated costs based on usage:"

    # Load deployment outputs
    if [ -f "$PROJECT_ROOT/.deployment-outputs" ]; then
        source "$PROJECT_ROOT/.deployment-outputs"

        log ""
        log "Estimated Monthly Costs (with FREE TIER):"
        log "----------------------------------------"
        log "API Gateway:       $5-10  (1M requests free, then $3.50/M)"
        log "Lambda:            $0-5   (1M requests + 400K GB-sec free)"
        log "DynamoDB:          $0-2   (25 GB + 200M requests free with on-demand)"
        log "EventBridge:       $0-1   (All state changes free, custom events $1/M)"
        log "SNS:               $0-1   (Email: first 1,000 free, then $2/100K)"
        log "CloudWatch:        $0-5   (10 metrics + 1M API requests free)"
        log "S3 (if used):      $0-2   (5GB free, then $0.023/GB)"
        log "SageMaker:         $0-50  (Only if endpoint deployed - $0.05/hour)"
        log "----------------------------------------"
        log "Projected Total:   $5-75/month"
        log "  - WITHOUT SageMaker: ~$5-15/month"
        log "  - WITH SageMaker:    ~$40-75/month"
        log ""
    fi

    exit 0
fi

# Parse cost data
TOTAL_COST=$(echo "$COST_DATA" | jq -r '.ResultsByTime[0].Total.UnblendedCost.Amount' 2>/dev/null || echo "0")
CURRENCY=$(echo "$COST_DATA" | jq -r '.ResultsByTime[0].Total.UnblendedCost.Unit' 2>/dev/null || echo "USD")

log ""
log "=========================================="
log "Current Month Cost Analysis"
log "=========================================="
log "Total Cost (MTD): $TOTAL_COST $CURRENCY"
log ""

# Calculate projected monthly cost
DAYS_IN_MONTH=$(date -u +"%d")
DAYS_REMAINING=$((30 - DAYS_IN_MONTH))
DAILY_AVERAGE=$(echo "scale=2; $TOTAL_COST / $DAYS_IN_MONTH" | bc 2>/dev/null || echo "0")
PROJECTED_COST=$(echo "scale=2; $DAILY_AVERAGE * 30" | bc 2>/dev/null || echo "0")

log "Daily Average: \$$DAILY_AVERAGE"
log "Projected Monthly: \$$PROJECTED_COST (based on $DAYS_IN_MONTH days)"
log ""

# Break down by service
log "Cost Breakdown by Service:"
log "----------------------------------------"

echo "$COST_DATA" | jq -r '.ResultsByTime[0].Groups[] | "\(.Keys[0]): $\(.Metrics.UnblendedCost.Amount)"' | while read -r line; do
    SERVICE=$(echo "$line" | cut -d: -f1)
    COST=$(echo "$line" | cut -d: -f2- | xargs)
    log "  $SERVICE: $COST"
done

log "----------------------------------------"

# Alert if over budget
BUDGET_THRESHOLD=50

OVER_BUDGET=$(echo "$PROJECTED_COST > $BUDGET_THRESHOLD" | bc -l 2>/dev/null || echo "0")

log ""
if [ "$OVER_BUDGET" -eq 1 ]; then
    log_warning "⚠️  BUDGET ALERT: Projected cost (\$$PROJECTED_COST) exceeds threshold (\$$BUDGET_THRESHOLD)"
    log ""
    log "Cost Optimization Recommendations:"
    log "  1. Review SageMaker endpoint usage (highest cost)"
    log "  2. Consider using SageMaker only during peak hours"
    log "  3. Enable DynamoDB auto-scaling based on actual usage"
    log "  4. Review CloudWatch logs retention period"
    log "  5. Enable S3 lifecycle policies for old data"
else
    log_success "✓ Projected cost (\$$PROJECTED_COST) within budget (\$$BUDGET_THRESHOLD)"
fi

# Check for free tier eligibility
log ""
log "Free Tier Status:"
log "----------------------------------------"

# Calculate account age (free tier is first 12 months)
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ACCOUNT_CREATED=$(aws iam get-account-summary --query 'SummaryMap.AccountCreationTime' --output text 2>/dev/null || echo "")

if [ -n "$ACCOUNT_CREATED" ]; then
    ACCOUNT_AGE_DAYS=$(( ($(date +%s) - $(date -j -f "%Y-%m-%dT%H:%M:%S" "$ACCOUNT_CREATED" +%s 2>/dev/null || echo "0")) / 86400 ))

    if [ "$ACCOUNT_AGE_DAYS" -lt 365 ]; then
        log_success "Account is eligible for 12-month free tier ($ACCOUNT_AGE_DAYS days old)"
        log "Many IOps services are covered by free tier!"
    else
        log "Account is beyond 12-month free tier period"
        log "Always-free services still apply (Lambda, DynamoDB on-demand, etc.)"
    fi
else
    log_warning "Could not determine account age"
fi

# Generate cost report
REPORT_FILE="$PROJECT_ROOT/cost-report-$(date +%Y%m%d).json"
echo "$COST_DATA" | jq '.' > "$REPORT_FILE"
log ""
log_success "Detailed cost report saved to: $REPORT_FILE"

# Cost optimization tips
log ""
log "Cost Optimization Tips:"
log "----------------------------------------"
log "1. Use DynamoDB on-demand pricing for variable workloads"
log "2. Enable Lambda reserved concurrency for predictable workloads"
log "3. Use CloudWatch Logs Insights instead of exporting all logs"
log "4. Implement API Gateway caching to reduce Lambda invocations"
log "5. Use S3 Intelligent-Tiering for historical data storage"
log "6. Consider AWS Budgets for automated cost alerts"
log ""

# Create cost alarm recommendation
log "To create a cost alarm, run:"
log "  aws budgets create-budget --account-id $ACCOUNT_ID --budget file://budget.json"
log ""

# Generate sample budget configuration
cat > "$PROJECT_ROOT/budget-template.json" << EOF
{
  "BudgetName": "IOps-Monthly-Budget",
  "BudgetLimit": {
    "Amount": "$BUDGET_THRESHOLD",
    "Unit": "USD"
  },
  "TimeUnit": "MONTHLY",
  "BudgetType": "COST",
  "CostFilters": {},
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

log_success "Budget template created: $PROJECT_ROOT/budget-template.json"

log ""
log "=========================================="
log_success "Cost validation completed"
log "=========================================="
