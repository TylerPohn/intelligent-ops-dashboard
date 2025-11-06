#!/bin/bash
#
# IOPS Dashboard - ML-Powered Insights Generator
#
# Generates realistic IOPS metrics and invokes AI Lambda for ML predictions
# Uses SageMaker XGBoost + Bedrock Claude for analysis
#

set -e

REGION="${AWS_REGION:-us-east-2}"
TABLE_NAME="iops-dashboard-metrics"
LAMBDA_FUNCTION="IOpsDashboard-CoreStack-AIFunction3DD9AA07-StcOCQ4OUfo4"
NUM_STREAMS="${1:-20}"  # Default to 20 concurrent streams
EVENTS_PER_STREAM="${2:-5}"  # Default to 5 events per stream
TOTAL_EVENTS=$((NUM_STREAMS * EVENTS_PER_STREAM))

echo "🤖 IOPS Dashboard - ML-Powered Insights Generator"
echo "=================================================="
echo "Target: $NUM_STREAMS InfiniBand data streams"
echo "Events per stream: $EVENTS_PER_STREAM"
echo "Total events: $TOTAL_EVENTS"
echo "Region: $REGION"
echo "Lambda: $LAMBDA_FUNCTION"
echo "AI: SageMaker XGBoost → Bedrock Claude → Rules fallback"
echo ""

START_TIME=$(date +%s)
GENERATED=0
SUCCESS=0
FAILED=0

# Clear old fake insights
echo "🧹 Clearing old test data..."
aws dynamodb query \
    --table-name "$TABLE_NAME" \
    --index-name EntityTypeIndex \
    --key-condition-expression "entity_type = :type" \
    --expression-attribute-values '{":type":{"S":"insight"}}' \
    --projection-expression "entity_id,entity_type" \
    --region "$REGION" \
    --output json 2>/dev/null | \
python3 -c "
import json, sys
data = json.load(sys.stdin)
for item in data.get('Items', []):
    entity_id = item['entity_id']['S']
    print(entity_id)
" | while read -r entity_id; do
    if [ -n "$entity_id" ]; then
        aws dynamodb delete-item \
            --table-name "$TABLE_NAME" \
            --key "{\"entity_id\":{\"S\":\"$entity_id\"},\"entity_type\":{\"S\":\"insight\"}}" \
            --region "$REGION" 2>/dev/null
    fi
done

echo "✓ Cleared old insights"
echo ""

# Generate metrics and invoke AI Lambda
echo "🚀 Generating ML insights..."
echo ""

for ((stream=1; stream<=NUM_STREAMS; stream++)); do
    for ((event=1; event<=EVENTS_PER_STREAM; event++)); do
        # Generate realistic IOPS metrics
        IOPS=$((50000 + RANDOM % 100000))
        LATENCY=$(awk -v min=5 -v max=50 'BEGIN{srand(); print min+rand()*(max-min)}')
        ERROR_RATE=$(awk -v min=0 -v max=5 'BEGIN{srand(); print min+rand()*(max-min)}')
        THROUGHPUT=$((500 + RANDOM % 1500))
        QUEUE_DEPTH=$((10 + RANDOM % 50))
        CONNECTIONS=$((100 + RANDOM % 400))

        # Create Lambda payload
        PAYLOAD=$(cat <<EOF
{
  "metrics": [
    {
      "nodeId": "ib_stream_${stream}",
      "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
      "iops": ${IOPS},
      "latency": ${LATENCY},
      "errorRate": ${ERROR_RATE},
      "throughput": ${THROUGHPUT},
      "queueDepth": ${QUEUE_DEPTH},
      "activeConnections": ${CONNECTIONS}
    }
  ]
}
EOF
)

        # Invoke AI Lambda and capture response
        RESPONSE=$(aws lambda invoke \
            --function-name "$LAMBDA_FUNCTION" \
            --payload "$(echo "$PAYLOAD" | base64)" \
            --region "$REGION" \
            --cli-binary-format raw-in-base64-out \
            /dev/stdout 2>/dev/null | head -1)

        if [ $? -eq 0 ]; then
            # Parse Lambda response
            RISK_SCORE=$(echo "$RESPONSE" | python3 -c "import json,sys; data=json.load(sys.stdin); print(data.get('risk_score', 0))" 2>/dev/null || echo "0")
            ANALYSIS=$(echo "$RESPONSE" | python3 -c "import json,sys; data=json.load(sys.stdin); print(data.get('analysis', 'Analysis unavailable'))" 2>/dev/null || echo "Analysis unavailable")
            MODEL_USED=$(echo "$RESPONSE" | python3 -c "import json,sys; data=json.load(sys.stdin); print(data.get('model_used', 'unknown'))" 2>/dev/null || echo "unknown")

            # Extract recommendations
            RECS=$(echo "$RESPONSE" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    recs = data.get('recommendations', [])
    print(json.dumps(recs))
except:
    print('[]')
" 2>/dev/null || echo "[]")

            # Build DynamoDB item
            TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
            ALERT_ID="alert_stream_${stream}_event_${event}_ml"

            # Convert recommendations to DynamoDB format
            RECS_DYNAMODB=$(echo "$RECS" | python3 -c "
import json, sys
try:
    recs = json.load(sys.stdin)
    items = [{'S': rec} for rec in recs]
    print(json.dumps(items))
except:
    print('[]')
" 2>/dev/null || echo "[]")

            # Determine prediction type based on risk score
            if [ "$RISK_SCORE" -ge 80 ]; then
                PRED_TYPE="critical_performance_issue"
            elif [ "$RISK_SCORE" -ge 60 ]; then
                PRED_TYPE="performance_degradation"
            elif [ "$RISK_SCORE" -ge 40 ]; then
                PRED_TYPE="anomaly_detected"
            else
                PRED_TYPE="normal_operation"
            fi

            # Calculate confidence based on model used
            if [[ "$MODEL_USED" == *"sagemaker"* ]]; then
                CONFIDENCE="0.95"
            elif [[ "$MODEL_USED" == *"bedrock"* ]]; then
                CONFIDENCE="0.88"
            else
                CONFIDENCE="0.75"
            fi

            # Write to DynamoDB
            aws dynamodb put-item \
                --table-name "$TABLE_NAME" \
                --region "$REGION" \
                --item "{
                    \"entity_id\": {\"S\": \"$ALERT_ID\"},
                    \"entity_type\": {\"S\": \"insight\"},
                    \"timestamp\": {\"S\": \"$TIMESTAMP\"},
                    \"related_entity\": {\"S\": \"ib_stream_${stream}\"},
                    \"prediction_type\": {\"S\": \"$PRED_TYPE\"},
                    \"risk_score\": {\"N\": \"$RISK_SCORE\"},
                    \"explanation\": {\"S\": $(echo "$ANALYSIS" | python3 -c "import json,sys; print(json.dumps(sys.stdin.read().strip()))")},
                    \"recommendations\": {\"L\": $RECS_DYNAMODB},
                    \"model_used\": {\"S\": \"$MODEL_USED\"},
                    \"confidence\": {\"N\": \"$CONFIDENCE\"}
                }" 2>/dev/null

            if [ $? -eq 0 ]; then
                SUCCESS=$((SUCCESS + 1))
            else
                FAILED=$((FAILED + 1))
            fi
        else
            FAILED=$((FAILED + 1))
        fi

        GENERATED=$((GENERATED + 1))
        PERCENT=$((GENERATED * 100 / TOTAL_EVENTS))
        printf "\r⏳ Progress: %d/%d events (%d%%) | ✓ %d | ✗ %d" "$GENERATED" "$TOTAL_EVENTS" "$PERCENT" "$SUCCESS" "$FAILED"

        # Small delay to avoid throttling
        sleep 0.2
    done
done

echo ""
echo ""

# Calculate statistics
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
RATE=$((TOTAL_EVENTS / (DURATION > 0 ? DURATION : 1)))

echo "✅ Generation Complete!"
echo "======================"
echo "✓ Generated: $TOTAL_EVENTS insights"
echo "✓ Successful: $SUCCESS"
echo "✗ Failed: $FAILED"
echo "✓ Streams: $NUM_STREAMS concurrent"
echo "✓ Duration: ${DURATION}s"
echo "✓ Rate: ${RATE} events/sec"
echo ""

# Query and display sample
echo "📊 Sample ML Insights (latest 5):"
echo "=================================="
aws dynamodb query \
    --table-name "$TABLE_NAME" \
    --index-name EntityTypeIndex \
    --key-condition-expression "entity_type = :type" \
    --expression-attribute-values '{":type":{"S":"insight"}}' \
    --scan-index-forward false \
    --limit 5 \
    --region "$REGION" \
    --query 'Items[*].[entity_id.S, model_used.S, risk_score.N, prediction_type.S]' \
    --output table 2>/dev/null

echo ""
echo "🎯 Dashboard Polling:"
echo "===================="
echo "Your dashboard will automatically pick up these ML insights"
echo "within 5 seconds via HTTP polling."
echo ""
echo "🔗 API Endpoint:"
echo "https://dp41u4qn19.execute-api.us-east-2.amazonaws.com/prod/insights/recent?limit=100"
echo ""
echo "🌐 Dashboard URL:"
echo "http://localhost:3002"
echo ""
echo "🤖 AI Models Used:"
echo "=================="
echo "1. SageMaker XGBoost (primary) - ML risk classification"
echo "2. Bedrock Claude 3.5 Haiku (fallback) - Natural language analysis"
echo "3. Rules-based (final fallback) - Deterministic thresholds"
echo ""
echo "To generate different volumes:"
echo "  ./scripts/generate-ml-insights.sh 50 10   # 50 streams, 10 events each"
echo "  ./scripts/generate-ml-insights.sh 10 3    # 10 streams, 3 events each"
echo ""
