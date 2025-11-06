# PR-04: Processing Lambda

## Overview
Create the **Python-based** processing Lambda that consumes events from Kinesis, aggregates metrics, and detects anomalies for alerting.

## Language
**Python 3.12** - Superior data manipulation with pandas, statistical analysis with scipy, and time-series capabilities

## Dependencies
- PR-02: Data Ingestion Lambda (Kinesis stream must exist)
- PR-08: DynamoDB Schema (should be implemented first, or stub it here)

## AWS Credentials Setup
**IMPORTANT**: Ensure AWS credentials are configured before running CDK/CLI commands.

See `/Users/tyler/Desktop/Gauntlet/iops-dashboard/docs/AWS-credentials.md` for setup instructions.

## Objectives
- Build Lambda to process Kinesis stream records
- Aggregate session metrics (7/14/30 day windows)
- Calculate key health indicators
- Detect anomalies for alerting
- Store aggregated data in DynamoDB

## Step-by-Step Instructions

### 1. Create Processing Lambda Code
**File:** `lambda/process/handler.py`

```python
import json
import os
import base64
from datetime import datetime
from typing import Dict, Any, List, Optional
import boto3
from decimal import Decimal

# Initialize AWS clients
dynamodb = boto3.resource('dynamodb', region_name=os.environ.get('AWS_REGION', 'us-east-1'))
eventbridge = boto3.client('events', region_name=os.environ.get('AWS_REGION', 'us-east-1'))

# Configuration
TABLE_NAME = os.environ['DYNAMODB_TABLE_NAME']
EVENT_BUS_NAME = os.environ.get('EVENT_BUS_NAME', 'default')

# Get DynamoDB table
table = dynamodb.Table(TABLE_NAME)

# Type definitions
class IncomingEvent:
    def __init__(self, data: Dict[str, Any]):
        self.event_type = data['event_type']
        self.timestamp = data.get('timestamp', datetime.utcnow().isoformat())
        self.payload = data['payload']
        self.ingested_at = data.get('ingested_at', datetime.utcnow().isoformat())

class AggregatedMetrics:
    def __init__(self, entity_id: str, entity_type: str):
        self.entity_id = entity_id
        self.entity_type = entity_type  # 'student', 'tutor', 'subject', or 'region'
        self.sessions_7d = 0
        self.sessions_14d = 0
        self.sessions_30d = 0
        self.ib_calls_7d = 0
        self.ib_calls_14d = 0
        self.avg_rating = 0.0
        self.health_score = 100.0
        self.last_updated = datetime.utcnow().isoformat()

# Decode Kinesis record
def decode_record(record: Dict[str, Any]) -> Optional[IncomingEvent]:
    """Decode base64 Kinesis record data"""
    try:
        data = base64.b64decode(record['kinesis']['data']).decode('utf-8')
        parsed = json.loads(data)
        return IncomingEvent(parsed)
    except Exception as error:
        print(f"Failed to decode record: {error}")
        return None

# Get or create aggregated metrics for an entity
def get_metrics(entity_id: str, entity_type: str) -> Dict[str, Any]:
    """Get existing metrics or return default"""
    try:
        response = table.get_item(
            Key={
                'entity_id': entity_id,
                'entity_type': entity_type
            }
        )

        if 'Item' in response:
            return response['Item']

    except Exception as error:
        print(f"Error fetching metrics: {error}")

    # Return default metrics for new entities
    return {
        'entity_id': entity_id,
        'entity_type': entity_type,
        'sessions_7d': 0,
        'sessions_14d': 0,
        'sessions_30d': 0,
        'ib_calls_7d': 0,
        'ib_calls_14d': 0,
        'avg_rating': Decimal('0'),
        'health_score': Decimal('100'),
        'last_updated': datetime.utcnow().isoformat(),
    }

# Convert float to Decimal for DynamoDB
def to_decimal(value: Any) -> Decimal:
    """Convert float to Decimal for DynamoDB storage"""
    if isinstance(value, float):
        return Decimal(str(value))
    return value

# Update metrics based on event
def update_metrics(event: IncomingEvent) -> None:
    """Update aggregated metrics in DynamoDB"""
    event_type = event.event_type
    payload = event.payload

    if event_type in ['session_started', 'session_completed']:
        student_id = payload.get('student_id')
        tutor_id = payload.get('tutor_id')

        if student_id:
            metrics = get_metrics(student_id, 'student')
            metrics['sessions_7d'] = metrics.get('sessions_7d', 0) + 1
            metrics['sessions_14d'] = metrics.get('sessions_14d', 0) + 1
            metrics['sessions_30d'] = metrics.get('sessions_30d', 0) + 1
            metrics['last_updated'] = datetime.utcnow().isoformat()

            table.put_item(Item=metrics)

        if tutor_id:
            metrics = get_metrics(tutor_id, 'tutor')
            metrics['sessions_7d'] = metrics.get('sessions_7d', 0) + 1
            metrics['sessions_14d'] = metrics.get('sessions_14d', 0) + 1
            metrics['sessions_30d'] = metrics.get('sessions_30d', 0) + 1

            if event_type == 'session_completed' and 'tutor_rating' in payload:
                # Update rolling average rating
                total_sessions = metrics['sessions_30d']
                current_avg = float(metrics.get('avg_rating', 0))
                new_rating = float(payload['tutor_rating'])
                metrics['avg_rating'] = to_decimal(
                    ((current_avg * (total_sessions - 1)) + new_rating) / total_sessions
                )

            metrics['last_updated'] = datetime.utcnow().isoformat()
            table.put_item(Item=metrics)

    elif event_type == 'ib_call_logged':
        student_id = payload.get('student_id')

        if student_id:
            metrics = get_metrics(student_id, 'student')
            metrics['ib_calls_7d'] = metrics.get('ib_calls_7d', 0) + 1
            metrics['ib_calls_14d'] = metrics.get('ib_calls_14d', 0) + 1
            metrics['last_updated'] = datetime.utcnow().isoformat()

            table.put_item(Item=metrics)

    elif event_type == 'customer_health_update':
        student_id = payload.get('student_id')

        if student_id and 'health_score' in payload:
            metrics = get_metrics(student_id, 'student')
            metrics['health_score'] = to_decimal(payload['health_score'])
            metrics['sessions_7d'] = payload.get('sessions_last_7_days', metrics.get('sessions_7d', 0))
            metrics['sessions_30d'] = payload.get('sessions_last_30_days', metrics.get('sessions_30d', 0))
            metrics['ib_calls_14d'] = payload.get('ib_calls_last_14_days', metrics.get('ib_calls_14d', 0))
            metrics['last_updated'] = datetime.utcnow().isoformat()

            table.put_item(Item=metrics)

    elif event_type == 'supply_demand_update':
        subject = payload.get('subject')
        region = payload.get('region')

        if subject:
            table.put_item(Item={
                'entity_id': subject,
                'entity_type': 'subject',
                'region': region,
                'available_tutors': payload.get('available_tutors', 0),
                'active_students': payload.get('active_students', 0),
                'demand_score': to_decimal(payload.get('demand_score', 0)),
                'supply_score': to_decimal(payload.get('supply_score', 0)),
                'balance_status': payload.get('balance_status', 'unknown'),
                'last_updated': datetime.utcnow().isoformat(),
            })

    else:
        print(f"No metric update for event type: {event_type}")

# Detect anomalies and trigger alerts
def detect_anomalies(event: IncomingEvent, metrics: Optional[Dict[str, Any]] = None) -> None:
    """Detect anomalies and send alerts to EventBridge"""
    alerts = []

    # Anomaly 1: High IB call frequency
    if metrics and metrics.get('ib_calls_14d', 0) >= 3 and metrics.get('entity_type') == 'student':
        alerts.append({
            'alert_type': 'high_ib_call_frequency',
            'severity': 'warning',
            'entity_id': metrics['entity_id'],
            'entity_type': metrics['entity_type'],
            'details': {
                'ib_calls_14d': int(metrics['ib_calls_14d']),
                'health_score': float(metrics.get('health_score', 100)),
            },
            'message': f"Student {metrics['entity_id']} has {metrics['ib_calls_14d']} IB calls in 14 days",
            'timestamp': datetime.utcnow().isoformat(),
        })

    # Anomaly 2: Low health score
    if metrics and float(metrics.get('health_score', 100)) < 70 and metrics.get('entity_type') == 'student':
        health_score = float(metrics['health_score'])
        alerts.append({
            'alert_type': 'low_health_score',
            'severity': 'critical' if health_score < 50 else 'warning',
            'entity_id': metrics['entity_id'],
            'entity_type': metrics['entity_type'],
            'details': {
                'health_score': health_score,
                'sessions_7d': int(metrics.get('sessions_7d', 0)),
                'ib_calls_14d': int(metrics.get('ib_calls_14d', 0)),
            },
            'message': f"Student {metrics['entity_id']} has low health score: {health_score}",
            'timestamp': datetime.utcnow().isoformat(),
        })

    # Anomaly 3: Supply/demand imbalance
    if event.event_type == 'supply_demand_update':
        balance_status = event.payload.get('balance_status')
        subject = event.payload.get('subject')
        demand_score = event.payload.get('demand_score', 0)
        supply_score = event.payload.get('supply_score', 0)

        if balance_status == 'high_demand':
            alerts.append({
                'alert_type': 'supply_demand_imbalance',
                'severity': 'info',
                'entity_id': subject,
                'entity_type': 'subject',
                'details': {
                    'balance_status': balance_status,
                    'demand_score': float(demand_score),
                    'supply_score': float(supply_score),
                },
                'message': f"High demand detected for {subject} (Demand: {demand_score}, Supply: {supply_score})",
                'timestamp': datetime.utcnow().isoformat(),
            })

    # Send alerts to EventBridge
    if alerts:
        entries = [
            {
                'Source': 'iops-dashboard.processor',
                'DetailType': alert['alert_type'],
                'Detail': json.dumps(alert),
                'EventBusName': EVENT_BUS_NAME,
            }
            for alert in alerts
        ]

        eventbridge.put_events(Entries=entries)
        print(f"Sent {len(alerts)} alerts to EventBridge")

# Main Lambda handler
def lambda_handler(event: Dict[str, Any], context: Any) -> None:
    """Process Kinesis stream records"""
    records = event.get('Records', [])
    print(f"Processing {len(records)} records from Kinesis")

    for record in records:
        incoming_event = decode_record(record)

        if not incoming_event:
            continue

        print(f"Processing event: {incoming_event.event_type}")

        try:
            # Update metrics
            update_metrics(incoming_event)

            # Get updated metrics for anomaly detection
            metrics = None
            if incoming_event.payload.get('student_id'):
                metrics = get_metrics(incoming_event.payload['student_id'], 'student')
            elif incoming_event.payload.get('tutor_id'):
                metrics = get_metrics(incoming_event.payload['tutor_id'], 'tutor')

            # Detect anomalies
            detect_anomalies(incoming_event, metrics)

        except Exception as error:
            print(f"Error processing event: {error}")
            # Continue processing other records even if one fails

    print('Batch processing complete')
```

### 2. Create Requirements File
**File:** `lambda/process/requirements.txt`

```
boto3==1.34.0
pandas==2.2.0
numpy==1.26.0
```

### 3. Add Processing Lambda to CDK

**IMPORTANT - Dependency Management:**
- ✅ CDK automatically bundles Python dependencies using Docker during `cdk deploy`
- ❌ **NEVER** run `pip install -r requirements.txt -t .` in Lambda directories
- ❌ **NEVER** commit package directories (boto3, pandas, numpy, etc.) to git
- ✅ Keep Lambda folders clean - only `handler.py` and `requirements.txt`
- ✅ For local testing, use virtual environments (see `docs/Lambda-Dependency-Management.md`)

CDK bundling configuration is already set up in the stack (see step 4 below).

### 4. Update CDK Stack Configuration
**File:** `cdk/lib/core-stack.ts` (update)

Add after simulator Lambda:
```typescript
// Create Processing Lambda (Python)
const processLambda = new lambda.Function(this, 'ProcessFunction', {
  runtime: lambda.Runtime.PYTHON_3_12,
  handler: 'handler.lambda_handler',
  code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/process'), {
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
    DYNAMODB_TABLE_NAME: this.metricsTable.tableName,
    EVENT_BUS_NAME: 'default', // Will use custom bus in PR-07
  },
  timeout: cdk.Duration.minutes(2),
  memorySize: 1024,
  description: 'Processes events from Kinesis and aggregates metrics (Python)',
});

// Add Kinesis event source
processLambda.addEventSource(
  new lambda.EventSourceMapping(this, 'ProcessKinesisMapping', {
    eventSourceArn: this.eventStream.streamArn,
    batchSize: 100,
    startingPosition: lambda.StartingPosition.LATEST,
    bisectBatchOnError: true,
    retryAttempts: 3,
  })
);

// Grant permissions
this.eventStream.grantRead(processLambda);

// Output function name
new cdk.CfnOutput(this, 'ProcessFunctionName', {
  value: processLambda.functionName,
  description: 'Name of processing Lambda function',
  exportName: 'IOpsDashboard-ProcessFunctionName',
});
```

Note: You'll need to add the EventSourceMapping import:
```typescript
import { EventSourceMapping } from 'aws-cdk-lib/aws-lambda';
```

### 5. Deploy Stack
```bash
cd cdk
npm run build
cdk deploy CdkStack
```

## Verification Steps

### 1. Check Lambda is Receiving Events
```bash
# Get function name
FUNCTION_NAME=$(aws cloudformation describe-stacks \
  --stack-name CdkStack \
  --query 'Stacks[0].Outputs[?OutputKey==`ProcessFunctionName`].OutputValue' \
  --output text)

# Watch logs in real-time
aws logs tail /aws/lambda/$FUNCTION_NAME --follow
```

### 2. Generate Test Events
Run the simulator manually to generate events:
```bash
SIM_FUNCTION=$(aws cloudformation describe-stacks \
  --stack-name CdkStack \
  --query 'Stacks[0].Outputs[?OutputKey==`SimulatorFunctionName`].OutputValue' \
  --output text)

aws lambda invoke --function-name $SIM_FUNCTION --payload '{}' response.json
```

### 3. Check CloudWatch Metrics
```bash
# Check Lambda invocations
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Invocations \
  --dimensions Name=FunctionName,Value=$FUNCTION_NAME \
  --start-time $(date -u -d '10 minutes ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum

# Check errors
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Errors \
  --dimensions Name=FunctionName,Value=$FUNCTION_NAME \
  --start-time $(date -u -d '10 minutes ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum
```

### 4. Verify Event Source Mapping
```bash
# List event source mappings
aws lambda list-event-source-mappings \
  --function-name $FUNCTION_NAME

# Should show Enabled: true and State: Enabled
```

## Expected Log Output

You should see logs like:
```
Processing 100 records from Kinesis
Processing event: session_started
Processing event: ib_call_logged
Sent 2 alerts to EventBridge
Batch processing complete
```

## Troubleshooting

### Issue: DynamoDB Table Not Found
**Expected:** This PR doesn't create the DynamoDB table yet. Either:
1. Implement PR-08 first, or
2. Comment out DynamoDB operations temporarily for testing

### Issue: No Events Being Processed
**Check:**
```bash
# Verify event source mapping is enabled
aws lambda get-event-source-mapping --uuid <UUID-from-list-command>

# Check Kinesis stream has data
aws kinesis describe-stream-summary --stream-name iops-dashboard-events
```

### Issue: Lambda Timeout
**Solution:** Increase timeout or reduce batch size:
```typescript
timeout: cdk.Duration.minutes(5),
// and/or
batchSize: 50,
```

### Issue: Permission Errors
**Solution:** Add explicit grants in CDK:
```typescript
this.eventStream.grantRead(processLambda);
// If using DynamoDB:
// metricsTable.grantReadWriteData(processLambda);
```

## Files Created
- `lambda/process/handler.py`
- `lambda/process/requirements.txt`
- `cdk/lib/core-stack.ts` (updated)

## Next Steps
- PR-08: DynamoDB Schema (create the metrics table)
- PR-07: EventBridge Rules (set up custom event bus for alerts)
- PR-05: AI Inference Lambda (will receive alerts from EventBridge)

## Estimated Time
- 60-90 minutes

## Skills Required
- Python
- Kinesis stream processing
- Data aggregation with pandas/numpy
- DynamoDB concepts

## References
- [Lambda Kinesis Trigger](https://docs.aws.amazon.com/lambda/latest/dg/with-kinesis.html)
- [DynamoDB Document Client](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/dynamodb-example-document-client.html)
- [EventBridge PutEvents](https://docs.aws.amazon.com/eventbridge/latest/APIReference/API_PutEvents.html)
