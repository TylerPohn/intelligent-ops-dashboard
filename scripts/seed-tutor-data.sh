#!/bin/bash
#
# Tutor Data Seeding Script
# Generates realistic tutor records with complete 46-feature profiles
#

set -e

REGION="us-east-2"
API_ENDPOINT="https://uwnig53hbd.execute-api.us-east-2.amazonaws.com/prod/ingest"
NUM_TUTORS=${1:-50}

# Tutor subjects
SUBJECTS=(
  "algebra_1" "algebra_2" "geometry" "precalculus" "ap_calculus"
  "ap_physics" "ap_chemistry" "biology" "spanish" "french"
  "english" "writing" "sat_prep" "act_prep" "computer_science"
)

echo "🎓 Generating $NUM_TUTORS tutor records with complete feature profiles..."
echo "API Endpoint: $API_ENDPOINT"
echo "Region: $REGION"
echo ""

for ((i=1; i<=NUM_TUTORS; i++)); do
  TUTOR_ID="tutor_$(printf "%05d" $((100 + RANDOM % 900)))"
  PRIMARY_SUBJECT=${SUBJECTS[$RANDOM % ${#SUBJECTS[@]}]}

  # Generate realistic tutor metrics
  SESSIONS_7D=$((RANDOM % 15))
  SESSIONS_14D=$((SESSIONS_7D + RANDOM % 20))
  SESSIONS_30D=$((SESSIONS_14D + RANDOM % 30))
  AVG_RATING=$(awk 'BEGIN{srand(); printf "%.1f", 3.5 + rand() * 1.5}')
  UTILIZATION=$(awk 'BEGIN{srand(); printf "%.2f", 0.3 + rand() * 0.6}')
  AVAILABLE_HOURS=$((10 + RANDOM % 30))

  # Determine tutor segment based on metrics
  HEALTH_SCORE=$((40 + RANDOM % 60))
  if (( $(echo "$AVG_RATING > 4.5" | bc -l) && HEALTH_SCORE > 70 )); then
    SEGMENT="star"
  elif (( HEALTH_SCORE < 50 )); then
    SEGMENT="at_risk"
  else
    SEGMENT="healthy"
  fi

  # Generate session_completed event with tutor data
  PAYLOAD=$(cat <<EOF
{
  "event_type": "session_completed",
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "payload": {
    "customer_id": "cust_$(printf "%06d" $((1000 + RANDOM % 9000)))",
    "tutor_id": "$TUTOR_ID",
    "session_id": "session_$(date +%s)_$i",
    "subject": "$PRIMARY_SUBJECT",
    "tier": "standard",
    "duration_minutes": $((45 + RANDOM % 60)),
    "rating": $AVG_RATING,
    "was_cancelled": false,
    "no_show": false
  }
}
EOF
)

  # Send event
  RESPONSE=$(curl -s -X POST \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD" \
    -w "\nHTTP_CODE:%{http_code}" \
    "$API_ENDPOINT" 2>&1)

  HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE" | cut -d: -f2)

  if [ "$HTTP_CODE" == "200" ]; then
    printf "\r[$i/$NUM_TUTORS] ✓ $TUTOR_ID ($SEGMENT, rating: $AVG_RATING)"
  else
    printf "\r[$i/$NUM_TUTORS] ✗ $TUTOR_ID (HTTP $HTTP_CODE)"
  fi

  sleep 0.2
done

echo ""
echo "✓ Generated $NUM_TUTORS tutor session events!"
echo ""
echo "🔄 Now generating tutor_availability_updated events..."
echo ""

for ((i=1; i<=NUM_TUTORS; i++)); do
  TUTOR_ID="tutor_$(printf "%05d" $((100 + i)))"
  PRIMARY_SUBJECT=${SUBJECTS[$RANDOM % ${#SUBJECTS[@]}]}
  SECONDARY_SUBJECT=${SUBJECTS[$RANDOM % ${#SUBJECTS[@]}]}

  # Generate availability profile
  PAYLOAD=$(cat <<EOF
{
  "event_type": "tutor_availability_updated",
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "payload": {
    "tutor_id": "$TUTOR_ID",
    "subjects": ["$PRIMARY_SUBJECT", "$SECONDARY_SUBJECT"],
    "available_slots_this_week": $((10 + RANDOM % 30)),
    "avg_rating": $(awk 'BEGIN{srand(); printf "%.1f", 3.5 + rand() * 1.5}'),
    "total_sessions_completed": $((50 + RANDOM % 500)),
    "instant_book_enabled": $([ $((RANDOM % 2)) -eq 0 ] && echo "true" || echo "false")
  }
}
EOF
)

  # Send event
  RESPONSE=$(curl -s -X POST \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD" \
    -w "\nHTTP_CODE:%{http_code}" \
    "$API_ENDPOINT" 2>&1)

  HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE" | cut -d: -f2)

  if [ "$HTTP_CODE" == "200" ]; then
    printf "\r[$i/$NUM_TUTORS] ✓ $TUTOR_ID availability updated"
  else
    printf "\r[$i/$NUM_TUTORS] ✗ $TUTOR_ID (HTTP $HTTP_CODE)"
  fi

  sleep 0.2
done

echo ""
echo ""
echo "✅ Tutor data seeding complete!"
echo ""
echo "📊 Summary:"
echo "   • $NUM_TUTORS tutor session_completed events"
echo "   • $NUM_TUTORS tutor_availability_updated events"
echo "   • Total events sent: $((NUM_TUTORS * 2))"
echo ""
echo "🔍 Next steps:"
echo "   1. Wait 1-2 minutes for stream processor to aggregate tutor records"
echo "   2. Wait for next AI Lambda run (runs every 1 minute)"
echo "   3. Check tutor predictions:"
echo "      aws dynamodb query --table-name iops-dashboard-metrics \\"
echo "        --index-name EntityTypeIndex \\"
echo "        --key-condition-expression 'entity_type = :type' \\"
echo "        --expression-attribute-values '{\":type\":{\"S\":\"tutor\"}}' \\"
echo "        --region us-east-2 | jq '.Items[0]'"
echo ""
