#!/bin/bash
#
# Tutor Marketplace Event Generator
# Generates realistic tutor marketplace events via API Gateway → Kinesis
#

set -e

REGION="us-east-2"
API_ENDPOINT="https://uwnig53hbd.execute-api.us-east-2.amazonaws.com/prod/ingest"
NUM_EVENTS=${1:-20}

# Event types based on PRD
EVENT_TYPES=(
  "session_started"
  "session_completed"
  "ib_call_logged"
  "tutor_availability_updated"
  "customer_health_update"
  "supply_demand_update"
)

# Sample subjects
SUBJECTS=(
  "algebra_1" "algebra_2" "geometry" "precalculus" "ap_calculus"
  "ap_physics" "ap_chemistry" "spanish" "french" "english"
)

# Subscription tiers
TIERS=("budget" "standard" "premium")

echo "Generating $NUM_EVENTS tutor marketplace events..."
echo "API Endpoint: $API_ENDPOINT"
echo "Region: $REGION"
echo ""

for ((i=1; i<=NUM_EVENTS; i++)); do
  # Random event type
  EVENT_TYPE=${EVENT_TYPES[$RANDOM % ${#EVENT_TYPES[@]}]}

  # Generate customer and tutor IDs
  CUSTOMER_ID="cust_$(printf "%06d" $((1000 + RANDOM % 9000)))"
  TUTOR_ID="tutor_$(printf "%05d" $((100 + RANDOM % 900)))"
  SUBJECT=${SUBJECTS[$RANDOM % ${#SUBJECTS[@]}]}
  TIER=${TIERS[$RANDOM % ${#TIERS[@]}]}

  # Generate event-specific payloads
  case $EVENT_TYPE in
    "session_started")
      PAYLOAD=$(cat <<EOF
{
  "event_type": "session_started",
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "payload": {
    "customer_id": "$CUSTOMER_ID",
    "tutor_id": "$TUTOR_ID",
    "session_id": "session_$(date +%s)_$i",
    "subject": "$SUBJECT",
    "tier": "$TIER",
    "scheduled_duration_minutes": $((30 + RANDOM % 60))
  }
}
EOF
)
      ;;

    "session_completed")
      RATING=$(awk 'BEGIN{srand(); printf "%.1f", 3.0 + rand() * 2.0}')
      PAYLOAD=$(cat <<EOF
{
  "event_type": "session_completed",
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "payload": {
    "customer_id": "$CUSTOMER_ID",
    "tutor_id": "$TUTOR_ID",
    "session_id": "session_$(date +%s)_$i",
    "subject": "$SUBJECT",
    "tier": "$TIER",
    "duration_minutes": $((25 + RANDOM % 65)),
    "rating": $RATING,
    "was_cancelled": $([ $((RANDOM % 100)) -lt 10 ] && echo "true" || echo "false"),
    "no_show": $([ $((RANDOM % 100)) -lt 5 ] && echo "true" || echo "false")
  }
}
EOF
)
      ;;

    "ib_call_logged")
      SENTIMENTS=("positive" "neutral" "negative")
      SENTIMENT=${SENTIMENTS[$RANDOM % ${#SENTIMENTS[@]}]}
      REASONS=("scheduling_issue" "technical_problem" "tutor_mismatch" "billing_question" "general_inquiry")
      REASON=${REASONS[$RANDOM % ${#REASONS[@]}]}

      PAYLOAD=$(cat <<EOF
{
  "event_type": "ib_call_logged",
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "payload": {
    "customer_id": "$CUSTOMER_ID",
    "call_id": "call_$(date +%s)_$i",
    "sentiment": "$SENTIMENT",
    "reason": "$REASON",
    "duration_seconds": $((60 + RANDOM % 600)),
    "resolved": $([ $((RANDOM % 100)) -lt 70 ] && echo "true" || echo "false")
  }
}
EOF
)
      ;;

    "tutor_availability_updated")
      PAYLOAD=$(cat <<EOF
{
  "event_type": "tutor_availability_updated",
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "payload": {
    "tutor_id": "$TUTOR_ID",
    "subjects": ["$SUBJECT"],
    "available_slots_this_week": $((5 + RANDOM % 30)),
    "avg_rating": $(awk 'BEGIN{srand(); printf "%.1f", 3.5 + rand() * 1.5}'),
    "total_sessions_completed": $((50 + RANDOM % 500))
  }
}
EOF
)
      ;;

    "customer_health_update")
      HEALTH_SCORE=$((40 + RANDOM % 60))
      SEGMENTS=("thriving" "healthy" "at_risk" "churned")
      SEGMENT=${SEGMENTS[$RANDOM % ${#SEGMENTS[@]}]}

      PAYLOAD=$(cat <<EOF
{
  "event_type": "customer_health_update",
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "payload": {
    "customer_id": "$CUSTOMER_ID",
    "health_score": $HEALTH_SCORE,
    "segment": "$SEGMENT",
    "sessions_last_7_days": $((0 + RANDOM % 5)),
    "churn_risk_14d": $(awk 'BEGIN{srand(); printf "%.2f", rand()}'),
    "session_velocity": $(awk 'BEGIN{srand(); printf "%.2f", rand() * 3}')
  }
}
EOF
)
      ;;

    "supply_demand_update")
      PAYLOAD=$(cat <<EOF
{
  "event_type": "supply_demand_update",
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "payload": {
    "subject": "$SUBJECT",
    "available_tutors": $((10 + RANDOM % 50)),
    "pending_requests": $((5 + RANDOM % 30)),
    "supply_demand_ratio": $(awk 'BEGIN{srand(); printf "%.2f", 0.5 + rand() * 2.0}'),
    "avg_wait_time_hours": $(awk 'BEGIN{srand(); printf "%.1f", rand() * 24}')
  }
}
EOF
)
      ;;
  esac

  # Send to API Gateway
  RESPONSE=$(curl -s -X POST \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD" \
    -w "\nHTTP_CODE:%{http_code}" \
    "$API_ENDPOINT" 2>&1)

  HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE" | cut -d: -f2)

  if [ "$HTTP_CODE" == "200" ]; then
    printf "\r[$i/$NUM_EVENTS] ✓ $EVENT_TYPE"
  else
    printf "\r[$i/$NUM_EVENTS] ✗ $EVENT_TYPE (HTTP $HTTP_CODE)"
  fi

  sleep 0.3
done

echo ""
echo "✓ Done! Generated $NUM_EVENTS tutor marketplace events"
echo ""
echo "Events flow: API Gateway → Kinesis → Stream Processor → DynamoDB"
echo "Check DynamoDB table 'iops-dashboard-metrics' for processed events"
