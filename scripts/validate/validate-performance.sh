#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${BLUE}[PERF]${NC} $1"; }
log_success() { echo -e "${GREEN}[PERF] ✓${NC} $1"; }
log_error() { echo -e "${RED}[PERF] ✗${NC} $1"; }
log_warning() { echo -e "${YELLOW}[PERF] ⚠${NC} $1"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

log "Starting performance validation..."

# Load deployment outputs
if [ ! -f "$PROJECT_ROOT/.deployment-outputs" ]; then
    log_error "Deployment outputs not found"
    exit 1
fi

source "$PROJECT_ROOT/.deployment-outputs"

if [ -z "$API_URL" ]; then
    log_error "API_URL not found in deployment outputs"
    exit 1
fi

# Prepare metrics endpoint
if [[ "$API_URL" == */ ]]; then
    METRICS_URL="${API_URL}metrics"
else
    METRICS_URL="${API_URL}/metrics"
fi

log "Testing endpoint: $METRICS_URL"

# Test 1: Single Request Latency
log "=========================================="
log "TEST 1: Baseline Latency"
log "=========================================="

TEST_PAYLOAD='{
    "timestamp": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'",
    "hostname": "perf-test-'$(date +%s)'",
    "cpuUsage": 55.5,
    "memoryUsage": 72.3,
    "diskIO": 150.5,
    "networkIO": 99.2
}'

log "Sending single test request..."
START_TIME=$(date +%s%N)

RESPONSE=$(curl -s -X POST "$METRICS_URL" \
    -H "Content-Type: application/json" \
    -d "$TEST_PAYLOAD" \
    -w "\n%{http_code}\n%{time_total}" 2>/dev/null || echo -e "\n000\n0")

END_TIME=$(date +%s%N)

HTTP_CODE=$(echo "$RESPONSE" | tail -2 | head -1)
CURL_TIME=$(echo "$RESPONSE" | tail -1)
TOTAL_TIME=$(echo "scale=3; ($END_TIME - $START_TIME) / 1000000000" | bc)

if [ "$HTTP_CODE" == "200" ] || [ "$HTTP_CODE" == "201" ]; then
    log_success "Request successful (HTTP $HTTP_CODE)"
    log "  Response time: ${CURL_TIME}s"
    log "  Total time: ${TOTAL_TIME}s"
else
    log_error "Request failed (HTTP $HTTP_CODE)"
    exit 1
fi

# Test 2: Concurrent Load Test
log "=========================================="
log "TEST 2: Concurrent Load Test (200 requests)"
log "=========================================="

log "Generating test data..."
TEST_DIR="/tmp/iops-perf-test-$$"
mkdir -p "$TEST_DIR"

# Generate 200 test payloads
for i in $(seq 1 200); do
    cat > "$TEST_DIR/payload-$i.json" << EOF
{
    "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
    "hostname": "perf-test-host-$i",
    "cpuUsage": $((RANDOM % 100)),
    "memoryUsage": $((RANDOM % 100)),
    "diskIO": $((RANDOM % 200)),
    "networkIO": $((RANDOM % 200))
}
EOF
done

log_success "Generated 200 test payloads"

# Run concurrent requests
log "Sending 200 concurrent requests..."
START_TIME=$(date +%s)

# Use GNU parallel if available, otherwise use xargs
if command -v parallel &> /dev/null; then
    ls "$TEST_DIR"/payload-*.json | parallel -j 20 --bar \
        "curl -s -X POST '$METRICS_URL' -H 'Content-Type: application/json' -d @{} -w '%{http_code},%{time_total}\n' -o /dev/null" \
        > "$TEST_DIR/results.csv" 2>/dev/null
else
    # Fallback to xargs with background processes
    for payload in "$TEST_DIR"/payload-*.json; do
        (curl -s -X POST "$METRICS_URL" \
            -H "Content-Type: application/json" \
            -d @"$payload" \
            -w "%{http_code},%{time_total}\n" \
            -o /dev/null >> "$TEST_DIR/results.csv") &

        # Limit concurrent connections to 20
        while [ $(jobs -r | wc -l) -ge 20 ]; do
            sleep 0.1
        done
    done

    # Wait for all background jobs
    wait
fi

END_TIME=$(date +%s)
TOTAL_DURATION=$((END_TIME - START_TIME))

log_success "Load test completed in ${TOTAL_DURATION}s"

# Analyze results
SUCCESS_COUNT=$(grep -c "^200" "$TEST_DIR/results.csv" 2>/dev/null || echo "0")
TOTAL_COUNT=$(wc -l < "$TEST_DIR/results.csv" 2>/dev/null || echo "0")

log ""
log "Results:"
log "  Total requests: $TOTAL_COUNT"
log "  Successful (200): $SUCCESS_COUNT"
log "  Failed: $((TOTAL_COUNT - SUCCESS_COUNT))"
log "  Success rate: $(echo "scale=2; $SUCCESS_COUNT * 100 / $TOTAL_COUNT" | bc)%"

# Calculate percentiles
if [ "$SUCCESS_COUNT" -gt 0 ]; then
    # Extract response times for successful requests
    grep "^200" "$TEST_DIR/results.csv" | cut -d, -f2 | sort -n > "$TEST_DIR/times.txt"

    P50_INDEX=$(echo "scale=0; $SUCCESS_COUNT * 0.5 / 1" | bc)
    P95_INDEX=$(echo "scale=0; $SUCCESS_COUNT * 0.95 / 1" | bc)
    P99_INDEX=$(echo "scale=0; $SUCCESS_COUNT * 0.99 / 1" | bc)

    P50=$(sed -n "${P50_INDEX}p" "$TEST_DIR/times.txt")
    P95=$(sed -n "${P95_INDEX}p" "$TEST_DIR/times.txt")
    P99=$(sed -n "${P99_INDEX}p" "$TEST_DIR/times.txt")

    log ""
    log "Latency Percentiles:"
    log "  p50: ${P50}s"
    log "  p95: ${P95}s"
    log "  p99: ${P99}s"

    # Check if latencies are acceptable
    P99_MS=$(echo "$P99 * 1000" | bc | cut -d. -f1)
    if [ "$P99_MS" -lt 1000 ]; then
        log_success "p99 latency under 1 second"
    else
        log_warning "p99 latency over 1 second: ${P99}s"
    fi
fi

# Cleanup
rm -rf "$TEST_DIR"

# Test 3: DynamoDB Capacity Analysis
log "=========================================="
log "TEST 3: DynamoDB Capacity Utilization"
log "=========================================="

if [ -n "$METRICS_TABLE" ]; then
    log "Checking DynamoDB metrics for: $METRICS_TABLE"

    # Get consumed capacity
    TABLE_METRICS=$(aws dynamodb describe-table \
        --table-name "$METRICS_TABLE" \
        --query 'Table.{BillingMode:BillingModeSummary.BillingMode,Status:TableStatus}' \
        --output json)

    BILLING_MODE=$(echo "$TABLE_METRICS" | jq -r '.BillingMode')
    log "Billing mode: $BILLING_MODE"

    if [ "$BILLING_MODE" == "PAY_PER_REQUEST" ]; then
        log_success "Using on-demand pricing - no capacity limits"

        # Get request metrics from CloudWatch
        READ_UNITS=$(aws cloudwatch get-metric-statistics \
            --namespace AWS/DynamoDB \
            --metric-name ConsumedReadCapacityUnits \
            --dimensions Name=TableName,Value="$METRICS_TABLE" \
            --start-time "$(date -u -v-15M +"%Y-%m-%dT%H:%M:%S")" \
            --end-time "$(date -u +"%Y-%m-%dT%H:%M:%S")" \
            --period 900 \
            --statistics Sum \
            --query 'Datapoints[0].Sum' \
            --output text 2>/dev/null || echo "0")

        WRITE_UNITS=$(aws cloudwatch get-metric-statistics \
            --namespace AWS/DynamoDB \
            --metric-name ConsumedWriteCapacityUnits \
            --dimensions Name=TableName,Value="$METRICS_TABLE" \
            --start-time "$(date -u -v-15M +"%Y-%m-%dT%H:%M:%S")" \
            --end-time "$(date -u +"%Y-%m-%dT%H:%M:%S")" \
            --period 900 \
            --statistics Sum \
            --query 'Datapoints[0].Sum' \
            --output text 2>/dev/null || echo "0")

        log "Consumed capacity (last 15 min):"
        log "  Read units: ${READ_UNITS:-0}"
        log "  Write units: ${WRITE_UNITS:-0}"

        # Check throttling
        THROTTLED=$(aws cloudwatch get-metric-statistics \
            --namespace AWS/DynamoDB \
            --metric-name UserErrors \
            --dimensions Name=TableName,Value="$METRICS_TABLE" \
            --start-time "$(date -u -v-15M +"%Y-%m-%dT%H:%M:%S")" \
            --end-time "$(date -u +"%Y-%m-%dT%H:%M:%S")" \
            --period 900 \
            --statistics Sum \
            --query 'Datapoints[0].Sum' \
            --output text 2>/dev/null || echo "0")

        if [ "${THROTTLED:-0}" == "0" ] || [ "${THROTTLED:-0}" == "0.0" ]; then
            log_success "No throttling detected"
        else
            log_warning "Throttled requests: $THROTTLED"
        fi
    else
        # Provisioned capacity
        PROVISIONED=$(aws dynamodb describe-table \
            --table-name "$METRICS_TABLE" \
            --query 'Table.ProvisionedThroughput.{Read:ReadCapacityUnits,Write:WriteCapacityUnits}' \
            --output json)

        READ_CAP=$(echo "$PROVISIONED" | jq -r '.Read')
        WRITE_CAP=$(echo "$PROVISIONED" | jq -r '.Write')

        log "Provisioned capacity:"
        log "  Read: $READ_CAP units"
        log "  Write: $WRITE_CAP units"

        # Calculate utilization
        READ_UNITS=$(aws cloudwatch get-metric-statistics \
            --namespace AWS/DynamoDB \
            --metric-name ConsumedReadCapacityUnits \
            --dimensions Name=TableName,Value="$METRICS_TABLE" \
            --start-time "$(date -u -v-5M +"%Y-%m-%dT%H:%M:%S")" \
            --end-time "$(date -u +"%Y-%m-%dT%H:%M:%S")" \
            --period 300 \
            --statistics Average \
            --query 'Datapoints[0].Average' \
            --output text 2>/dev/null || echo "0")

        READ_UTIL=$(echo "scale=2; ($READ_UNITS / $READ_CAP) * 100" | bc 2>/dev/null || echo "0")

        log "Current utilization:"
        log "  Read: ${READ_UTIL}%"

        if [ $(echo "$READ_UTIL < 50" | bc -l) -eq 1 ]; then
            log_success "Capacity utilization healthy (<50%)"
        elif [ $(echo "$READ_UTIL < 80" | bc -l) -eq 1 ]; then
            log_warning "Capacity utilization moderate (${READ_UTIL}%)"
        else
            log_warning "Capacity utilization high (${READ_UTIL}%)"
        fi
    fi
fi

# Test 4: API Gateway Throttling
log "=========================================="
log "TEST 4: API Gateway Throttling"
log "=========================================="

# Extract API ID from URL
API_ID=$(echo "$API_URL" | grep -oE '[a-z0-9]{10}' | head -1)

if [ -n "$API_ID" ]; then
    log "API Gateway ID: $API_ID"

    # Get API Gateway metrics
    API_COUNT=$(aws cloudwatch get-metric-statistics \
        --namespace AWS/ApiGateway \
        --metric-name Count \
        --dimensions Name=ApiId,Value="$API_ID" \
        --start-time "$(date -u -v-15M +"%Y-%m-%dT%H:%M:%S")" \
        --end-time "$(date -u +"%Y-%m-%dT%H:%M:%S")" \
        --period 900 \
        --statistics Sum \
        --query 'Datapoints[0].Sum' \
        --output text 2>/dev/null || echo "0")

    API_4XX=$(aws cloudwatch get-metric-statistics \
        --namespace AWS/ApiGateway \
        --metric-name 4XXError \
        --dimensions Name=ApiId,Value="$API_ID" \
        --start-time "$(date -u -v-15M +"%Y-%m-%dT%H:%M:%S")" \
        --end-time "$(date -u +"%Y-%m-%dT%H:%M:%S")" \
        --period 900 \
        --statistics Sum \
        --query 'Datapoints[0].Sum' \
        --output text 2>/dev/null || echo "0")

    API_5XX=$(aws cloudwatch get-metric-statistics \
        --namespace AWS/ApiGateway \
        --metric-name 5XXError \
        --dimensions Name=ApiId,Value="$API_ID" \
        --start-time "$(date -u -v-15M +"%Y-%m-%dT%H:%M:%S")" \
        --end-time "$(date -u +"%Y-%m-%dT%H:%M:%S")" \
        --period 900 \
        --statistics Sum \
        --query 'Datapoints[0].Sum' \
        --output text 2>/dev/null || echo "0")

    log "API Gateway metrics (last 15 min):"
    log "  Total requests: ${API_COUNT:-0}"
    log "  4XX errors: ${API_4XX:-0}"
    log "  5XX errors: ${API_5XX:-0}"

    if [ "${API_5XX:-0}" == "0" ] || [ "${API_5XX:-0}" == "0.0" ]; then
        log_success "No 5XX errors detected"
    else
        log_warning "5XX errors detected: $API_5XX"
    fi

    # Calculate error rate
    if [ "${API_COUNT:-0}" != "0" ] && [ "${API_COUNT:-0}" != "0.0" ]; then
        ERROR_RATE=$(echo "scale=2; ((${API_4XX:-0} + ${API_5XX:-0}) / ${API_COUNT}) * 100" | bc)
        log "Error rate: ${ERROR_RATE}%"

        if [ $(echo "$ERROR_RATE < 1" | bc -l) -eq 1 ]; then
            log_success "Error rate healthy (<1%)"
        else
            log_warning "Error rate elevated: ${ERROR_RATE}%"
        fi
    fi
else
    log_warning "Could not extract API Gateway ID from URL"
fi

# Summary
log "=========================================="
log "PERFORMANCE SUMMARY"
log "=========================================="
log_success "Performance validation completed"
log ""
log "Key Findings:"
log "  - Load test: $SUCCESS_COUNT/$TOTAL_COUNT requests successful"
log "  - p99 latency: ${P99}s"
log "  - DynamoDB: ${BILLING_MODE:-Unknown} mode"
log "  - API errors: ${API_5XX:-0} (5XX)"
log ""

if [ "$SUCCESS_COUNT" -ge 190 ] && [ "$P99_MS" -lt 2000 ]; then
    log_success "✓ System performance meets requirements"
    exit 0
else
    log_warning "⚠ System performance may need optimization"
    log "  - Target: >95% success rate, p99 <2s"
    log "  - Actual: $(echo "scale=1; $SUCCESS_COUNT * 100 / $TOTAL_COUNT" | bc)% success, p99 ${P99}s"
    exit 0
fi
