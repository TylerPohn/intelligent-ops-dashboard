# Feature Engineering Specification

## Overview
Transform raw event streams into ML-ready feature vectors for SageMaker multi-task model.

## Pipeline Architecture

```
Kinesis Stream → Lambda Aggregator → DynamoDB (State Store) → SageMaker Endpoint
```

## Feature Categories

### 1. Time-Window Aggregations (Rolling Windows)

**Windows:** 7d, 14d, 30d

For each window, compute:
```python
features = {
    # Session metrics
    "session_count_{window}": count(sessions),
    "session_frequency_{window}": count(sessions) / days(window),
    "avg_session_rating_{window}": mean(session_ratings),
    "session_completion_rate_{window}": completed / scheduled,
    "cancellation_rate_{window}": cancelled / total,
    "no_show_rate_{window}": no_shows / total,
    "avg_session_duration_{window}": mean(duration_minutes),

    # Call center metrics
    "ib_call_count_{window}": count(inbound_calls),
    "avg_call_duration_{window}": mean(call_duration),
    "negative_sentiment_calls_{window}": count(sentiment < -0.3),
    "escalation_count_{window}": count(escalations),

    # Engagement metrics
    "login_count_{window}": count(logins),
    "message_count_{window}": count(messages),
    "days_active_{window}": count_distinct(dates_with_activity),

    # Payment metrics
    "payment_success_rate_{window}": successful_payments / attempts,
    "payment_amount_{window}": sum(payment_amounts),
}
```

### 2. Recency Features (Critical for Churn)

```python
recency_features = {
    "days_since_last_session": days_diff(now, last_session_date),
    "days_since_last_login": days_diff(now, last_login_date),
    "days_since_last_payment": days_diff(now, last_payment_date),
    "days_since_last_ib_call": days_diff(now, last_call_date),
    "days_since_signup": days_diff(now, signup_date),
}
```

### 3. Customer Lifetime Features

```python
lifetime_features = {
    "total_sessions_lifetime": count(all_sessions),
    "total_spend_lifetime": sum(all_payments),
    "customer_tenure_days": days_since_signup,
    "subscription_tier": encode(tier),  # budget=0, standard=1, premium=2
    "first_session_was_success": bool(first_session_rating > 4.0),
    "referral_count": count(referrals_made),
    "avg_lifetime_rating": mean(all_ratings),
}
```

### 4. Tutor Consistency Features

```python
tutor_features = {
    "primary_tutor_rating": most_frequent_tutor.avg_rating,
    "tutor_consistency_score": sessions_with_primary / total_sessions,
    "tutor_switch_count_30d": count_distinct(tutors_last_30d),
    "avg_tutor_response_time": mean(tutor_response_times),
    "tutor_cancellation_rate": tutor_cancelled / tutor_scheduled,
}
```

### 5. Supply/Demand Features (Per Subject)

```python
supply_demand = {
    # Per subject: ["algebra", "chemistry", "physics", ...]
    f"supply_demand_ratio_{subject}": available_tutors / pending_requests,
    f"avg_match_time_{subject}": mean(time_to_match_minutes),
    f"utilization_rate_{subject}": booked_hours / available_hours,
    f"tutor_count_{subject}": count_distinct(active_tutors),
}
```

### 6. Cohort/Segment Features

```python
segment_features = {
    "acquisition_channel": encode(channel),  # organic, paid, referral
    "student_grade_level": encode(grade),  # K12 = 1-12, college = 13
    "primary_subject_category": encode(subject_category),  # STEM, humanities, test_prep
    "geographic_region": encode(region),
}
```

### 7. Trend Features (Velocity/Acceleration)

```python
trend_features = {
    # Comparing windows to detect changes
    "session_velocity_change": (sessions_7d / 7) - (sessions_30d / 30),
    "rating_trend": avg_rating_7d - avg_rating_30d,
    "engagement_trend": logins_7d - logins_14d,
    "spend_acceleration": (spend_7d / 7) - (spend_30d / 30),
}
```

## Implementation: Lambda Aggregator

```python
import json
import boto3
from datetime import datetime, timedelta
from collections import defaultdict

dynamodb = boto3.resource('dynamodb')
state_table = dynamodb.Table('customer-feature-state')

def lambda_handler(event, context):
    """
    Aggregates raw Kinesis events into ML features.
    Maintains rolling window state in DynamoDB.
    """
    for record in event['Records']:
        # Decode Kinesis record
        payload = json.loads(base64.b64decode(record['kinesis']['data']))

        event_type = payload['event_type']
        customer_id = payload.get('customer_id')
        timestamp = datetime.fromisoformat(payload['timestamp'])

        # Update rolling windows in DynamoDB
        update_feature_state(customer_id, event_type, payload, timestamp)

        # Check if we should trigger inference
        if should_run_inference(customer_id, event_type):
            features = compute_features(customer_id)
            predictions = invoke_sagemaker(features)
            check_alert_thresholds(customer_id, predictions)

    return {'statusCode': 200}

def update_feature_state(customer_id, event_type, payload, timestamp):
    """Update rolling window aggregations in DynamoDB."""
    response = state_table.get_item(Key={'customer_id': customer_id})
    state = response.get('Item', initialize_state(customer_id))

    # Append event to time-series buffers
    if event_type == 'session_completed':
        state['sessions'].append({
            'timestamp': timestamp.isoformat(),
            'rating': payload.get('student_rating'),
            'duration': payload.get('duration_minutes'),
            'tutor_id': payload.get('tutor_id'),
            'status': payload.get('status')
        })

    elif event_type == 'inbound_call':
        state['ib_calls'].append({
            'timestamp': timestamp.isoformat(),
            'duration': payload.get('duration_seconds'),
            'sentiment': payload.get('sentiment_score'),
            'category': payload.get('issue_category')
        })

    # Prune events older than 30 days
    cutoff = (datetime.now() - timedelta(days=30)).isoformat()
    state['sessions'] = [s for s in state['sessions'] if s['timestamp'] > cutoff]
    state['ib_calls'] = [c for c in state['ib_calls'] if c['timestamp'] > cutoff]

    # Save updated state
    state_table.put_item(Item=state)

def compute_features(customer_id):
    """Extract feature vector from customer state."""
    response = state_table.get_item(Key={'customer_id': customer_id})
    state = response['Item']

    now = datetime.now()
    features = {}

    # Time windows
    for window_days in [7, 14, 30]:
        cutoff = (now - timedelta(days=window_days)).isoformat()

        # Session features
        sessions_in_window = [s for s in state['sessions'] if s['timestamp'] > cutoff]
        features[f'session_count_{window_days}d'] = len(sessions_in_window)
        features[f'session_frequency_{window_days}d'] = len(sessions_in_window) / window_days
        features[f'avg_rating_{window_days}d'] = (
            sum(s['rating'] for s in sessions_in_window) / len(sessions_in_window)
            if sessions_in_window else 0
        )

        # Call features
        calls_in_window = [c for c in state['ib_calls'] if c['timestamp'] > cutoff]
        features[f'ib_call_count_{window_days}d'] = len(calls_in_window)
        features[f'negative_calls_{window_days}d'] = sum(
            1 for c in calls_in_window if c['sentiment'] < -0.3
        )

    # Recency features
    last_session = max(state['sessions'], key=lambda s: s['timestamp']) if state['sessions'] else None
    features['days_since_last_session'] = (
        (now - datetime.fromisoformat(last_session['timestamp'])).days
        if last_session else 999
    )

    # Tutor consistency
    if state['sessions']:
        tutor_counts = defaultdict(int)
        for s in state['sessions'][-20:]:  # Last 20 sessions
            tutor_counts[s['tutor_id']] += 1
        primary_tutor = max(tutor_counts.items(), key=lambda x: x[1])
        features['tutor_consistency'] = primary_tutor[1] / len(state['sessions'][-20:])

    return features

def should_run_inference(customer_id, event_type):
    """Determine if we should run inference based on event type."""
    # Run inference on high-signal events
    trigger_events = [
        'session_completed',
        'inbound_call',
        'payment_failed',
        'subscription_cancelled',
        'booking_request'
    ]
    return event_type in trigger_events

def invoke_sagemaker(features):
    """Call SageMaker endpoint for predictions."""
    runtime = boto3.client('sagemaker-runtime')

    response = runtime.invoke_endpoint(
        EndpointName='marketplace-health-model',
        ContentType='application/json',
        Body=json.dumps({'features': features})
    )

    return json.loads(response['Body'].read())

def check_alert_thresholds(customer_id, predictions):
    """Check if predictions cross alert thresholds."""
    alerts = []

    # IB call spike alert
    if predictions['ib_call_risk_14d'] > 0.7:
        alerts.append({
            'type': 'churn_risk_ib_calls',
            'severity': 'critical',
            'customer_id': customer_id,
            'details': 'High likelihood of ≥2 IB calls in 14 days'
        })

    # Churn prediction alert
    if predictions['churn_risk_30d'] > 0.6:
        alerts.append({
            'type': 'churn_risk_high',
            'severity': 'high',
            'customer_id': customer_id,
            'churn_probability': predictions['churn_risk_30d']
        })

    # Customer health score alert
    if predictions['customer_health_score'] < 40:
        alerts.append({
            'type': 'health_score_critical',
            'severity': 'high',
            'customer_id': customer_id,
            'score': predictions['customer_health_score']
        })

    # Publish alerts to SNS
    if alerts:
        publish_alerts(alerts)

def publish_alerts(alerts):
    """Publish alerts to SNS topic."""
    sns = boto3.client('sns')
    for alert in alerts:
        sns.publish(
            TopicArn='arn:aws:sns:us-east-1:123456789:marketplace-alerts',
            Subject=f"🚨 {alert['type'].upper()}",
            Message=json.dumps(alert, indent=2)
        )
```

## DynamoDB State Schema

```json
{
  "customer_id": "cust_789ghi",
  "sessions": [
    {
      "timestamp": "2025-01-06T14:30:00Z",
      "rating": 4.5,
      "duration": 45,
      "tutor_id": "tutor_xyz",
      "status": "completed"
    }
  ],
  "ib_calls": [
    {
      "timestamp": "2025-01-05T10:00:00Z",
      "duration": 420,
      "sentiment": -0.65,
      "category": "tutor_complaint"
    }
  ],
  "payments": [...],
  "logins": [...],
  "last_inference_time": "2025-01-06T14:35:00Z",
  "ttl": 1739000000  // Auto-delete after 30 days
}
```

## Feature Vector Size

**Total features:** ~150
- Time-window aggregations: 10 features × 3 windows = 30
- Recency features: 5
- Lifetime features: 10
- Tutor features: 5
- Supply/demand: 20 subjects × 3 metrics = 60
- Segment features: 15
- Trend features: 10
- One-hot encoded categoricals: 25

## Next Steps

1. Implement Lambda aggregator with DynamoDB state management
2. Generate synthetic training data for SageMaker model
3. Train multi-task model with shared base network
4. Deploy SageMaker endpoint with auto-scaling
5. Implement alert routing logic with SNS
