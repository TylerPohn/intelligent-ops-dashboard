#!/bin/bash
#
# Quick ML Insights Generator (10 insights)
# Invokes Lambda for fast testing
#

set -e

REGION="us-east-2"
LAMBDA_FUNCTION="IOpsDashboard-CoreStack-AIFunction3DD9AA07-StcOCQ4OUfo4"
NUM_INSIGHTS=10

echo "Generating $NUM_INSIGHTS ML insights via Lambda..."
echo "Lambda: $LAMBDA_FUNCTION"
echo "Region: $REGION"
echo ""

for ((i=1; i<=NUM_INSIGHTS; i++)); do
  # Generate realistic metrics
  IOPS=$((60000 + RANDOM % 40000))
  LATENCY=$(awk 'BEGIN{srand(); printf "%.2f", 5 + rand() * 45}')
  ERROR_RATE=$(awk 'BEGIN{srand(); printf "%.2f", rand() * 10}')
  THROUGHPUT=$((800 + RANDOM % 800))
  QUEUE_DEPTH=$((20 + RANDOM % 60))
  CONNECTIONS=$((100 + RANDOM % 300))

  # Invoke Lambda
  aws lambda invoke \
    --function-name "$LAMBDA_FUNCTION" \
    --region "$REGION" \
    --cli-binary-format raw-in-base64-out \
    --payload "{\"metrics\":[{\"nodeId\":\"stream_$i\",\"timestamp\":\"$(date -u +"%Y-%m-%dT%H:%M:%SZ")\",\"iops\":$IOPS,\"latency\":$LATENCY,\"errorRate\":$ERROR_RATE,\"throughput\":$THROUGHPUT,\"queueDepth\":$QUEUE_DEPTH,\"activeConnections\":$CONNECTIONS}]}" \
    /dev/null > /dev/null 2>&1

  printf "\r[$i/$NUM_INSIGHTS] Generated"
  sleep 0.5
done

echo ""
echo "✓ Done! Lambda processed all insights and wrote to DynamoDB"
