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
