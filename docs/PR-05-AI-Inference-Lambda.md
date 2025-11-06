# PR-05: AI Inference Lambda

## Overview
Create the **Python-based** AI inference Lambda that uses AWS Bedrock (Claude 4.5 Haiku) or OpenAI GPT-4 to analyze alerts, predict churn risk, and provide explainable insights.

## Language
**Python 3.12** - Native boto3 support for Bedrock, better ML library ecosystem, industry standard for AI/ML workloads

## Dependencies
- PR-04: Processing Lambda (EventBridge alerts)
- PR-06: Bedrock Config & IAM Policies (recommended to implement first)

## AWS Credentials Setup
**IMPORTANT**: Ensure AWS credentials are configured before running CDK/CLI commands.

See `/Users/tyler/Desktop/Gauntlet/iops-dashboard/docs/AWS-credentials.md` for setup instructions.

## Objectives
- Build AI inference Lambda triggered by EventBridge alerts
- Integrate with AWS Bedrock Claude 4.5 Haiku
- Provide fallback to OpenAI GPT-4
- Generate explainable predictions with reasoning
- Store AI insights in DynamoDB

## Step-by-Step Instructions

### 1. Create AI Lambda Code
**File:** `lambda/ai/handler.py`

```python
import json
import os
from datetime import datetime
from typing import Dict, Any, List, Optional
import boto3
import requests
from decimal import Decimal
import re
import time

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
```

### 2. Create Requirements File
**File:** `lambda/ai/requirements.txt`

```
boto3==1.34.0
requests==2.31.0
```

### 3. Add AI Lambda to CDK Stack

**IMPORTANT - Dependency Management:**
- ✅ CDK automatically bundles Python dependencies using Docker during `cdk deploy`
- ❌ **NEVER** run `pip install -r requirements.txt -t .` in Lambda directories
- ❌ **NEVER** commit package directories (boto3, requests, etc.) to git
- ✅ Keep Lambda folders clean - only `handler.py` and `requirements.txt`
- ✅ For local testing, use virtual environments (see `docs/Lambda-Dependency-Management.md`)

CDK bundling configuration is already set up in the stack (see step 4 below).

### 4. Update CDK Stack Configuration
**File:** `cdk/lib/cdk-stack.ts` (the AI lambda is now included in the main CoreStack)

```typescript
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';

export interface IntelligenceStackProps extends cdk.StackProps {
  lambdaExecutionRole: iam.Role;
}

export class IntelligenceStack extends cdk.Stack {
  public readonly aiFunction: lambda.Function;
  public readonly eventBus: events.EventBus;

  constructor(scope: Construct, id: string, props: IntelligenceStackProps) {
    super(scope, id, props);

    // Create custom EventBridge bus for alerts
    this.eventBus = new events.EventBus(this, 'AlertEventBus', {
      eventBusName: 'iops-dashboard-alerts',
    });

    // Create AI inference Lambda (Python)
    const aiLambda = new lambda.Function(this, 'AIFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'handler.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/ai'), {
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
        USE_BEDROCK: 'true',
        // OPENAI_API_KEY: 'sk-xxx', // Add via Secrets Manager in production
      },
      timeout: cdk.Duration.seconds(60),
      memorySize: 1024,
      description: 'AI inference for alerts using Bedrock Claude (Python)',
    });

    // Grant Bedrock permissions
    aiLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:InvokeModel'],
      resources: [
        `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-3-5-haiku-20241022:0`,
      ],
    }));

    // Outputs
    new cdk.CfnOutput(this, 'AIFunctionName', {
      value: this.aiFunction.functionName,
      description: 'AI inference Lambda function name',
      exportName: 'IOpsDashboard-AIFunctionName',
    });

    new cdk.CfnOutput(this, 'EventBusName', {
      value: this.eventBus.eventBusName,
      description: 'Custom EventBridge bus for alerts',
      exportName: 'IOpsDashboard-EventBusName',
    });
  }
}
```

**Note:** The AI Lambda is included in the main CdkStack. EventBridge rules for alert routing will be added in PR-07.

### 5. Deploy Stack
```bash
cd cdk
npm run build
cdk deploy CdkStack
```

## Verification Steps

### 1. Test AI Lambda Manually
Create a test event file:

**File:** `test/test-alert.json`
```json
{
  "version": "0",
  "id": "test-event-id",
  "detail-type": "high_ib_call_frequency",
  "source": "iops-dashboard.processor",
  "account": "123456789012",
  "time": "2025-01-01T12:00:00Z",
  "region": "us-east-1",
  "resources": [],
  "detail": {
    "alert_type": "high_ib_call_frequency",
    "severity": "warning",
    "entity_id": "stu_4532",
    "entity_type": "student",
    "details": {
      "ib_calls_14d": 5,
      "health_score": 65
    },
    "message": "Student stu_4532 has 5 IB calls in 14 days",
    "timestamp": "2025-01-01T12:00:00Z"
  }
}
```

Invoke:
```bash
FUNCTION_NAME=$(aws cloudformation describe-stacks \
  --stack-name CdkStack \
  --query 'Stacks[0].Outputs[?OutputKey==`AIFunctionName`].OutputValue' \
  --output text)

aws lambda invoke \
  --function-name $FUNCTION_NAME \
  --payload file://test/test-alert.json \
  response.json

cat response.json
```

### 2. Check CloudWatch Logs
```bash
aws logs tail /aws/lambda/$FUNCTION_NAME --follow
```

Expected log output:
```
Received alert: {...}
Calling AWS Bedrock...
AI Response: {"risk_score": 75, "explanation": "...", "recommendations": [...]}
Generated insight: {...}
Stored insight: high_ib_call_frequency_stu_4532_...
AI inference complete
```

### 3. Test with End-to-End Flow
```bash
# 1. Generate synthetic data
SIM_FUNCTION=$(aws cloudformation describe-stacks \
  --stack-name CdkStack \
  --query 'Stacks[0].Outputs[?OutputKey==`SimulatorFunctionName`].OutputValue' \
  --output text)

aws lambda invoke --function-name $SIM_FUNCTION --payload '{}' response.json

# 2. Wait 30 seconds for processing

# 3. Check AI Lambda was triggered
aws logs tail /aws/lambda/$FUNCTION_NAME --since 2m
```

### 4. Verify EventBridge Rules
```bash
# List rules on custom bus
aws events list-rules --event-bus-name iops-dashboard-alerts

# Should show 3 rules (one for each alert type)
```

## Testing Without Bedrock (OpenAI Fallback)

If Bedrock access is not yet configured:

```bash
# Update Lambda environment to use OpenAI
aws lambda update-function-configuration \
  --function-name $FUNCTION_NAME \
  --environment "Variables={
    DYNAMODB_TABLE_NAME=iops-dashboard-metrics,
    USE_BEDROCK=false,
    OPENAI_API_KEY=sk-your-key-here
  }"

# Test again
aws lambda invoke \
  --function-name $FUNCTION_NAME \
  --payload file://test/test-alert.json \
  response.json
```

## Troubleshooting

### Issue: Bedrock AccessDeniedException
**Solution:** Ensure Bedrock model access is enabled (PR-06) or use OpenAI:
```bash
aws lambda update-function-configuration \
  --function-name $FUNCTION_NAME \
  --environment "Variables={USE_BEDROCK=false,OPENAI_API_KEY=sk-...}"
```

### Issue: JSON Parsing Error
**Cause:** AI returned non-JSON text
**Solution:** Check logs for actual AI response, improve prompt if needed

### Issue: Lambda Timeout
**Solution:** Increase timeout:
```typescript
timeout: cdk.Duration.minutes(2),
```

### Issue: No Alerts Being Processed
**Check:**
```bash
# Verify EventBridge rule is enabled
aws events describe-rule \
  --name CdkStack-highIBCallFrequencyRule \
  --event-bus-name default
```

## Files Created
- `lambda/ai/handler.py`
- `lambda/ai/requirements.txt`
- `cdk/lib/intelligence-stack.ts`
- `cdk/bin/cdk.ts` (updated)
- `test/test-alert.json`

## Next Steps
- PR-06: Bedrock Config & IAM Policies (enable Bedrock access)
- PR-07: EventBridge Rules + SNS Alerts (add SNS notifications)
- PR-08: DynamoDB Schema (create table for storing insights)

## Estimated Time
- 60-75 minutes

## Skills Required
- Python
- Understanding of LLM prompting
- AWS Bedrock boto3 SDK
- EventBridge event patterns

## References
- [AWS Bedrock Runtime](https://docs.aws.amazon.com/bedrock/latest/userguide/what-is-bedrock.html)
- [Claude 3.5 Haiku Model](https://docs.anthropic.com/en/docs/about-claude/models)
- [EventBridge Event Patterns](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-event-patterns.html)
- [OpenAI API Documentation](https://platform.openai.com/docs/api-reference)
