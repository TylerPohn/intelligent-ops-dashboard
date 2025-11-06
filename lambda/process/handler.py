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
        self.entity_type = entity_type
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
                total_sessions = int(metrics['sessions_30d'])  # Convert Decimal to int
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
