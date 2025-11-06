#!/bin/bash

CRITICAL_TOPIC=$1
WARNING_TOPIC=$2
INFO_TOPIC=$3

if [ -z "$CRITICAL_TOPIC" ] || [ -z "$WARNING_TOPIC" ] || [ -z "$INFO_TOPIC" ]; then
  echo "Usage: $0 <critical-topic-arn> <warning-topic-arn> <info-topic-arn>"
  echo ""
  echo "Example:"
  echo "  ./scripts/test-alerts.sh \\"
  echo "    \$(aws cloudformation describe-stacks --stack-name IOpsDashboard-IntelligenceStack --query 'Stacks[0].Outputs[?OutputKey==\`CriticalAlertTopicArn\`].OutputValue' --output text) \\"
  echo "    \$(aws cloudformation describe-stacks --stack-name IOpsDashboard-IntelligenceStack --query 'Stacks[0].Outputs[?OutputKey==\`WarningAlertTopicArn\`].OutputValue' --output text) \\"
  echo "    \$(aws cloudformation describe-stacks --stack-name IOpsDashboard-IntelligenceStack --query 'Stacks[0].Outputs[?OutputKey==\`InfoAlertTopicArn\`].OutputValue' --output text)"
  exit 1
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Testing IOps Dashboard Alert System"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

echo "Testing Critical Alert..."
aws sns publish \
  --topic-arn $CRITICAL_TOPIC \
  --subject "🚨 Critical: Low Health Score" \
  --message '{
    "alert_type": "low_health_score",
    "severity": "critical",
    "entity_id": "stu_9999",
    "entity_type": "student",
    "details": {
      "health_score": 35,
      "sessions_7d": 0,
      "ib_calls_14d": 8
    },
    "message": "Student stu_9999 has critically low health score",
    "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
    "risk_score": 95,
    "explanation": "Zero sessions in 7 days combined with 8 IB calls indicates extreme churn risk.",
    "recommendations": [
      "Immediate outreach from customer success team",
      "Offer free session with senior tutor",
      "Investigate root cause of IB call frequency"
    ]
  }'

if [ $? -eq 0 ]; then
  echo "✅ Critical alert sent successfully"
else
  echo "❌ Failed to send critical alert"
fi

echo ""
echo "Testing Warning Alert..."
aws sns publish \
  --topic-arn $WARNING_TOPIC \
  --subject "⚠️ Warning: High IB Call Frequency" \
  --message '{
    "alert_type": "high_ib_call_frequency",
    "severity": "warning",
    "entity_id": "stu_7777",
    "entity_type": "student",
    "details": {
      "ib_calls_14d": 4,
      "health_score": 68
    },
    "message": "Student stu_7777 has 4 IB calls in 14 days",
    "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
    "risk_score": 72,
    "explanation": "Elevated IB call frequency may indicate dissatisfaction.",
    "recommendations": [
      "Review IB call transcripts for patterns",
      "Schedule check-in call with student"
    ]
  }'

if [ $? -eq 0 ]; then
  echo "✅ Warning alert sent successfully"
else
  echo "❌ Failed to send warning alert"
fi

echo ""
echo "Testing Info Alert..."
aws sns publish \
  --topic-arn $INFO_TOPIC \
  --subject "ℹ️ Info: Supply Demand Update" \
  --message '{
    "alert_type": "supply_demand_imbalance",
    "severity": "info",
    "entity_id": "Mathematics",
    "entity_type": "subject",
    "details": {
      "balance_status": "high_demand",
      "demand_score": 92,
      "supply_score": 58
    },
    "message": "High demand detected for Mathematics",
    "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
    "explanation": "Demand significantly exceeds supply in Mathematics category.",
    "recommendations": [
      "Recruit additional math tutors",
      "Promote math tutoring to existing tutors",
      "Consider incentive programs"
    ]
  }'

if [ $? -eq 0 ]; then
  echo "✅ Info alert sent successfully"
else
  echo "❌ Failed to send info alert"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Test alerts sent! Check your email."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "If you don't receive emails:"
echo "  1. Check spam folder"
echo "  2. Verify SNS subscriptions are confirmed"
echo "  3. Check CloudWatch Logs for errors"
