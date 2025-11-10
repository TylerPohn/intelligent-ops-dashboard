import json
import os
import boto3
import numpy as np
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Dict, List, Any, Optional

# Initialize AWS clients
sagemaker_runtime = boto3.client('sagemaker-runtime', region_name='us-east-2')
dynamodb = boto3.resource('dynamodb', region_name=os.environ.get('AWS_REGION', 'us-east-2'))
cloudwatch = boto3.client('cloudwatch', region_name=os.environ.get('AWS_REGION', 'us-east-2'))

# Configuration
TABLE_NAME = os.environ['DYNAMODB_TABLE_NAME']
ENDPOINT_NAME = os.environ.get('SAGEMAKER_ENDPOINT_NAME', 'marketplace-health-endpoint')
MODEL_VERSION = os.environ.get('MODEL_VERSION', 'marketplace-health-v1')
BATCH_SIZE = int(os.environ.get('BATCH_SIZE', '100'))

table = dynamodb.Table(TABLE_NAME)

def engineer_tutor_features(metrics: Dict[str, Any]) -> np.ndarray:
    """
    Engineer 46 tutor-specific features for SageMaker endpoint

    Feature Groups:
    - Session Performance (13): taught counts, completion rates, gaps
    - Student Satisfaction (8): ratings, reviews, retention
    - Availability & Capacity (6): hours, utilization, response time
    - Subject Expertise (10): diversity, certifications, match accuracy
    - Financial & Business (9): earnings, pricing, revenue
    """
    features = []

    # Session Performance (13 features)
    sessions_taught_7d = float(metrics.get('sessions_taught_7d', 0))
    sessions_taught_14d = float(metrics.get('sessions_taught_14d', 0))
    sessions_taught_30d = float(metrics.get('sessions_taught_30d', 0))
    sessions_completed_7d = float(metrics.get('sessions_completed_7d', 0))
    sessions_completed_14d = float(metrics.get('sessions_completed_14d', 0))
    sessions_completed_30d = float(metrics.get('sessions_completed_30d', 0))
    avg_session_duration_min = float(metrics.get('avg_session_duration_min', 60))
    session_completion_rate = float(metrics.get('session_completion_rate', 0.95))
    no_show_rate = float(metrics.get('no_show_rate', 0))
    cancellation_rate = float(metrics.get('cancellation_rate', 0))
    days_since_last_session = float(metrics.get('days_since_last_session', 7))
    session_frequency_7d = sessions_taught_7d / 7.0
    session_frequency_14d = sessions_taught_14d / 14.0
    features.extend([
        sessions_taught_7d, sessions_taught_14d, sessions_taught_30d,
        sessions_completed_7d, sessions_completed_14d, sessions_completed_30d,
        avg_session_duration_min, session_completion_rate,
        no_show_rate, cancellation_rate, days_since_last_session,
        session_frequency_7d, session_frequency_14d
    ])

    # Student Satisfaction (8 features)
    avg_rating = float(metrics.get('avg_rating', 4.5))
    rating_trend = float(metrics.get('rating_trend', 0))
    rating_volatility = float(metrics.get('rating_volatility', 0))
    positive_reviews_30d = float(metrics.get('positive_reviews_count_30d', 0))
    negative_reviews_30d = float(metrics.get('negative_reviews_count_30d', 0))
    student_retention_rate = float(metrics.get('student_retention_rate', 0.7))
    unique_students_30d = float(metrics.get('unique_students_30d', 10))
    avg_student_lifetime_sessions = float(metrics.get('avg_student_lifetime_sessions', 5))
    features.extend([
        avg_rating, rating_trend, rating_volatility,
        positive_reviews_30d, negative_reviews_30d, student_retention_rate,
        unique_students_30d, avg_student_lifetime_sessions
    ])

    # Availability & Capacity (6 features)
    available_hours_this_week = float(metrics.get('available_hours_this_week', 20))
    available_hours_next_week = float(metrics.get('available_hours_next_week', 20))
    utilization_rate = float(metrics.get('utilization_rate', 0.6))
    instant_book_enabled = float(metrics.get('instant_book_enabled', 1))
    avg_response_time_hours = float(metrics.get('avg_response_time_hours', 2))
    booking_lead_time_avg_hours = float(metrics.get('booking_lead_time_avg_hours', 48))
    features.extend([
        available_hours_this_week, available_hours_next_week, utilization_rate,
        instant_book_enabled, avg_response_time_hours, booking_lead_time_avg_hours
    ])

    # Subject Expertise (10 features)
    primary_subject_count = float(metrics.get('primary_subject_count', 1))
    subject_diversity_score = float(metrics.get('subject_diversity_score', 0.5))
    avg_rating_by_subject = float(metrics.get('avg_rating_by_subject', 4.5))
    sessions_per_subject_30d = float(metrics.get('sessions_per_subject_30d', 10))
    subject_match_accuracy = float(metrics.get('subject_match_accuracy', 0.8))
    certification_count = float(metrics.get('certification_count', 2))
    years_of_experience = float(metrics.get('years_of_experience', 3))
    specialization_score = float(metrics.get('specialization_score', 0.7))
    advanced_topics_count = float(metrics.get('advanced_topics_count', 1))
    student_grade_improvement_avg = float(metrics.get('student_grade_improvement_avg', 10))
    features.extend([
        primary_subject_count, subject_diversity_score, avg_rating_by_subject,
        sessions_per_subject_30d, subject_match_accuracy, certification_count,
        years_of_experience, specialization_score, advanced_topics_count,
        student_grade_improvement_avg
    ])

    # Financial & Business (9 features)
    total_earnings_30d = float(metrics.get('total_earnings_30d', 1000))
    avg_earnings_per_session = float(metrics.get('avg_earnings_per_session', 50))
    earnings_trend = float(metrics.get('earnings_trend', 0))
    premium_tier_sessions_ratio = float(metrics.get('premium_tier_sessions_ratio', 0.3))
    discount_sessions_ratio = float(metrics.get('discount_sessions_ratio', 0.1))
    payment_disputes_30d = float(metrics.get('payment_disputes_count_30d', 0))
    refund_rate_30d = float(metrics.get('refund_rate_30d', 0))
    pricing_competitiveness_score = float(metrics.get('pricing_competitiveness_score', 0.75))
    revenue_per_available_hour = float(metrics.get('revenue_per_available_hour', 25))
    features.extend([
        total_earnings_30d, avg_earnings_per_session, earnings_trend,
        premium_tier_sessions_ratio, discount_sessions_ratio, payment_disputes_30d,
        refund_rate_30d, pricing_competitiveness_score, revenue_per_available_hour
    ])

    return np.array(features, dtype=np.float32)

def engineer_features(metrics: Dict[str, Any], entity_type: str = 'student') -> np.ndarray:
    """
    Engineer 46 features for TensorFlow multi-task model

    Supports both student and tutor entities with appropriate feature engineering.

    Feature Groups:
    - Session features (13): counts, frequencies, gaps
    - Engagement features (8): ratings, consistency, velocity
    - Financial features (6): payment success, transaction patterns
    - Behavioral features (10): cancellations, IB calls, responsiveness
    - Tutor features (9): consistency, availability, performance
    """
    if entity_type == 'tutor':
        return engineer_tutor_features(metrics)

    features = []

    # Session counts (3 features)
    sessions_7d = float(metrics.get('sessions_7d', 0))
    sessions_14d = float(metrics.get('sessions_14d', 0))
    sessions_30d = float(metrics.get('sessions_30d', 0))
    features.extend([sessions_7d, sessions_14d, sessions_30d])

    # Session frequencies (3 features)
    session_freq_7d = sessions_7d / 7.0
    session_freq_14d = sessions_14d / 14.0
    session_freq_30d = sessions_30d / 30.0
    features.extend([session_freq_7d, session_freq_14d, session_freq_30d])

    # Session gaps and trends (7 features)
    days_since_last = float(metrics.get('days_since_last_session', 30))
    avg_gap_between_sessions = (30.0 / sessions_30d) if sessions_30d > 0 else 30.0
    session_trend_7d_14d = sessions_7d - (sessions_14d - sessions_7d) if sessions_14d > sessions_7d else 0
    session_trend_14d_30d = sessions_14d - (sessions_30d - sessions_14d) if sessions_30d > sessions_14d else 0
    session_acceleration = session_trend_7d_14d - session_trend_14d_30d
    sessions_weekend_ratio = float(metrics.get('sessions_weekend_ratio', 0.3))
    sessions_evening_ratio = float(metrics.get('sessions_evening_ratio', 0.5))
    features.extend([
        days_since_last,
        avg_gap_between_sessions,
        session_trend_7d_14d,
        session_trend_14d_30d,
        session_acceleration,
        sessions_weekend_ratio,
        sessions_evening_ratio
    ])

    # Engagement features (8 features)
    avg_rating = float(metrics.get('avg_rating', 0))
    rating_trend = float(metrics.get('rating_trend', 0))
    rating_volatility = float(metrics.get('rating_volatility', 0))
    avg_session_duration_min = float(metrics.get('avg_session_duration_min', 60))
    total_session_hours = float(metrics.get('total_session_hours_30d', 0))
    engagement_score = float(metrics.get('engagement_score', 50))
    questions_asked_30d = float(metrics.get('questions_asked_30d', 0))
    materials_accessed_30d = float(metrics.get('materials_accessed_30d', 0))
    features.extend([
        avg_rating,
        rating_trend,
        rating_volatility,
        avg_session_duration_min,
        total_session_hours,
        engagement_score,
        questions_asked_30d,
        materials_accessed_30d
    ])

    # Financial features (6 features)
    payment_success_rate = float(metrics.get('payment_success_rate_30d', 1.0))
    payment_failures_30d = float(metrics.get('payment_failures_30d', 0))
    avg_transaction_value = float(metrics.get('avg_transaction_value', 50))
    total_revenue_30d = float(metrics.get('total_revenue_30d', 0))
    payment_method_count = float(metrics.get('payment_method_count', 1))
    days_since_last_payment = float(metrics.get('days_since_last_payment', 7))
    features.extend([
        payment_success_rate,
        payment_failures_30d,
        avg_transaction_value,
        total_revenue_30d,
        payment_method_count,
        days_since_last_payment
    ])

    # Behavioral features (10 features)
    ib_calls_7d = float(metrics.get('ib_calls_7d', 0))
    ib_calls_14d = float(metrics.get('ib_calls_14d', 0))
    ib_call_rate = ib_calls_14d / 14.0
    cancellation_rate_7d = float(metrics.get('cancellation_rate_7d', 0))
    cancellation_rate_30d = float(metrics.get('cancellation_rate_30d', 0))
    no_show_rate_30d = float(metrics.get('no_show_rate_30d', 0))
    late_cancellations_30d = float(metrics.get('late_cancellations_30d', 0))
    response_time_hours = float(metrics.get('avg_response_time_hours', 24))
    support_tickets_30d = float(metrics.get('support_tickets_30d', 0))
    complaints_30d = float(metrics.get('complaints_30d', 0))
    features.extend([
        ib_calls_7d,
        ib_calls_14d,
        ib_call_rate,
        cancellation_rate_7d,
        cancellation_rate_30d,
        no_show_rate_30d,
        late_cancellations_30d,
        response_time_hours,
        support_tickets_30d,
        complaints_30d
    ])

    # Tutor features (9 features)
    tutor_consistency_score = float(metrics.get('tutor_consistency_score', 0.5))
    unique_tutors_30d = float(metrics.get('unique_tutors_30d', 1))
    preferred_tutor_ratio = float(metrics.get('preferred_tutor_ratio', 0.7))
    tutor_rating_avg = float(metrics.get('tutor_rating_avg', 4.0))
    tutor_availability_score = float(metrics.get('tutor_availability_score', 0.8))
    tutor_subject_expertise = float(metrics.get('tutor_subject_expertise_score', 0.7))
    tutor_match_score = float(metrics.get('tutor_match_score', 0.75))
    tutor_changed_count_30d = float(metrics.get('tutor_changed_count_30d', 0))
    preferred_tutor_sessions_ratio = float(metrics.get('preferred_tutor_sessions_ratio', 0.8))
    features.extend([
        tutor_consistency_score,
        unique_tutors_30d,
        preferred_tutor_ratio,
        tutor_rating_avg,
        tutor_availability_score,
        tutor_subject_expertise,
        tutor_match_score,
        tutor_changed_count_30d,
        preferred_tutor_sessions_ratio
    ])

    return np.array(features, dtype=np.float32)

def invoke_sagemaker(features: np.ndarray) -> Dict[str, float]:
    """
    Invoke TensorFlow multi-task model on SageMaker endpoint

    Returns:
        Dictionary with 5 predictions:
        - first_session_success: probability (0-1)
        - session_velocity: sessions per week
        - churn_risk_14d: probability (0-1)
        - churn_risk_30d: probability (0-1)
        - health_score: 0-100
    """
    try:
        # Convert features to CSV format (TensorFlow endpoint expects CSV)
        payload = ','.join(map(str, features))

        response = sagemaker_runtime.invoke_endpoint(
            EndpointName=ENDPOINT_NAME,
            ContentType='text/csv',
            Body=payload
        )

        # Parse TensorFlow response
        result = json.loads(response['Body'].read().decode())
        predictions = result['predictions'][0]  # TensorFlow format: {"predictions": [{...}]}

        # Handle both array and dict response formats
        if isinstance(predictions, dict):
            # Dict format: {"health_score": [value], "session_velocity": [value], ...}
            return {
                'first_session_success': float(predictions['first_session_success'][0]),
                'session_velocity': float(predictions['session_velocity'][0]),
                'churn_risk_14d': float(predictions['churn_risk_14d'][0]),
                'churn_risk_30d': float(predictions['churn_risk_30d'][0]),
                'health_score': float(predictions['health_score'][0]),
            }
        else:
            # Array format: [val1, val2, val3, val4, val5]
            return {
                'first_session_success': float(predictions[0]),
                'session_velocity': float(predictions[1]),
                'churn_risk_14d': float(predictions[2]),
                'churn_risk_30d': float(predictions[3]),
                'health_score': float(predictions[4]),
            }

    except Exception as e:
        print(f"Error invoking SageMaker: {e}")
        # Return conservative defaults on error
        return {
            'first_session_success': 0.5,
            'session_velocity': 0.0,
            'churn_risk_14d': 0.5,
            'churn_risk_30d': 0.5,
            'health_score': 50.0,
        }

def classify_segment(predictions: Dict[str, float], entity_type: str = 'student') -> str:
    """
    Classify entity segment based on ML predictions

    Student Segments:
    - thriving: Low churn risk (<20%), high health (>80)
    - healthy: Moderate churn (<40%), good health (>60)
    - at_risk: High churn (40-70%), declining health (40-60)
    - churned: Very high churn (>70%) or very low health (<40)

    Tutor Segments (burnout_risk instead of churn_risk):
    - star: Low burnout (<20%), high health (>80), high availability
    - healthy: Moderate burnout (<40%), good health (>60)
    - at_risk: High burnout (40-70%), declining health (40-60)
    - churning: Very high burnout (>70%) or very low health (<40)
    """
    if entity_type == 'tutor':
        burnout = predictions.get('churn_risk_14d', 0)  # Reinterpreted as burnout_risk for tutors
        health = predictions['health_score']

        if burnout > 0.7 or health < 40:
            return 'churning'
        elif burnout > 0.4 or health < 60:
            return 'at_risk'
        elif burnout < 0.2 and health > 80:
            return 'star'
        else:
            return 'healthy'

    # Student classification (existing logic)
    churn_14d = predictions['churn_risk_14d']
    churn_30d = predictions['churn_risk_30d']
    health = predictions['health_score']

    if churn_14d > 0.7 or health < 40:
        return 'churned'
    elif churn_14d > 0.4 or churn_30d > 0.6 or health < 60:
        return 'at_risk'
    elif churn_14d < 0.2 and health > 80:
        return 'thriving'
    else:
        return 'healthy'

def generate_recommendations(metrics: Dict[str, Any], predictions: Dict[str, float], segment: str, entity_type: str = 'student') -> List[str]:
    """Generate actionable recommendations based on predictions and metrics"""
    recommendations = []

    if entity_type == 'tutor':
        # Tutor-specific recommendations
        burnout_risk = predictions.get('churn_risk_14d', 0)  # Reinterpreted as burnout for tutors

        if burnout_risk > 0.6:
            recommendations.append("⚠️ HIGH BURNOUT RISK: Schedule wellness check-in within 48 hours")

        if float(metrics.get('utilization_rate', 0)) > 0.9:
            recommendations.append("High utilization - suggest reducing hours or adding breaks")

        if float(metrics.get('avg_rating', 5.0)) < 4.0:
            recommendations.append("Low ratings detected - provide coaching or additional training")

        if predictions['session_velocity'] < 0.5:
            recommendations.append("Low booking rate - increase visibility or marketing support")

        if float(metrics.get('student_retention_rate', 1.0)) < 0.5:
            recommendations.append("Low student retention - review teaching style and student feedback")

        if segment == 'star':
            recommendations.append("✅ Star tutor - consider featuring in marketplace or bonus incentives")

        return recommendations[:5]

    # Student recommendations (existing logic)
    if predictions['churn_risk_14d'] > 0.6:
        recommendations.append("⚠️ HIGH CHURN RISK: Schedule proactive check-in call within 48 hours")

        if float(metrics.get('sessions_7d', 0)) == 0:
            recommendations.append("No sessions in 7 days - send re-engagement campaign")

        if float(metrics.get('ib_calls_14d', 0)) >= 2:
            recommendations.append("Multiple IB calls detected - assign dedicated account manager")

    if predictions['session_velocity'] < 0.5 and segment != 'churned':
        recommendations.append("Low session frequency - offer scheduling assistance or flexible hours")

    if float(metrics.get('payment_success_rate_30d', 1.0)) < 0.9:
        recommendations.append("Payment failures detected - update billing information")

    if float(metrics.get('tutor_consistency_score', 1.0)) < 0.5:
        recommendations.append("Low tutor consistency - assign preferred tutor for better match")

    if predictions['first_session_success'] < 0.5:
        recommendations.append("Low first session success probability - provide onboarding support")

    if segment == 'thriving':
        recommendations.append("✅ Thriving customer - consider upsell or referral program")

    return recommendations[:5]

def create_insights_from_predictions(
    entity_id: str,
    predictions: Dict[str, float],
    segment: str,
    recommendations: List[str],
    metrics: Dict[str, Any]
) -> None:
    """
    Create insight records in DynamoDB from SageMaker predictions.
    Generates 3-6 insight types based on prediction thresholds.
    """
    import random
    import time

    # Generate base timestamp for TTL calculation
    base_timestamp = datetime.utcnow()
    ttl = int((base_timestamp + timedelta(days=30)).timestamp())

    insights_to_create = []

    # 1. Churn Risk Insight - if 14d or 30d risk > 30%
    max_churn = max(predictions['churn_risk_14d'], predictions['churn_risk_30d'])
    if max_churn > 0.3:
        risk_score = int(max_churn * 100)
        explanation = f"Student shows {risk_score}% churn probability. "
        if predictions['churn_risk_14d'] > 0.5:
            explanation += "High risk of churning within 14 days. "
        elif predictions['churn_risk_30d'] > 0.5:
            explanation += "Elevated risk of churning within 30 days. "
        explanation += f"Session velocity: {predictions['session_velocity']:.2f}/week, Health score: {predictions['health_score']:.0f}/100."

        insights_to_create.append({
            'prediction_type': 'churn_risk',
            'risk_score': risk_score,
            'explanation': explanation,
            'confidence': 0.85
        })

    # 2. Customer Health Insight - if health score < 70
    if predictions['health_score'] < 70:
        risk_score = int(100 - predictions['health_score'])
        explanation = f"Overall health score of {predictions['health_score']:.0f}/100 indicates {segment} status. "
        explanation += f"Session frequency: {predictions['session_velocity']:.2f}/week. "
        if metrics.get('avg_rating', 0) < 4.0:
            explanation += "Low satisfaction ratings detected. "

        insights_to_create.append({
            'prediction_type': 'customer_health',
            'risk_score': risk_score,
            'explanation': explanation,
            'confidence': 0.88
        })

    # 3. Session Quality Insight - if session velocity < 0.5/week
    if predictions['session_velocity'] < 0.5:
        risk_score = int((0.5 - predictions['session_velocity']) * 200)  # Scale to 0-100
        risk_score = min(risk_score, 100)
        explanation = f"Low session booking rate of {predictions['session_velocity']:.2f} sessions/week. "
        days_since = metrics.get('days_since_last_session', 0)
        explanation += f"Last session {days_since:.0f} days ago. "

        insights_to_create.append({
            'prediction_type': 'session_quality',
            'risk_score': risk_score,
            'explanation': explanation,
            'confidence': 0.82
        })

    # 4. First Session Success Insight - if probability < 60%
    if predictions['first_session_success'] < 0.6:
        risk_score = int((1 - predictions['first_session_success']) * 100)
        explanation = f"First session success probability: {predictions['first_session_success']:.0%}. "
        explanation += "Student may need additional onboarding support or tutor matching optimization."

        insights_to_create.append({
            'prediction_type': 'first_session_success',
            'risk_score': risk_score,
            'explanation': explanation,
            'confidence': 0.79
        })

    # 5. Tutor Capacity Insight - always generate for capacity planning
    capacity_score = int(predictions['session_velocity'] * 20)  # Scale velocity to capacity metric
    capacity_score = min(capacity_score, 100)
    explanation = f"Current session velocity: {predictions['session_velocity']:.2f}/week. "
    if predictions['session_velocity'] > 2.0:
        explanation += "High engagement - ensure tutor availability matches demand."
    elif predictions['session_velocity'] < 0.5:
        explanation += "Low engagement - may need tutor outreach or scheduling flexibility."
    else:
        explanation += "Moderate engagement - monitor for changes."

    insights_to_create.append({
        'prediction_type': 'tutor_capacity',
        'risk_score': 100 - capacity_score,  # Invert so high velocity = low risk
        'explanation': explanation,
        'confidence': 0.75
    })

    # 6. Marketplace Balance - aggregate student patterns
    balance_score = int(predictions['health_score'])
    explanation = f"Student health: {predictions['health_score']:.0f}/100, Segment: {segment}. "
    explanation += f"Churn risk: {max_churn:.0%}, Session velocity: {predictions['session_velocity']:.2f}/week."

    insights_to_create.append({
        'prediction_type': 'marketplace_balance',
        'risk_score': 100 - balance_score,
        'explanation': explanation,
        'confidence': 0.80
    })

    # Write all insights to DynamoDB
    for idx, insight_data in enumerate(insights_to_create):
        # Generate unique timestamp for each insight (spread across 1 second)
        insight_timestamp = base_timestamp + timedelta(microseconds=idx * 100000)
        timestamp_iso = insight_timestamp.isoformat()

        # Generate unique insight ID
        random_suffix = ''.join(random.choices('0123456789abcdef', k=8))
        insight_id = f"insight_{int(time.time() * 1000)}_{random_suffix}"

        # Convert recommendations list to DynamoDB format
        recs_list = [{'S': rec} for rec in recommendations[:3]]  # Limit to 3 recommendations

        try:
            # Use low-level client for explicit attribute types
            dynamodb_client = boto3.client('dynamodb', region_name=os.environ.get('AWS_REGION', 'us-east-2'))

            dynamodb_client.put_item(
                TableName=TABLE_NAME,
                Item={
                    'entity_id': {'S': insight_id},
                    'entity_type': {'S': 'insight'},
                    'timestamp': {'S': timestamp_iso},
                    'related_entity': {'S': entity_id},
                    'prediction_type': {'S': insight_data['prediction_type']},
                    'risk_score': {'N': str(insight_data['risk_score'])},
                    'explanation': {'S': insight_data['explanation']},
                    'recommendations': {'L': recs_list},
                    'model_used': {'S': MODEL_VERSION},
                    'confidence': {'N': str(insight_data['confidence'])},
                    'ttl': {'N': str(ttl)}
                }
            )
            print(f"✅ Created insight: {insight_data['prediction_type']} for {entity_id} (risk: {insight_data['risk_score']})")

        except Exception as e:
            print(f"❌ Failed to create {insight_data['prediction_type']} insight for {entity_id}: {e}")

def update_entity_predictions(entity_id: str, entity_type: str, metrics: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Process single entity (student or tutor) and update DynamoDB with predictions"""
    try:
        # Engineer features based on entity type
        features = engineer_features(metrics, entity_type)

        # Get ML predictions from SageMaker
        predictions = invoke_sagemaker(features)

        # Classify segment based on entity type
        segment = classify_segment(predictions, entity_type)

        # Generate recommendations based on entity type
        recommendations = generate_recommendations(metrics, predictions, segment, entity_type)

        # Update DynamoDB with predictions
        table.update_item(
            Key={
                'entity_id': entity_id,
                'entity_type': entity_type
            },
            UpdateExpression='''
                SET churn_risk_14d = :c14,
                    churn_risk_30d = :c30,
                    first_session_success_prob = :fss,
                    session_velocity = :sv,
                    health_score = :hs,
                    #seg = :seg,
                    model_version = :mv,
                    prediction_timestamp = :pts,
                    recommendations = :rec
            ''',
            ExpressionAttributeNames={
                '#seg': 'segment'
            },
            ExpressionAttributeValues={
                ':c14': Decimal(str(round(predictions['churn_risk_14d'], 4))),
                ':c30': Decimal(str(round(predictions['churn_risk_30d'], 4))),
                ':fss': Decimal(str(round(predictions['first_session_success'], 4))),
                ':sv': Decimal(str(round(predictions['session_velocity'], 4))),
                ':hs': Decimal(str(round(predictions['health_score'], 2))),
                ':seg': segment,
                ':mv': MODEL_VERSION,
                ':pts': datetime.utcnow().isoformat(),
                ':rec': recommendations
            }
        )

        # Log with entity-type aware messaging
        if entity_type == 'tutor':
            print(f"✅ Updated tutor predictions for {entity_id}: segment={segment}, burnout_risk={predictions['churn_risk_14d']:.2%}, health={predictions['health_score']:.1f}")
        else:
            print(f"✅ Updated student predictions for {entity_id}: segment={segment}, churn_14d={predictions['churn_risk_14d']:.2%}, health={predictions['health_score']:.1f}")

        # Create insight records from predictions
        create_insights_from_predictions(entity_id, predictions, segment, recommendations, metrics)

        return {
            'entity_id': entity_id,
            'segment': segment,
            'predictions': predictions,
            'recommendations': recommendations
        }

    except Exception as e:
        print(f"❌ Error processing {entity_id}: {e}")
        return None

def publish_cloudwatch_metrics(results: List[Dict[str, Any]]) -> None:
    """Publish aggregated metrics to CloudWatch for monitoring and alerting"""
    if not results:
        return

    # Count customers by segment
    segment_counts = {'thriving': 0, 'healthy': 0, 'at_risk': 0, 'churned': 0}
    churn_risks = []
    health_scores = []

    for result in results:
        segment_counts[result['segment']] += 1
        churn_risks.append(result['predictions']['churn_risk_14d'])
        health_scores.append(result['predictions']['health_score'])

    # Calculate aggregates
    high_churn_count = sum(1 for c in churn_risks if c > 0.7)
    avg_churn_risk = np.mean(churn_risks) if churn_risks else 0
    avg_health_score = np.mean(health_scores) if health_scores else 0

    # Publish to CloudWatch
    try:
        cloudwatch.put_metric_data(
            Namespace='IOpsDashboard/Predictions',
            MetricData=[
                {
                    'MetricName': 'TotalCustomersProcessed',
                    'Value': len(results),
                    'Unit': 'Count',
                    'Timestamp': datetime.utcnow()
                },
                {
                    'MetricName': 'HighChurnRiskCount',
                    'Value': high_churn_count,
                    'Unit': 'Count',
                    'Timestamp': datetime.utcnow()
                },
                {
                    'MetricName': 'AverageChurnRisk14d',
                    'Value': avg_churn_risk,
                    'Unit': 'None',
                    'Timestamp': datetime.utcnow()
                },
                {
                    'MetricName': 'AverageHealthScore',
                    'Value': avg_health_score,
                    'Unit': 'None',
                    'Timestamp': datetime.utcnow()
                },
                {
                    'MetricName': 'ThrivingCustomers',
                    'Value': segment_counts['thriving'],
                    'Unit': 'Count',
                    'Timestamp': datetime.utcnow()
                },
                {
                    'MetricName': 'AtRiskCustomers',
                    'Value': segment_counts['at_risk'],
                    'Unit': 'Count',
                    'Timestamp': datetime.utcnow()
                },
                {
                    'MetricName': 'ChurnedCustomers',
                    'Value': segment_counts['churned'],
                    'Unit': 'Count',
                    'Timestamp': datetime.utcnow()
                }
            ]
        )
        print(f"📊 Published CloudWatch metrics: {len(results)} customers, {high_churn_count} high churn risk, avg health={avg_health_score:.1f}")

    except Exception as e:
        print(f"⚠️ Error publishing CloudWatch metrics: {e}")

def process_entity_type(entity_type: str) -> List[Dict[str, Any]]:
    """Process all entities of a specific type (student or tutor)"""
    print(f"Processing all {entity_type}s (batch size: {BATCH_SIZE})")

    results = []
    last_evaluated_key = None

    while True:
        # Query entities from DynamoDB
        query_params = {
            'IndexName': 'EntityTypeIndex',
            'KeyConditionExpression': 'entity_type = :type',
            'ExpressionAttributeValues': {':type': entity_type},
            'Limit': BATCH_SIZE
        }

        if last_evaluated_key:
            query_params['ExclusiveStartKey'] = last_evaluated_key

        response = table.query(**query_params)

        # Process batch
        for item in response['Items']:
            result = update_entity_predictions(
                item['entity_id'],
                item['entity_type'],
                item
            )

            if result:
                results.append(result)

        # Check if more pages exist
        last_evaluated_key = response.get('LastEvaluatedKey')
        if not last_evaluated_key:
            break

    return results

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Main Lambda handler - processes entity metrics and generates ML predictions

    Triggered by:
    - EventBridge schedule (every minute)
    - Manual invocation for specific entities

    Returns:
        Summary of processed students and tutors with predictions
    """
    print(f"🚀 Starting AI prediction refresh (model: {MODEL_VERSION}, endpoint: {ENDPOINT_NAME})")

    # Check if invoked for specific entity
    entity_id = event.get('entity_id') or event.get('customer_id')
    entity_type = event.get('entity_type', 'student')

    if entity_id:
        # Process single entity
        print(f"Processing single {entity_type}: {entity_id}")
        response = table.get_item(
            Key={'entity_id': entity_id, 'entity_type': entity_type}
        )

        if 'Item' not in response:
            return {
                'statusCode': 404,
                'body': json.dumps({'error': f'{entity_type.capitalize()} {entity_id} not found'})
            }

        result = update_entity_predictions(entity_id, entity_type, response['Item'])

        return {
            'statusCode': 200,
            'body': json.dumps({
                'processed': 1,
                entity_type: result
            }, default=str)
        }

    # Process both students and tutors
    student_results = process_entity_type('student')
    tutor_results = process_entity_type('tutor')

    # Publish aggregated metrics to CloudWatch
    publish_cloudwatch_metrics(student_results + tutor_results)

    # Summary
    summary = {
        'statusCode': 200,
        'students_processed': len(student_results),
        'tutors_processed': len(tutor_results),
        'total_processed': len(student_results) + len(tutor_results),
        'student_segments': {
            'thriving': sum(1 for r in student_results if r['segment'] == 'thriving'),
            'healthy': sum(1 for r in student_results if r['segment'] == 'healthy'),
            'at_risk': sum(1 for r in student_results if r['segment'] == 'at_risk'),
            'churned': sum(1 for r in student_results if r['segment'] == 'churned'),
        },
        'tutor_segments': {
            'star': sum(1 for r in tutor_results if r['segment'] == 'star'),
            'healthy': sum(1 for r in tutor_results if r['segment'] == 'healthy'),
            'at_risk': sum(1 for r in tutor_results if r['segment'] == 'at_risk'),
            'churning': sum(1 for r in tutor_results if r['segment'] == 'churning'),
        },
        'model_version': MODEL_VERSION,
        'endpoint': ENDPOINT_NAME,
        'timestamp': datetime.utcnow().isoformat()
    }

    print(f"✅ Completed prediction refresh: {len(student_results)} students, {len(tutor_results)} tutors")
    print(f"📊 Student segments: {summary['student_segments']}")
    print(f"📊 Tutor segments: {summary['tutor_segments']}")

    return summary
