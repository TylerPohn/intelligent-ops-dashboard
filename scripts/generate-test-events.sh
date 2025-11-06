#!/bin/bash
#
# IOPS Dashboard - High Volume Test Event Generator
#
# Generates realistic test insights to simulate 50+ concurrent InfiniBand data streams
# This showcases the system's ability to handle high-volume, real-time monitoring
#

set -e

REGION="us-east-2"
TABLE_NAME="iops-dashboard-metrics"
NUM_STREAMS="${1:-60}"  # Default to 60 concurrent streams
EVENTS_PER_STREAM="${2:-10}"  # Default to 10 events per stream
TOTAL_EVENTS=$((NUM_STREAMS * EVENTS_PER_STREAM))

echo "🚀 IOPS Dashboard - High Volume Test Event Generator"
echo "=================================================="
echo "Target: $NUM_STREAMS concurrent data streams"
echo "Events per stream: $EVENTS_PER_STREAM"
echo "Total events: $TOTAL_EVENTS"
echo "Region: $REGION"
echo "Table: $TABLE_NAME"
echo ""

# Prediction types with realistic InfiniBand scenarios
PREDICTION_TYPES=(
    "performance_degradation"
    "anomaly_detected"
    "resource_saturation"
    "connection_instability"
    "packet_loss_detected"
    "latency_spike"
    "bandwidth_throttling"
    "qp_error_rate_high"
    "memory_registration_failure"
    "rdma_timeout"
)

# Generate realistic explanations
get_explanation() {
    local pred_type=$1
    local stream_id=$2

    case $pred_type in
        "performance_degradation")
            echo "Stream $stream_id: InfiniBand call latency increased by $((RANDOM % 50 + 20))% over last $((RANDOM % 10 + 1)) minutes. Network congestion detected."
            ;;
        "anomaly_detected")
            echo "Stream $stream_id: Unusual RDMA operation pattern. Failed/successful ratio increased by $((RANDOM % 100 + 50))%."
            ;;
        "resource_saturation")
            echo "Stream $stream_id: HCA port utilization at $((RANDOM % 20 + 80))%. Performance degradation imminent."
            ;;
        "connection_instability")
            echo "Stream $stream_id: $((RANDOM % 20 + 5)) connection resets detected in past $((RANDOM % 10 + 1)) minutes."
            ;;
        "packet_loss_detected")
            echo "Stream $stream_id: Packet loss rate at $((RANDOM % 5 + 1)).${RANDOM:0:2}%. Link quality degraded."
            ;;
        "latency_spike")
            echo "Stream $stream_id: P99 latency increased from $((RANDOM % 50 + 10))μs to $((RANDOM % 500 + 100))μs."
            ;;
        "bandwidth_throttling")
            echo "Stream $stream_id: Throughput reduced by $((RANDOM % 40 + 10))%. QoS limits may be active."
            ;;
        "qp_error_rate_high")
            echo "Stream $stream_id: Queue Pair error rate at $((RANDOM % 10 + 1))%. Check QP state transitions."
            ;;
        "memory_registration_failure")
            echo "Stream $stream_id: $((RANDOM % 50 + 10)) memory registration failures in past minute."
            ;;
        "rdma_timeout")
            echo "Stream $stream_id: RDMA operations timing out. $((RANDOM % 30 + 5)) timeouts detected."
            ;;
        *)
            echo "Stream $stream_id: General performance issue detected."
            ;;
    esac
}

# Generate recommendations based on prediction type
get_recommendations() {
    local pred_type=$1

    case $pred_type in
        "performance_degradation")
            echo '["Check switch port utilization","Review network topology changes","Inspect physical connections","Analyze traffic patterns"]'
            ;;
        "anomaly_detected")
            echo '["Review application error logs","Check memory registration settings","Validate QP state transitions","Analyze operation patterns"]'
            ;;
        "resource_saturation")
            echo '["Investigate high-traffic applications","Enable load balancing","Activate adaptive routing","Review QoS configuration","Consider port upgrade"]'
            ;;
        "connection_instability")
            echo '["Check cable integrity","Review switch firmware","Inspect PHY layer errors","Validate link training"]'
            ;;
        "packet_loss_detected")
            echo '["Inspect physical layer","Check for EMI interference","Review buffer credits","Validate flow control"]'
            ;;
        "latency_spike")
            echo '["Identify latency sources","Review switch hop count","Check CPU affinity","Analyze interrupt handling"]'
            ;;
        "bandwidth_throttling")
            echo '["Review QoS policies","Check rate limiters","Validate VL arbitration","Inspect credit management"]'
            ;;
        "qp_error_rate_high")
            echo '["Review QP configuration","Check protection domains","Validate memory regions","Inspect completion queues"]'
            ;;
        "memory_registration_failure")
            echo '["Check available memory","Review registration cache","Validate huge pages","Inspect memory limits"]'
            ;;
        "rdma_timeout")
            echo '["Increase timeout values","Check remote node status","Review network latency","Validate retry settings"]'
            ;;
        *)
            echo '["Investigate further","Check system logs","Contact support"]'
            ;;
    esac
}

# Calculate risk score based on prediction type
get_risk_score() {
    local pred_type=$1

    case $pred_type in
        "resource_saturation"|"rdma_timeout") echo $((RANDOM % 20 + 80)) ;;  # 80-100
        "performance_degradation"|"connection_instability") echo $((RANDOM % 20 + 70)) ;;  # 70-90
        "latency_spike"|"qp_error_rate_high") echo $((RANDOM % 20 + 60)) ;;  # 60-80
        "packet_loss_detected"|"bandwidth_throttling") echo $((RANDOM % 20 + 50)) ;;  # 50-70
        *) echo $((RANDOM % 30 + 40)) ;;  # 40-70
    esac
}

# Generate timestamp with realistic spread
get_timestamp() {
    local offset=$1
    python3 -c "from datetime import datetime, timedelta; print((datetime.utcnow() - timedelta(seconds=$offset)).strftime('%Y-%m-%dT%H:%M:%SZ'))"
}

# Create temporary file for batch writes
BATCH_FILE="/tmp/insights-batch-$$.json"

echo "📝 Generating $TOTAL_EVENTS test insights..."
echo ""

# Progress tracking
GENERATED=0
START_TIME=$(date +%s)

# Generate events in batches (DynamoDB BatchWriteItem supports 25 items)
BATCH_SIZE=25
BATCHES=$(( (TOTAL_EVENTS + BATCH_SIZE - 1) / BATCH_SIZE ))

for ((batch=0; batch<BATCHES; batch++)); do
    BATCH_START=$((batch * BATCH_SIZE))
    BATCH_END=$((BATCH_START + BATCH_SIZE))
    if [ $BATCH_END -gt $TOTAL_EVENTS ]; then
        BATCH_END=$TOTAL_EVENTS
    fi

    # Start batch JSON
    echo "{\"$TABLE_NAME\": [" > "$BATCH_FILE"

    for ((i=BATCH_START; i<BATCH_END; i++)); do
        STREAM_ID=$((i % NUM_STREAMS + 1))
        EVENT_NUM=$((i / NUM_STREAMS + 1))

        # Pick random prediction type
        PRED_TYPE=${PREDICTION_TYPES[$((RANDOM % ${#PREDICTION_TYPES[@]}))]}

        # Generate event data
        ALERT_ID="alert_stream_${STREAM_ID}_event_${EVENT_NUM}_${RANDOM}"
        ENTITY_ID="ib_stream_${STREAM_ID}"
        TIMESTAMP=$(get_timestamp $((RANDOM % 300)))  # Spread over last 5 minutes
        RISK_SCORE=$(get_risk_score "$PRED_TYPE")
        EXPLANATION=$(get_explanation "$PRED_TYPE" "$STREAM_ID")
        RECOMMENDATIONS=$(get_recommendations "$PRED_TYPE")
        CONFIDENCE="0.$((RANDOM % 30 + 70))"  # 0.70 - 0.99

        # Build DynamoDB item
        ITEM="{\"PutRequest\":{\"Item\":{"
        ITEM+="\"entity_id\":{\"S\":\"$ALERT_ID\"},"
        ITEM+="\"entity_type\":{\"S\":\"insight\"},"
        ITEM+="\"related_entity\":{\"S\":\"$ENTITY_ID\"},"
        ITEM+="\"timestamp\":{\"S\":\"$TIMESTAMP\"},"
        ITEM+="\"prediction_type\":{\"S\":\"$PRED_TYPE\"},"
        ITEM+="\"risk_score\":{\"N\":\"$RISK_SCORE\"},"
        ITEM+="\"explanation\":{\"S\":\"$EXPLANATION\"},"
        ITEM+="\"recommendations\":{\"L\":["

        # Parse recommendations JSON array
        RECS=$(echo "$RECOMMENDATIONS" | sed 's/\[//g' | sed 's/\]//g' | sed 's/"//g')
        IFS=',' read -ra REC_ARRAY <<< "$RECS"
        FIRST=true
        for rec in "${REC_ARRAY[@]}"; do
            if [ "$FIRST" = false ]; then
                ITEM+=","
            fi
            ITEM+="{\"S\":\"$(echo $rec | xargs)\"}"
            FIRST=false
        done

        ITEM+="]},"
        ITEM+="\"model_used\":{\"S\":\"claude-3-5-haiku\"},"
        ITEM+="\"confidence\":{\"N\":\"$CONFIDENCE\"}"
        ITEM+="}}}"

        # Add comma between items (except last)
        if [ $i -lt $((BATCH_END - 1)) ]; then
            echo "$ITEM," >> "$BATCH_FILE"
        else
            echo "$ITEM" >> "$BATCH_FILE"
        fi

        GENERATED=$((GENERATED + 1))
    done

    # Close batch JSON
    echo "]}" >> "$BATCH_FILE"

    # Write batch to DynamoDB
    aws dynamodb batch-write-item \
        --request-items file://"$BATCH_FILE" \
        --region "$REGION" \
        --output json > /dev/null 2>&1

    # Progress indicator
    PERCENT=$((GENERATED * 100 / TOTAL_EVENTS))
    printf "\r⏳ Progress: %d/%d events (%d%%)..." "$GENERATED" "$TOTAL_EVENTS" "$PERCENT"

    # Small delay to avoid throttling
    sleep 0.1
done

echo ""
echo ""

# Calculate statistics
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
RATE=$((TOTAL_EVENTS / DURATION))

echo "✅ Generation Complete!"
echo "======================"
echo "✓ Generated: $TOTAL_EVENTS insights"
echo "✓ Streams: $NUM_STREAMS concurrent"
echo "✓ Duration: ${DURATION}s"
echo "✓ Rate: ${RATE} events/sec"
echo ""

# Query and display sample
echo "📊 Sample Insights (latest 5):"
echo "=============================="
aws dynamodb query \
    --table-name "$TABLE_NAME" \
    --index-name EntityTypeIndex \
    --key-condition-expression "entity_type = :type" \
    --expression-attribute-values '{":type":{"S":"insight"}}' \
    --scan-index-forward false \
    --limit 5 \
    --region "$REGION" \
    --query 'Items[*].[entity_id.S, prediction_type.S, risk_score.N, related_entity.S]' \
    --output table

echo ""
echo "🎯 Dashboard Polling:"
echo "===================="
echo "Your dashboard will automatically pick up these insights"
echo "within 5 seconds via HTTP polling."
echo ""
echo "🔗 API Endpoint:"
echo "https://dp41u4qn19.execute-api.us-east-2.amazonaws.com/prod/insights/recent?limit=100"
echo ""
echo "🌐 Dashboard URL:"
echo "http://localhost:3002"
echo ""

# Cleanup
rm -f "$BATCH_FILE"

# Summary by stream
echo "📈 Stream Distribution:"
echo "======================"
echo "Each of the $NUM_STREAMS streams has $EVENTS_PER_STREAM events"
echo ""
echo "To generate different volumes:"
echo "  ./generate-test-events.sh 100 20  # 100 streams, 20 events each = 2000 total"
echo "  ./generate-test-events.sh 50 5    # 50 streams, 5 events each = 250 total"
echo ""
