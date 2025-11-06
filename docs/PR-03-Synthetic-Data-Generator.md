# PR-03: Synthetic Data Generator

## Overview
Create a **Python-based** Lambda simulator that generates realistic Varsity Tutors-style events for demo and testing purposes. This simulator will emit 50+ concurrent streams of data to the ingestion API.

## Language
**Python 3.12** - Better for data generation with Faker library and statistical distributions

## Dependencies
- PR-02: Data Ingestion Lambda (requires ingestion API endpoint)

## AWS Credentials Setup
**IMPORTANT**: Ensure AWS credentials are configured before running CDK/CLI commands.

See `/Users/tyler/Desktop/Gauntlet/iops-dashboard/docs/AWS-credentials.md` for setup instructions.

## Objectives
- Build synthetic data generator Lambda
- Create realistic event patterns for all 6 event types
- Support configurable event rates and stream counts
- Set up scheduled execution via EventBridge

## Step-by-Step Instructions

### 1. Create Simulator Lambda Code
**File:** `lambda/simulator/handler.py`

```python
import json
import os
import random
from datetime import datetime
from typing import Dict, Any, List
import requests

# Configuration from environment variables
INGEST_API_URL = os.environ['INGEST_API_URL']
STREAM_COUNT = int(os.environ.get('STREAM_COUNT', '50'))
EVENTS_PER_RUN = int(os.environ.get('EVENTS_PER_RUN', '10'))

# Event types from PRD
EVENT_TYPES = [
    'session_started',
    'session_completed',
    'ib_call_logged',
    'tutor_availability_updated',
    'customer_health_update',
    'supply_demand_update',
]

# Helper functions for generating realistic data
def random_int(min_val: int, max_val: int) -> int:
    """Generate random integer between min and max (inclusive)"""
    return random.randint(min_val, max_val)

def random_choice(arr: List[Any]) -> Any:
    """Select random element from array"""
    return random.choice(arr)

def generate_student_id() -> str:
    return f"stu_{random_int(1000, 9999)}"

def generate_tutor_id() -> str:
    return f"tut_{random_int(100, 999)}"

def generate_session_id() -> str:
    return f"sess_{int(datetime.now().timestamp() * 1000)}_{random_int(1000, 9999)}"

def generate_subject() -> str:
    return random_choice([
        'Mathematics',
        'Physics',
        'Chemistry',
        'Biology',
        'English',
        'History',
        'Computer Science',
        'Spanish',
        'French',
    ])

# Generate event-specific payloads
def generate_payload(event_type: str) -> Dict[str, Any]:
    """Generate realistic payload for each event type"""
    base_data = {
        'timestamp': datetime.utcnow().isoformat() + 'Z',
        'source': 'simulator',
    }

    if event_type == 'session_started':
        return {
            **base_data,
            'session_id': generate_session_id(),
            'student_id': generate_student_id(),
            'tutor_id': generate_tutor_id(),
            'subject': generate_subject(),
            'session_type': random_choice(['one_on_one', 'group', 'instant_book']),
            'scheduled_duration_minutes': random_choice([30, 60, 90]),
        }

    elif event_type == 'session_completed':
        return {
            **base_data,
            'session_id': generate_session_id(),
            'student_id': generate_student_id(),
            'tutor_id': generate_tutor_id(),
            'subject': generate_subject(),
            'actual_duration_minutes': random_int(20, 95),
            'student_rating': random_int(3, 5),
            'tutor_rating': random_int(3, 5),
            'completed_successfully': random.random() > 0.1,  # 90% success rate
        }

    elif event_type == 'ib_call_logged':
        return {
            **base_data,
            'call_id': f"call_{int(datetime.now().timestamp() * 1000)}_{random_int(100, 999)}",
            'student_id': generate_student_id(),
            'reason': random_choice([
                'scheduling_issue',
                'technical_problem',
                'tutor_concern',
                'billing_question',
                'general_inquiry',
            ]),
            'duration_seconds': random_int(60, 600),
            'resolved': random.random() > 0.3,  # 70% resolution rate
            'priority': random_choice(['low', 'medium', 'high']),
        }

    elif event_type == 'tutor_availability_updated':
        return {
            **base_data,
            'tutor_id': generate_tutor_id(),
            'available_hours_this_week': random_int(0, 40),
            'subjects': [generate_subject(), generate_subject()],
            'timezone': random_choice(['EST', 'CST', 'MST', 'PST']),
            'accepts_instant_book': random.random() > 0.5,
        }

    elif event_type == 'customer_health_update':
        return {
            **base_data,
            'student_id': generate_student_id(),
            'sessions_last_7_days': random_int(0, 10),
            'sessions_last_30_days': random_int(0, 40),
            'ib_calls_last_14_days': random_int(0, 5),
            'avg_session_rating': round(random.random() * 2 + 3, 2),  # 3.0-5.0
            'health_score': round(random.random() * 40 + 60, 2),  # 60-100
            'churn_risk': random_choice(['low', 'medium', 'high']),
        }

    elif event_type == 'supply_demand_update':
        return {
            **base_data,
            'subject': generate_subject(),
            'region': random_choice(['northeast', 'southeast', 'midwest', 'west', 'southwest']),
            'available_tutors': random_int(5, 100),
            'active_students': random_int(10, 500),
            'demand_score': round(random.random() * 50 + 50, 2),  # 50-100
            'supply_score': round(random.random() * 50 + 50, 2),  # 50-100
            'balance_status': random_choice(['balanced', 'high_demand', 'oversupplied']),
        }

    return base_data

# Generate and send a single event
def generate_event() -> None:
    """Generate and send a single random event"""
    event_type = random_choice(EVENT_TYPES)
    payload = generate_payload(event_type)

    event = {
        'event_type': event_type,
        'payload': payload,
    }

    try:
        response = requests.post(
            INGEST_API_URL,
            json=event,
            headers={'Content-Type': 'application/json'},
            timeout=5
        )
        response.raise_for_status()

        result = response.json()
        print(f"Sent {event_type}: {result.get('sequenceNumber', 'unknown')}")

    except requests.exceptions.RequestException as error:
        print(f"Failed to send {event_type}: {str(error)}")

# Main Lambda handler
def lambda_handler(event: Dict[str, Any], context: Any) -> None:
    """Main Lambda handler for scheduled execution"""
    print(f"Starting simulation: {STREAM_COUNT} streams, {EVENTS_PER_RUN} events per stream")
    print(f"Target API: {INGEST_API_URL}")

    total_events = STREAM_COUNT * EVENTS_PER_RUN
    print(f"Generating {total_events} total events...")

    # Generate events with controlled pacing
    events_sent = 0
    for i in range(total_events):
        generate_event()
        events_sent += 1

        # Add small delay every 10 events to avoid overwhelming the API
        if (i + 1) % 10 == 0:
            import time
            time.sleep(0.1)  # 100ms delay

    print(f"Simulation complete: {events_sent} events sent")
```

### 2. Create Requirements File
**File:** `lambda/simulator/requirements.txt`

```
requests==2.31.0
faker==22.0.0
```

### 3. Add Simulator to CDK Stack

**IMPORTANT - Dependency Management:**
- ✅ CDK automatically bundles Python dependencies using Docker during `cdk deploy`
- ❌ **NEVER** run `pip install -r requirements.txt -t .` in Lambda directories
- ❌ **NEVER** commit package directories (boto3, numpy, etc.) to git
- ✅ Keep Lambda folders clean - only `handler.py` and `requirements.txt`
- ✅ For local testing, use virtual environments (see `docs/Lambda-Dependency-Management.md`)

CDK bundling configuration is already set up in the stack (see step 4 below).

### 4. Update CDK Stack Configuration
**File:** `cdk/lib/core-stack.ts` (update)

Add imports:
```typescript
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
```

Add to CoreStack constructor (after ingest API):
```typescript
// Create Simulator Lambda (Python)
const simulatorLambda = new lambda.Function(this, 'SimulatorFunction', {
  runtime: lambda.Runtime.PYTHON_3_12,
  handler: 'handler.lambda_handler',
  code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/simulator'), {
    bundling: {
      image: lambda.Runtime.PYTHON_3_12.bundlingImage,
      command: [
        'bash', '-c',
        'pip install -r requirements.txt -t /asset-output && cp -au . /asset-output'
      ],
    },
  }),
  role: this.lambdaExecutionRole,
  environment: {
    INGEST_API_URL: api.url + 'ingest',
    STREAM_COUNT: '50',
    EVENTS_PER_RUN: '10', // 10 events per stream per minute = 500 events/min
  },
  timeout: cdk.Duration.minutes(5),
  memorySize: 512,
  description: 'Generates synthetic data for demo and testing (Python)',
});

// Create EventBridge rule to run simulator every minute
const simulatorRule = new events.Rule(this, 'SimulatorSchedule', {
  schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
  description: 'Triggers synthetic data generation every minute',
  enabled: false, // Start disabled, enable manually when needed
});

simulatorRule.addTarget(new targets.LambdaFunction(simulatorLambda));

// Output simulator function name
new cdk.CfnOutput(this, 'SimulatorFunctionName', {
  value: simulatorLambda.functionName,
  description: 'Name of simulator Lambda function',
  exportName: 'IOpsDashboard-SimulatorFunctionName',
});

new cdk.CfnOutput(this, 'SimulatorRuleName', {
  value: simulatorRule.ruleName,
  description: 'EventBridge rule for simulator schedule',
  exportName: 'IOpsDashboard-SimulatorRuleName',
});
```

### 5. Deploy Updated Stack
```bash
cd cdk
npm run build
cdk deploy CdkStack
```

## Verification Steps

### 1. Manually Invoke Simulator (One-Time Test)
```bash
# Get function name from outputs
FUNCTION_NAME=$(aws cloudformation describe-stacks \
  --stack-name CdkStack \
  --query 'Stacks[0].Outputs[?OutputKey==`SimulatorFunctionName`].OutputValue' \
  --output text)

# Invoke the function
aws lambda invoke \
  --function-name $FUNCTION_NAME \
  --payload '{}' \
  response.json

# Check response
cat response.json
```

### 2. Check Lambda Logs
```bash
aws logs tail /aws/lambda/$FUNCTION_NAME --follow
```

You should see logs like:
```
Starting simulation: 50 streams, 10 events per stream
Generating 500 total events...
Sent session_started: 49617749...
Sent ib_call_logged: 49617750...
...
Simulation complete: 500 events sent
```

### 3. Verify Events in Kinesis
```bash
# Check stream metrics
aws kinesis describe-stream-summary --stream-name iops-dashboard-events

# Should show increased IncomingRecords and IncomingBytes
```

### 4. Enable Scheduled Execution (Optional)
```bash
# Get rule name
RULE_NAME=$(aws cloudformation describe-stacks \
  --stack-name CdkStack \
  --query 'Stacks[0].Outputs[?OutputKey==`SimulatorRuleName`].OutputValue' \
  --output text)

# Enable the rule to run every minute
aws events enable-rule --name $RULE_NAME

# To disable later:
# aws events disable-rule --name $RULE_NAME
```

### 5. Monitor Event Distribution
Create a quick test script to verify event type distribution:

**File:** `scripts/check-event-distribution.sh`
```bash
#!/bin/bash
# Quick script to check event type distribution

SHARD_ITERATOR=$(aws kinesis get-shard-iterator \
  --stream-name iops-dashboard-events \
  --shard-id shardId-000000000000 \
  --shard-iterator-type LATEST \
  --query 'ShardIterator' \
  --output text)

aws kinesis get-records --shard-iterator $SHARD_ITERATOR \
  | jq '.Records[].Data' \
  | while read record; do
      echo $record | base64 -d | jq -r '.event_type'
    done \
  | sort | uniq -c
```

Expected output shows distribution across all 6 event types:
```
 45 customer_health_update
 52 ib_call_logged
 48 session_completed
 51 session_started
 47 supply_demand_update
 44 tutor_availability_updated
```

## Configuration Options

### Adjust Event Rate
```bash
# Update Lambda environment variables
aws lambda update-function-configuration \
  --function-name $FUNCTION_NAME \
  --environment "Variables={
    INGEST_API_URL=$API_URL,
    STREAM_COUNT=100,
    EVENTS_PER_RUN=20
  }"
```

This would generate 2000 events per minute (100 streams × 20 events).

### Change Schedule Frequency
Modify in CDK:
```typescript
schedule: events.Schedule.rate(cdk.Duration.seconds(30)), // Every 30 seconds
// or
schedule: events.Schedule.cron({ minute: '*/5' }), // Every 5 minutes
```

## Troubleshooting

### Issue: Too Many Events, API Throttling
**Solution:** Reduce EVENTS_PER_RUN or STREAM_COUNT:
```bash
aws lambda update-function-configuration \
  --function-name $FUNCTION_NAME \
  --environment "Variables={
    INGEST_API_URL=$API_URL,
    STREAM_COUNT=25,
    EVENTS_PER_RUN=5
  }"
```

### Issue: Timeout Errors
**Solution:** Increase Lambda timeout or reduce batch size:
```bash
aws lambda update-function-configuration \
  --function-name $FUNCTION_NAME \
  --timeout 300
```

### Issue: Axios Connection Errors
**Solution:** Check API URL is correct:
```bash
aws lambda get-function-configuration \
  --function-name $FUNCTION_NAME \
  | jq '.Environment.Variables.INGEST_API_URL'
```

## Files Created
- `lambda/simulator/handler.py`
- `lambda/simulator/requirements.txt`
- `cdk/lib/core-stack.ts` (updated)
- `scripts/check-event-distribution.sh`

## Next Steps
- PR-04: Processing Lambda (will consume these events from Kinesis)
- PR-08: DynamoDB Schema (will store aggregated metrics)

## Estimated Time
- 30-45 minutes

## Skills Required
- Basic Python
- Understanding of random data generation
- EventBridge concepts (optional)

## References
- [AWS Lambda Scheduled Events](https://docs.aws.amazon.com/lambda/latest/dg/services-cloudwatchevents.html)
- [EventBridge Schedule Expressions](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-create-rule-schedule.html)
- [Axios Documentation](https://axios-http.com/docs/intro)
