import json
import os
from datetime import datetime
from typing import Dict, Any, List, Optional
import boto3
import requests
from decimal import Decimal

# Initialize AWS clients
bedrock_runtime = boto3.client('bedrock-runtime', region_name=os.environ.get('AWS_REGION', 'us-east-1'))
dynamodb = boto3.resource('dynamodb', region_name=os.environ.get('AWS_REGION', 'us-east-1'))

# Configuration
TABLE_NAME = os.environ['DYNAMODB_TABLE_NAME']
USE_BEDROCK = os.environ.get('USE_BEDROCK', 'true').lower() == 'true'
OPENAI_API_KEY = os.environ.get('OPENAI_API_KEY')
BEDROCK_MODEL_ID = 'anthropic.claude-3-5-haiku-20241022:0'

# Get DynamoDB table
table = dynamodb.Table(TABLE_NAME)

# Type definitions
class Alert:
    def __init__(self, data: Dict[str, Any]):
        self.alert_type = data['alert_type']
        self.severity = data['severity']
        self.entity_id = data['entity_id']
        self.entity_type = data['entity_type']
        self.details = data['details']
        self.message = data['message']
        self.timestamp = data['timestamp']

class AIInsight:
    def __init__(self, alert_id: str, entity_id: str, prediction_type: str,
                 risk_score: float, explanation: str, recommendations: List[str],
                 model_used: str):
        self.alert_id = alert_id
        self.entity_id = entity_id
        self.prediction_type = prediction_type
        self.risk_score = risk_score
        self.explanation = explanation
        self.recommendations = recommendations
        self.timestamp = datetime.utcnow().isoformat()
        self.model_used = model_used

# Call AWS Bedrock Claude
def call_bedrock(prompt: str) -> str:
    """Invoke AWS Bedrock Claude model"""
    request_body = {
        'anthropic_version': 'bedrock-2023-05-31',
        'max_tokens': 1000,
        'messages': [
            {
                'role': 'user',
                'content': prompt,
            },
        ],
        'temperature': 0.7,
    }

    response = bedrock_runtime.invoke_model(
        modelId=BEDROCK_MODEL_ID,
        contentType='application/json',
        accept='application/json',
        body=json.dumps(request_body)
    )

    response_body = json.loads(response['body'].read())
    return response_body['content'][0]['text']

# Call OpenAI GPT-4 (fallback)
def call_openai(prompt: str) -> str:
    """Invoke OpenAI GPT-4 API"""
    if not OPENAI_API_KEY:
        raise ValueError('OpenAI API key not configured')

    response = requests.post(
        'https://api.openai.com/v1/chat/completions',
        json={
            'model': 'gpt-4',
            'messages': [
                {'role': 'user', 'content': prompt},
            ],
            'temperature': 0.7,
            'max_tokens': 1000,
        },
        headers={
            'Authorization': f'Bearer {OPENAI_API_KEY}',
            'Content-Type': 'application/json',
        },
        timeout=30
    )
    response.raise_for_status()

    return response.json()['choices'][0]['message']['content']

# Generate AI insight based on alert
def generate_insight(alert: Alert) -> AIInsight:
    """Generate AI-powered insight for the alert"""
    # Build prompt based on alert type
    prompt = ''

    if alert.alert_type == 'high_ib_call_frequency':
        prompt = f"""Analyze this student's behavior and predict churn risk:

Student ID: {alert.entity_id}
IB Calls (14 days): {alert.details['ib_calls_14d']}
Health Score: {alert.details['health_score']}

Provide a JSON response with:
1. "risk_score": A number between 0-100 representing churn risk
2. "explanation": A clear explanation of why this student is at risk
3. "recommendations": An array of 2-3 specific actions to prevent churn

Format your response as valid JSON only, no additional text."""

    elif alert.alert_type == 'low_health_score':
        prompt = f"""Analyze this student's health metrics and predict churn risk:

Student ID: {alert.entity_id}
Health Score: {alert.details['health_score']}
Sessions (7 days): {alert.details['sessions_7d']}
IB Calls (14 days): {alert.details['ib_calls_14d']}

Provide a JSON response with:
1. "risk_score": A number between 0-100 representing churn risk
2. "explanation": A clear explanation of concerning patterns
3. "recommendations": An array of 2-3 specific interventions

Format your response as valid JSON only, no additional text."""

    elif alert.alert_type == 'supply_demand_imbalance':
        prompt = f"""Analyze this supply/demand imbalance and recommend actions:

Subject: {alert.entity_id}
Balance Status: {alert.details['balance_status']}
Demand Score: {alert.details['demand_score']}
Supply Score: {alert.details['supply_score']}

Provide a JSON response with:
1. "risk_score": A number between 0-100 representing business impact
2. "explanation": Why this imbalance is occurring
3. "recommendations": An array of 2-3 specific actions to address it

Format your response as valid JSON only, no additional text."""

    else:
        raise ValueError(f"Unsupported alert type: {alert.alert_type}")

    # Call AI service
    ai_response = ''
    model_used = ''

    try:
        if USE_BEDROCK:
            print('Calling AWS Bedrock...')
            ai_response = call_bedrock(prompt)
            model_used = 'bedrock-claude-3.5-haiku'
        else:
            print('Calling OpenAI GPT-4...')
            ai_response = call_openai(prompt)
            model_used = 'openai-gpt-4'
    except Exception as error:
        print(f'Primary AI service failed, trying fallback: {error}')

        # Try fallback
        if USE_BEDROCK and OPENAI_API_KEY:
            print('Falling back to OpenAI...')
            ai_response = call_openai(prompt)
            model_used = 'openai-gpt-4-fallback'
        else:
            raise

    # Parse AI response
    print(f'AI Response: {ai_response}')

    # Extract JSON from response (AI might include markdown code blocks)
    import re
    json_match = re.search(r'\{[\s\S]*\}', ai_response)
    if not json_match:
        raise ValueError('AI response does not contain valid JSON')

    parsed = json.loads(json_match.group(0))

    # Build insight object
    insight = AIInsight(
        alert_id=f"{alert.alert_type}_{alert.entity_id}_{int(datetime.now().timestamp() * 1000)}",
        entity_id=alert.entity_id,
        prediction_type=alert.alert_type,
        risk_score=float(parsed['risk_score']),
        explanation=parsed['explanation'],
        recommendations=parsed['recommendations'],
        model_used=model_used
    )

    return insight

# Store insight in DynamoDB
def store_insight(insight: AIInsight) -> None:
    """Store AI insight in DynamoDB with TTL"""
    import time

    table.put_item(Item={
        'pk': f"insight#{insight.entity_id}",
        'sk': insight.timestamp,
        'alert_id': insight.alert_id,
        'entity_id': insight.entity_id,
        'prediction_type': insight.prediction_type,
        'risk_score': Decimal(str(insight.risk_score)),
        'explanation': insight.explanation,
        'recommendations': insight.recommendations,
        'timestamp': insight.timestamp,
        'model_used': insight.model_used,
        'ttl': int(time.time()) + (90 * 24 * 60 * 60),  # 90 days TTL
    })

    print(f"Stored insight: {insight.alert_id}")

# Main Lambda handler
def lambda_handler(event: Dict[str, Any], context: Any) -> None:
    """Process EventBridge alert and generate AI insight"""
    print(f'Received alert: {json.dumps(event, indent=2)}')

    alert_data = event.get('detail', {})
    alert = Alert(alert_data)

    try:
        # Generate AI insight
        insight = generate_insight(alert)

        print(f'Generated insight: {json.dumps(insight.__dict__, indent=2, default=str)}')

        # Store in DynamoDB
        store_insight(insight)

        print('AI inference complete')
    except Exception as error:
        print(f'Error generating AI insight: {error}')
        raise  # Let Lambda retry mechanism handle it
