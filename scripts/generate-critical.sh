#!/bin/bash
#
# Critical Alert Generator (5 high-risk insights)
# Generates metrics guaranteed to trigger HIGH risk alerts (80+ risk score)
# Should trigger SNS email notifications
#

set -e

REGION="us-east-2"
LAMBDA_FUNCTION="IOpsDashboard-CoreStack-AIFunction3DD9AA07-StcOCQ4OUfo4"
NUM_INSIGHTS=5

echo "Generating $NUM_INSIGHTS CRITICAL ML insights (risk >= 80)..."
echo "Lambda: $LAMBDA_FUNCTION"
echo "Region: $REGION"
echo "These should trigger SNS email alerts!"
echo ""

for ((i=1; i<=NUM_INSIGHTS; i++)); do
  # Generate CRITICAL metrics (high IOPS, high latency, high errors)
  IOPS=$((150000 + RANDOM % 50000))  # Very high IOPS (150k-200k)
  LATENCY=$(awk 'BEGIN{srand(); printf "%.2f", 80 + rand() * 40}')  # Critical latency (80-120ms)
  ERROR_RATE=$(awk 'BEGIN{srand(); printf "%.2f", 15 + rand() * 10}')  # High error rate (15-25%)
  THROUGHPUT=$((300 + RANDOM % 200))  # Low throughput (300-500)
  QUEUE_DEPTH=$((90 + RANDOM % 10))  # Queue saturation (90-100)
  CONNECTIONS=$((500 + RANDOM % 100))  # High connection count (500-600)

  # Invoke Lambda
  aws lambda invoke \
    --function-name "$LAMBDA_FUNCTION" \
    --region "$REGION" \
    --cli-binary-format raw-in-base64-out \
    --payload "{\"metrics\":[{\"nodeId\":\"critical_node_$i\",\"timestamp\":\"$(date -u +"%Y-%m-%dT%H:%M:%SZ")\",\"iops\":$IOPS,\"latency\":$LATENCY,\"errorRate\":$ERROR_RATE,\"throughput\":$THROUGHPUT,\"queueDepth\":$QUEUE_DEPTH,\"activeConnections\":$CONNECTIONS}]}" \
    /dev/null > /dev/null 2>&1

  printf "\r[$i/$NUM_INSIGHTS] Generated CRITICAL alert"
  sleep 1
done

echo ""
echo "✓ Done! Lambda processed all CRITICAL insights"
echo ""
echo "⚠️  CHECK YOUR EMAIL (tylerpohn@gmail.com) for SNS notifications!"
echo "    Alerts should arrive within 1-2 minutes if SNS is configured correctly."
