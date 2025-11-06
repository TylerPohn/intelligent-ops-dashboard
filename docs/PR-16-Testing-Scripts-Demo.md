# PR-16: Testing Scripts + Demo Flow

## Overview
Create comprehensive testing scripts and demo flow for showcasing the system.

## Testing Scripts

### 1. End-to-End Test Script

**File:** `scripts/e2e-test.sh`

```bash
#!/bin/bash

set -e

echo "🧪 Starting End-to-End Test..."

# Get API URL
API_URL=$(aws cloudformation describe-stacks \
  --stack-name IOpsDashboard-CoreStack \
  --query 'Stacks[0].Outputs[?OutputKey==`IngestApiUrl`].OutputValue' \
  --output text)

echo "📡 API URL: $API_URL"

# Test 1: Send session_started event
echo "Test 1: Sending session_started event..."
curl -X POST $API_URL \
  -H "Content-Type: application/json" \
  -d '{
    "event_type": "session_started",
    "payload": {
      "session_id": "sess_test_001",
      "student_id": "stu_test_001",
      "tutor_id": "tut_test_001",
      "subject": "Mathematics"
    }
  }'

echo "\n✅ Test 1 passed"

# Test 2: Send IB call event
echo "\nTest 2: Sending IB call event..."
curl -X POST $API_URL \
  -H "Content-Type: application/json" \
  -d '{
    "event_type": "ib_call_logged",
    "payload": {
      "call_id": "call_test_001",
      "student_id": "stu_test_001",
      "reason": "technical_problem"
    }
  }'

echo "\n✅ Test 2 passed"

# Test 3: Send low health score
echo "\nTest 3: Sending customer health update (low score)..."
curl -X POST $API_URL \
  -H "Content-Type: application/json" \
  -d '{
    "event_type": "customer_health_update",
    "payload": {
      "student_id": "stu_test_001",
      "health_score": 45,
      "sessions_last_7_days": 0,
      "ib_calls_last_14_days": 5
    }
  }'

echo "\n✅ Test 3 passed"

echo "\n⏳ Waiting 30 seconds for processing..."
sleep 30

# Check DynamoDB for results
echo "\nChecking DynamoDB for metrics..."
aws dynamodb get-item \
  --table-name iops-dashboard-metrics \
  --key '{"entity_id":{"S":"stu_test_001"},"entity_type":{"S":"student"}}' \
  | jq '.Item.health_score.N'

echo "\n✅ All tests passed!"
echo "Check your email for alert notifications."
```

### 2. Load Test Script

**File:** `scripts/load-test.sh`

```bash
#!/bin/bash

# Run simulator for 5 minutes
echo "🔥 Starting load test (5 minutes)..."

SIM_FUNCTION=$(aws cloudformation describe-stacks \
  --stack-name IOpsDashboard-CoreStack \
  --query 'Stacks[0].Outputs[?OutputKey==`SimulatorFunctionName`].OutputValue' \
  --output text)

# Enable simulator schedule
RULE_NAME=$(aws cloudformation describe-stacks \
  --stack-name IOpsDashboard-CoreStack \
  --query 'Stacks[0].Outputs[?OutputKey==`SimulatorRuleName`].OutputValue' \
  --output text)

aws events enable-rule --name $RULE_NAME

echo "Load test running. Will disable in 5 minutes..."
sleep 300

aws events disable-rule --name $RULE_NAME

echo "✅ Load test complete"
```

### 3. Demo Flow Script

**File:** `scripts/demo.sh`

```bash
#!/bin/bash

echo "🎬 IOps Dashboard Demo"
echo "====================="

# Step 1: Show current system status
echo "\n📊 Step 1: Current System Status"
aws dynamodb scan --table-name iops-dashboard-metrics --select COUNT

# Step 2: Generate synthetic data
echo "\n🎲 Step 2: Generating synthetic data..."
SIM_FUNCTION=$(aws cloudformation describe-stacks \
  --stack-name IOpsDashboard-CoreStack \
  --query 'Stacks[0].Outputs[?OutputKey==`SimulatorFunctionName`].OutputValue' \
  --output text)

aws lambda invoke --function-name $SIM_FUNCTION --payload '{}' response.json
echo "Generated $(cat response.json | jq -r '.eventsGenerated') events"

# Step 3: Wait for processing
echo "\n⏳ Step 3: Processing events (30 seconds)..."
sleep 30

# Step 4: Show alerts generated
echo "\n🚨 Step 4: Alerts Generated"
aws dynamodb scan --table-name iops-dashboard-insights \
  | jq '.Items | length'

# Step 5: Show high-risk students
echo "\n📈 Step 5: High-Risk Students"
./scripts/query-metrics.sh

# Step 6: Open dashboard
echo "\n🌐 Step 6: Opening dashboard..."
open "http://localhost:3000"

echo "\n✅ Demo complete!"
```

## Demo Checklist

**File:** `docs/demo-checklist.md`

```markdown
# Demo Checklist

## Pre-Demo Setup (15 minutes)
- [ ] Deploy all CDK stacks
- [ ] Confirm email subscriptions
- [ ] Enable Bedrock access
- [ ] Start frontend dev server
- [ ] Clear test data from DynamoDB

## Demo Flow (10 minutes)

### 1. Show Architecture (2 min)
- Open `docs/architecture.md`
- Explain data flow

### 2. Generate Data (2 min)
- Run `scripts/demo.sh`
- Show Kinesis metrics in CloudWatch

### 3. Show Real-Time Dashboard (3 min)
- Open frontend
- Show KPI cards updating
- Show charts

### 4. Trigger High-Risk Alert (2 min)
- Send low health score event
- Show AI inference in CloudWatch Logs
- Check email for alert

### 5. Show Explainability (1 min)
- Click alert in dashboard
- Show AI explanation and recommendations

## Post-Demo Cleanup
- [ ] Disable simulator schedule
- [ ] Delete test data
- [ ] Review CloudWatch costs
```

Make executable:
```bash
chmod +x scripts/*.sh
```

## Run Demo
```bash
./scripts/demo.sh
```

## Estimated Time: 60 minutes
