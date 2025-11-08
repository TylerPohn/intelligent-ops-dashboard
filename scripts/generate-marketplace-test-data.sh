#!/bin/bash
#
# Marketplace Health Test Data Generator
# Generates realistic customer metrics for testing SageMaker ML predictions
#

set -e

REGION="us-east-2"
TABLE_NAME="iops-dashboard-metrics"
NUM_CUSTOMERS=${1:-10}

echo "🎓 Generating $NUM_CUSTOMERS marketplace customer records..."
echo "Table: $TABLE_NAME"
echo "Region: $REGION"
echo ""

for ((i=1; i<=NUM_CUSTOMERS; i++)); do
  # Generate customer ID
  CUSTOMER_ID="stu_$(printf "%04d" $((1000 + RANDOM % 9000)))"

  # Randomize customer segment (thriving, healthy, at_risk, churned)
  SEGMENT_RAND=$((RANDOM % 100))
  if [ $SEGMENT_RAND -lt 30 ]; then
    SEGMENT="thriving"
    SESSIONS_7D=$((2 + RANDOM % 5))
    AVG_RATING=$(awk 'BEGIN{srand(); printf "%.2f", 4.0 + rand() * 1.0}')
    IB_CALLS=0
    PAYMENT_SUCCESS=$(awk 'BEGIN{srand(); printf "%.3f", 0.95 + rand() * 0.05}')
    TUTOR_CONSISTENCY=$(awk 'BEGIN{srand(); printf "%.3f", 0.85 + rand() * 0.15}')
  elif [ $SEGMENT_RAND -lt 70 ]; then
    SEGMENT="healthy"
    SESSIONS_7D=$((1 + RANDOM % 3))
    AVG_RATING=$(awk 'BEGIN{srand(); printf "%.2f", 3.8 + rand() * 0.7}')
    IB_CALLS=$((RANDOM % 2))
    PAYMENT_SUCCESS=$(awk 'BEGIN{srand(); printf "%.3f", 0.85 + rand() * 0.15}')
    TUTOR_CONSISTENCY=$(awk 'BEGIN{srand(); printf "%.3f", 0.65 + rand() * 0.25}')
  elif [ $SEGMENT_RAND -lt 90 ]; then
    SEGMENT="at_risk"
    SESSIONS_7D=$((RANDOM % 2))
    AVG_RATING=$(awk 'BEGIN{srand(); printf "%.2f", 3.0 + rand() * 1.0}')
    IB_CALLS=$((1 + RANDOM % 2))
    PAYMENT_SUCCESS=$(awk 'BEGIN{srand(); printf "%.3f", 0.70 + rand() * 0.20}')
    TUTOR_CONSISTENCY=$(awk 'BEGIN{srand(); printf "%.3f", 0.40 + rand() * 0.30}')
  else
    SEGMENT="churned"
    SESSIONS_7D=0
    AVG_RATING=$(awk 'BEGIN{srand(); printf "%.2f", 2.0 + rand() * 1.5}')
    IB_CALLS=$((2 + RANDOM % 3))
    PAYMENT_SUCCESS=$(awk 'BEGIN{srand(); printf "%.3f", 0.50 + rand() * 0.30}')
    TUTOR_CONSISTENCY=$(awk 'BEGIN{srand(); printf "%.3f", 0.20 + rand() * 0.30}')
  fi

  # Calculate derived metrics
  SESSIONS_14D=$((SESSIONS_7D * 2))
  SESSIONS_30D=$((SESSIONS_7D * 4))
  DAYS_SINCE_LAST=$((RANDOM % 30))
  CANCELLATION_RATE=$(awk 'BEGIN{srand(); printf "%.3f", rand() * 0.15}')

  # Write to DynamoDB
  aws dynamodb put-item \
    --table-name "$TABLE_NAME" \
    --region "$REGION" \
    --item "{
      \"entity_id\": {\"S\": \"$CUSTOMER_ID\"},
      \"entity_type\": {\"S\": \"student\"},
      \"timestamp\": {\"S\": \"$(date -u +"%Y-%m-%dT%H:%M:%SZ")\"},
      \"sessions_7d\": {\"N\": \"$SESSIONS_7D\"},
      \"sessions_14d\": {\"N\": \"$SESSIONS_14D\"},
      \"sessions_30d\": {\"N\": \"$SESSIONS_30D\"},
      \"avg_rating\": {\"N\": \"$AVG_RATING\"},
      \"ib_calls_7d\": {\"N\": \"0\"},
      \"ib_calls_14d\": {\"N\": \"$IB_CALLS\"},
      \"days_since_last_session\": {\"N\": \"$DAYS_SINCE_LAST\"},
      \"cancellation_rate_7d\": {\"N\": \"$CANCELLATION_RATE\"},
      \"cancellation_rate_30d\": {\"N\": \"$CANCELLATION_RATE\"},
      \"payment_success_rate_30d\": {\"N\": \"$PAYMENT_SUCCESS\"},
      \"tutor_consistency_score\": {\"N\": \"$TUTOR_CONSISTENCY\"},
      \"segment_expected\": {\"S\": \"$SEGMENT\"}
    }" > /dev/null

  printf "\r[$i/$NUM_CUSTOMERS] Created $CUSTOMER_ID ($SEGMENT)"
done

echo ""
echo "✅ Created $NUM_CUSTOMERS customer records in DynamoDB"
echo ""
echo "Next step: Invoke AI Lambda to generate predictions"
echo "  aws lambda invoke --function-name IOpsDashboard-CoreStack-AIFunction* --region $REGION --payload '{}' /tmp/result.json"
