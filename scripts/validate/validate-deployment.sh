#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${BLUE}[VALIDATE]${NC} $1"; }
log_success() { echo -e "${GREEN}[VALIDATE] ✓${NC} $1"; }
log_error() { echo -e "${RED}[VALIDATE] ✗${NC} $1"; }
log_warning() { echo -e "${YELLOW}[VALIDATE] ⚠${NC} $1"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

log "Starting deployment validation..."

# Load deployment outputs
if [ ! -f "$PROJECT_ROOT/.deployment-outputs" ]; then
    log_error "Deployment outputs not found"
    exit 1
fi

source "$PROJECT_ROOT/.deployment-outputs"

ERRORS=0
WARNINGS=0

# Test 1: API Gateway Health
log "=========================================="
log "TEST 1: API Gateway Health Check"
log "=========================================="

if [ -n "$API_URL" ]; then
    # Test root endpoint
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL" || echo "000")

    if [ "$HTTP_CODE" == "200" ] || [ "$HTTP_CODE" == "404" ]; then
        log_success "API Gateway responding (HTTP $HTTP_CODE)"
    else
        log_error "API Gateway not responding (HTTP $HTTP_CODE)"
        ERRORS=$((ERRORS+1))
    fi

    # Test metrics endpoint
    if [[ "$API_URL" == */ ]]; then
        METRICS_URL="${API_URL}metrics"
    else
        METRICS_URL="${API_URL}/metrics"
    fi

    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$METRICS_URL" || echo "000")

    if [ "$HTTP_CODE" == "200" ] || [ "$HTTP_CODE" == "403" ]; then
        log_success "Metrics endpoint accessible (HTTP $HTTP_CODE)"
    else
        log_warning "Metrics endpoint returned HTTP $HTTP_CODE"
        WARNINGS=$((WARNINGS+1))
    fi
else
    log_error "API_URL not found in deployment outputs"
    ERRORS=$((ERRORS+1))
fi

# Test 2: Lambda Functions
log "=========================================="
log "TEST 2: Lambda Function Health"
log "=========================================="

if [ -n "$AI_LAMBDA" ]; then
    LAMBDA_NAME=$(echo "$AI_LAMBDA" | awk -F: '{print $NF}')

    # Get Lambda status
    LAMBDA_STATE=$(aws lambda get-function \
        --function-name "$LAMBDA_NAME" \
        --query 'Configuration.State' \
        --output text 2>/dev/null || echo "NotFound")

    if [ "$LAMBDA_STATE" == "Active" ]; then
        log_success "AI Lambda is Active: $LAMBDA_NAME"

        # Check recent errors
        ERROR_COUNT=$(aws cloudwatch get-metric-statistics \
            --namespace AWS/Lambda \
            --metric-name Errors \
            --dimensions Name=FunctionName,Value="$LAMBDA_NAME" \
            --start-time "$(date -u -v-15M +"%Y-%m-%dT%H:%M:%S")" \
            --end-time "$(date -u +"%Y-%m-%dT%H:%M:%S")" \
            --period 900 \
            --statistics Sum \
            --query 'Datapoints[0].Sum' \
            --output text 2>/dev/null || echo "0")

        ERROR_COUNT=${ERROR_COUNT:-0}
        if [ "$ERROR_COUNT" == "0" ] || [ "$ERROR_COUNT" == "0.0" ]; then
            log_success "No errors in last 15 minutes"
        else
            log_warning "Lambda errors in last 15 min: $ERROR_COUNT"
            WARNINGS=$((WARNINGS+1))
        fi
    else
        log_error "AI Lambda state: $LAMBDA_STATE"
        ERRORS=$((ERRORS+1))
    fi
else
    log_error "AI_LAMBDA not found in deployment outputs"
    ERRORS=$((ERRORS+1))
fi

# Test 3: DynamoDB Tables
log "=========================================="
log "TEST 3: DynamoDB Tables Health"
log "=========================================="

# Check Metrics Table
if [ -n "$METRICS_TABLE" ]; then
    TABLE_STATUS=$(aws dynamodb describe-table \
        --table-name "$METRICS_TABLE" \
        --query 'Table.TableStatus' \
        --output text 2>/dev/null || echo "NotFound")

    if [ "$TABLE_STATUS" == "ACTIVE" ]; then
        log_success "Metrics table is ACTIVE: $METRICS_TABLE"

        # Check item count
        ITEM_COUNT=$(aws dynamodb scan \
            --table-name "$METRICS_TABLE" \
            --select COUNT \
            --query 'Count' \
            --output text 2>/dev/null || echo "0")

        log "Metrics table item count: $ITEM_COUNT"
    else
        log_error "Metrics table status: $TABLE_STATUS"
        ERRORS=$((ERRORS+1))
    fi
else
    log_error "METRICS_TABLE not found in deployment outputs"
    ERRORS=$((ERRORS+1))
fi

# Check Insights Table
if [ -n "$INSIGHTS_TABLE" ]; then
    TABLE_STATUS=$(aws dynamodb describe-table \
        --table-name "$INSIGHTS_TABLE" \
        --query 'Table.TableStatus' \
        --output text 2>/dev/null || echo "NotFound")

    if [ "$TABLE_STATUS" == "ACTIVE" ]; then
        log_success "Insights table is ACTIVE: $INSIGHTS_TABLE"

        ITEM_COUNT=$(aws dynamodb scan \
            --table-name "$INSIGHTS_TABLE" \
            --select COUNT \
            --query 'Count' \
            --output text 2>/dev/null || echo "0")

        log "Insights table item count: $ITEM_COUNT"
    else
        log_error "Insights table status: $TABLE_STATUS"
        ERRORS=$((ERRORS+1))
    fi
else
    log_error "INSIGHTS_TABLE not found in deployment outputs"
    ERRORS=$((ERRORS+1))
fi

# Test 4: Test API with Sample Metric
log "=========================================="
log "TEST 4: API Functionality Test"
log "=========================================="

if [ -n "$API_URL" ]; then
    # Create test metric
    TEST_PAYLOAD='{
        "timestamp": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'",
        "hostname": "validation-test-host",
        "cpuUsage": 45.5,
        "memoryUsage": 62.3,
        "diskIO": 120.5,
        "networkIO": 89.2
    }'

    log "Sending test metric to API..."
    RESPONSE=$(curl -s -X POST "$METRICS_URL" \
        -H "Content-Type: application/json" \
        -d "$TEST_PAYLOAD" \
        -w "\n%{http_code}" 2>/dev/null || echo -e "\n000")

    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    BODY=$(echo "$RESPONSE" | head -n -1)

    if [ "$HTTP_CODE" == "200" ] || [ "$HTTP_CODE" == "201" ]; then
        log_success "API accepted test metric (HTTP $HTTP_CODE)"
        log "Response: $BODY"
    else
        log_error "API rejected test metric (HTTP $HTTP_CODE)"
        log_error "Response: $BODY"
        ERRORS=$((ERRORS+1))
    fi

    # Wait for processing
    log "Waiting 10 seconds for async processing..."
    sleep 10

    # Verify metric was stored
    if [ -n "$METRICS_TABLE" ]; then
        log "Checking if metric was stored in DynamoDB..."

        RECENT_ITEMS=$(aws dynamodb scan \
            --table-name "$METRICS_TABLE" \
            --filter-expression "hostname = :host" \
            --expression-attribute-values '{":host":{"S":"validation-test-host"}}' \
            --query 'Count' \
            --output text 2>/dev/null || echo "0")

        if [ "$RECENT_ITEMS" -gt 0 ]; then
            log_success "Test metric found in DynamoDB"
        else
            log_warning "Test metric not found in DynamoDB (may still be processing)"
            WARNINGS=$((WARNINGS+1))
        fi
    fi
else
    log_warning "Skipping API test - no API URL"
    WARNINGS=$((WARNINGS+1))
fi

# Test 5: EventBridge Rules
log "=========================================="
log "TEST 5: EventBridge Rules"
log "=========================================="

RULES=$(aws events list-rules \
    --query 'Rules[?contains(Name, `IOps`) || contains(Name, `IOpsInfrastructureStack`)].Name' \
    --output text 2>/dev/null || echo "")

if [ -n "$RULES" ]; then
    RULE_COUNT=$(echo "$RULES" | wc -w | xargs)
    log_success "EventBridge rules found: $RULE_COUNT"

    for RULE in $RULES; do
        STATE=$(aws events describe-rule --name "$RULE" --query 'State' --output text)
        if [ "$STATE" == "ENABLED" ]; then
            log_success "  - $RULE: ENABLED"
        else
            log_warning "  - $RULE: $STATE"
            WARNINGS=$((WARNINGS+1))
        fi
    done
else
    log_warning "No EventBridge rules found"
    WARNINGS=$((WARNINGS+1))
fi

# Test 6: SNS Topics and Subscriptions
log "=========================================="
log "TEST 6: SNS Topics and Subscriptions"
log "=========================================="

TOPICS=$(aws sns list-topics \
    --query 'Topics[?contains(TopicArn, `IOps`)].TopicArn' \
    --output text 2>/dev/null || echo "")

if [ -n "$TOPICS" ]; then
    TOPIC_COUNT=$(echo "$TOPICS" | wc -w | xargs)
    log_success "SNS topics found: $TOPIC_COUNT"

    for TOPIC in $TOPICS; do
        TOPIC_NAME=$(echo "$TOPIC" | awk -F: '{print $NF}')
        log "  Topic: $TOPIC_NAME"

        # Check subscriptions
        SUBSCRIPTIONS=$(aws sns list-subscriptions-by-topic \
            --topic-arn "$TOPIC" \
            --query 'Subscriptions[].{Protocol:Protocol,Endpoint:Endpoint,Status:SubscriptionArn}' \
            --output json 2>/dev/null || echo "[]")

        SUB_COUNT=$(echo "$SUBSCRIPTIONS" | jq length)

        if [ "$SUB_COUNT" -gt 0 ]; then
            log_success "    Subscriptions: $SUB_COUNT"

            # Check if any are pending confirmation
            PENDING=$(echo "$SUBSCRIPTIONS" | jq '[.[] | select(.Status == "PendingConfirmation")] | length')
            if [ "$PENDING" -gt 0 ]; then
                log_warning "    $PENDING subscription(s) pending confirmation"
                WARNINGS=$((WARNINGS+1))
            fi
        else
            log_warning "    No subscriptions configured"
            WARNINGS=$((WARNINGS+1))
        fi
    done
else
    log_warning "No SNS topics found"
    WARNINGS=$((WARNINGS+1))
fi

# Test 7: CloudWatch Logs
log "=========================================="
log "TEST 7: CloudWatch Logs"
log "=========================================="

if [ -n "$AI_LAMBDA" ]; then
    LAMBDA_NAME=$(echo "$AI_LAMBDA" | awk -F: '{print $NF}')
    LOG_GROUP="/aws/lambda/$LAMBDA_NAME"

    # Check if log group exists
    LOG_EXISTS=$(aws logs describe-log-groups \
        --log-group-name-prefix "$LOG_GROUP" \
        --query 'logGroups[0].logGroupName' \
        --output text 2>/dev/null || echo "")

    if [ "$LOG_EXISTS" == "$LOG_GROUP" ]; then
        log_success "Lambda log group exists: $LOG_GROUP"

        # Check for recent errors
        RECENT_LOGS=$(aws logs filter-log-events \
            --log-group-name "$LOG_GROUP" \
            --start-time $(($(date +%s) * 1000 - 900000)) \
            --filter-pattern "ERROR" \
            --query 'events[].message' \
            --output text 2>/dev/null || echo "")

        if [ -z "$RECENT_LOGS" ]; then
            log_success "No ERROR logs in last 15 minutes"
        else
            ERROR_LINE_COUNT=$(echo "$RECENT_LOGS" | wc -l | xargs)
            log_warning "Found $ERROR_LINE_COUNT ERROR log entries"
            WARNINGS=$((WARNINGS+1))
        fi
    else
        log_warning "Lambda log group not found (may not have executed yet)"
        WARNINGS=$((WARNINGS+1))
    fi
fi

# Summary
log "=========================================="
log "VALIDATION SUMMARY"
log "=========================================="

if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    log_success "All validation tests passed! ✓"
    log "Deployment is healthy and ready for use"
    exit 0
elif [ $ERRORS -eq 0 ]; then
    log_warning "Validation completed with $WARNINGS warning(s)"
    log "Deployment is functional but may need attention"
    exit 0
else
    log_error "Validation failed with $ERRORS error(s) and $WARNINGS warning(s)"
    log "Please review the errors above and check CloudFormation stack"
    exit 1
fi
