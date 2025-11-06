"""
AI Analysis Lambda - Python Version
Analyzes InfiniBand metrics using SageMaker ML or Bedrock AI with triple-fallback
"""

import json
import os
import boto3
import time
from datetime import datetime
from typing import Dict, List, Any, Optional

# Environment configuration
BEDROCK_MODEL_ID = 'anthropic.claude-3-5-haiku-20241022-v1:0'
TEMPERATURE = 0.3
MAX_RETRIES = 3
BASE_BACKOFF_MS = 1000
DYNAMODB_TABLE = os.environ.get('INSIGHTS_TABLE', 'IOPSInsights')
EVENTBRIDGE_BUS = os.environ.get('EVENT_BUS_NAME', 'default')
USE_SAGEMAKER = os.environ.get('USE_SAGEMAKER', 'false').lower() == 'true'
SAGEMAKER_ENDPOINT = os.environ.get('SAGEMAKER_ENDPOINT', '')
SAGEMAKER_REGRESSOR_ENDPOINT = os.environ.get('SAGEMAKER_REGRESSOR_ENDPOINT', '')
AWS_REGION = os.environ.get('AWS_REGION', 'us-east-1')

# Initialize AWS clients
bedrock_runtime = boto3.client('bedrock-runtime', region_name=AWS_REGION)
dynamodb = boto3.client('dynamodb', region_name=AWS_REGION)
eventbridge = boto3.client('events', region_name=AWS_REGION)
sagemaker_runtime = boto3.client('sagemaker-runtime', region_name=AWS_REGION)


def metrics_to_feature_csv(metric: Dict[str, Any]) -> str:
    """
    Convert IOPSMetric to 25-feature CSV format for SageMaker XGBoost
    Feature order matches training data:
    1-4: IOPS metrics, 5-8: Latency, 9-10: Throughput, 11-12: Error rates,
    13-15: Time-based, 16-17: Access patterns, 18-20: Device metrics,
    21-25: Derived features
    """
    now = datetime.now()

    # Derive features from available metrics
    read_iops = int(metric['iops'] * 0.6)  # Estimate 60% read
    write_iops = int(metric['iops'] * 0.4)  # Estimate 40% write
    total_iops = metric['iops']
    iops_variance = int(metric['iops'] * 0.15)  # Estimate variance

    avg_latency = metric['latency']
    p95_latency = metric['latency'] * 2.5  # Estimate p95
    p99_latency = metric['latency'] * 5  # Estimate p99
    latency_spike_count = 3 if metric['latency'] > 10 else 0

    bandwidth_mbps = metric['throughput']
    throughput_variance = int(metric['throughput'] * 0.1)

    error_rate = metric['errorRate']
    error_trend = 0.5 if metric['errorRate'] > 1 else -0.2

    hour_of_day = now.hour
    day_of_week = now.weekday()
    time_since_last_alert = 3600  # Default 1 hour

    sequential_access_ratio = 0.7
    random_access_ratio = 0.3

    queue_depth = metric['queueDepth']
    io_size_avg = 128  # Typical block size in KB
    io_size_variance = 32

    # Derived features
    iops_per_latency = total_iops / avg_latency if avg_latency > 0 else 0
    anomaly_score = (metric['errorRate'] * 2) + (3 if avg_latency > 10 else 0)
    trend_score = (7 if metric['iops'] > 80000 else 3) + (2 if avg_latency > 15 else 0)
    capacity_utilization = min(metric['iops'] / 150000, 1)
    workload_type = 2 if metric['iops'] > 100000 else (1 if metric['latency'] > 10 else 0)

    # Return CSV row (25 features, no header)
    features = [
        read_iops,
        write_iops,
        total_iops,
        iops_variance,
        f"{avg_latency:.2f}",
        f"{p95_latency:.2f}",
        f"{p99_latency:.2f}",
        latency_spike_count,
        bandwidth_mbps,
        throughput_variance,
        f"{error_rate:.2f}",
        f"{error_trend:.2f}",
        hour_of_day,
        day_of_week,
        time_since_last_alert,
        f"{sequential_access_ratio:.2f}",
        f"{random_access_ratio:.2f}",
        queue_depth,
        io_size_avg,
        io_size_variance,
        f"{iops_per_latency:.2f}",
        f"{anomaly_score:.2f}",
        f"{trend_score:.2f}",
        f"{capacity_utilization:.2f}",
        workload_type
    ]

    return ','.join(str(f) for f in features)


def generate_analysis_from_score(risk_level: int, metric: Dict[str, Any]) -> str:
    """Generate human-readable analysis from SageMaker risk score"""
    risk_labels = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
    label = risk_labels[min(int(risk_level), 3)]

    issues = []
    if metric['iops'] > 100000:
        issues.append(f"high IOPS load ({metric['iops']})")
    if metric['latency'] > 10:
        issues.append(f"elevated latency ({metric['latency']}ms)")
    if metric['errorRate'] > 1:
        issues.append(f"error rate at {metric['errorRate']}%")
    if metric['queueDepth'] > 64:
        issues.append(f"queue saturation (depth: {metric['queueDepth']})")

    issue_text = f" Detected: {', '.join(issues)}." if issues else ''

    return f"SageMaker ML model predicts {label} risk ({risk_level}/3) for node {metric['nodeId']}.{issue_text} Based on 25 engineered features including IOPS patterns, latency distribution, error trends, and capacity utilization."


def generate_recommendations_from_score(risk_level: int, metric: Dict[str, Any]) -> List[str]:
    """Generate recommendations from SageMaker risk score"""
    recommendations = []

    if risk_level >= 3:
        recommendations.append('CRITICAL: Immediate investigation required')
        if metric['errorRate'] > 3:
            recommendations.append('Check for hardware failures or connectivity issues')
        if metric['latency'] > 20:
            recommendations.append('Network congestion detected - investigate InfiniBand fabric')
        if metric['iops'] > 120000:
            recommendations.append('Resource saturation - consider scaling or load balancing')
    elif risk_level >= 2:
        recommendations.append('HIGH: Schedule maintenance window for investigation')
        if metric['latency'] > 10:
            recommendations.append('Monitor latency trends - potential congestion building')
        if metric['queueDepth'] > 64:
            recommendations.append('Queue depth approaching limits - review workload distribution')
    elif risk_level >= 1:
        recommendations.append('MEDIUM: Monitor closely for trend changes')
        if metric['iops'] > 80000:
            recommendations.append('IOPS trending high - prepare capacity plan')
    else:
        recommendations.append('LOW: Continue normal monitoring')

    return recommendations


def invoke_sagemaker(metrics: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Invoke SageMaker endpoint for predictions"""
    if not SAGEMAKER_ENDPOINT or SAGEMAKER_ENDPOINT.strip() == '':
        raise ValueError('SAGEMAKER_ENDPOINT environment variable is not configured')

    # Convert first metric to CSV format
    csv_data = metrics_to_feature_csv(metrics[0])

    print(f"Invoking SageMaker endpoint: {SAGEMAKER_ENDPOINT}")
    print(f"Feature CSV: {csv_data}")

    # Invoke SageMaker endpoint
    response = sagemaker_runtime.invoke_endpoint(
        EndpointName=SAGEMAKER_ENDPOINT,
        ContentType='text/csv',
        Body=csv_data
    )

    # Parse response
    result = json.loads(response['Body'].read().decode('utf-8'))

    # XGBoost returns single prediction value (0-3 for risk classification)
    risk_score = float(result)

    # Map score (0-3) to 0-100 scale
    scaled_risk_score = round(risk_score * 33.33)

    # Generate analysis based on risk score
    analysis = generate_analysis_from_score(risk_score, metrics[0])
    recommendations = generate_recommendations_from_score(risk_score, metrics[0])

    print(f"SageMaker prediction successful: risk={risk_score}, scaled={scaled_risk_score}")

    return {
        'risk_score': scaled_risk_score,
        'analysis': analysis,
        'recommendations': recommendations
    }


def build_infiniband_prompt(metrics: List[Dict[str, Any]]) -> str:
    """Build InfiniBand-specific prompt for Bedrock Claude"""
    metrics_summary = '\n'.join([
        f"Node {m['nodeId']}: IOPS={m['iops']}, Latency={m['latency']}ms, ErrorRate={m['errorRate']}%, "
        f"Throughput={m['throughput']}MB/s, QueueDepth={m['queueDepth']}, Connections={m['activeConnections']}"
        for m in metrics
    ])

    return f"""You are an expert in InfiniBand storage protocols and high-performance computing infrastructure.

Analyze the following InfiniBand storage metrics and provide insights:

{metrics_summary}

Provide your analysis in the following JSON format:
{{
  "risk_score": <number 0-100>,
  "analysis": "<detailed analysis of the metrics>",
  "recommendations": ["<recommendation 1>", "<recommendation 2>", ...]
}}

Focus on:
1. IOPS bottlenecks and throughput issues
2. Latency patterns indicating network congestion
3. Error rates suggesting hardware or protocol issues
4. Queue depth indicating saturation
5. Connection patterns and their impact on performance

Return ONLY the JSON object, no additional text."""


def invoke_bedrock_with_retry(prompt: str, retry_count: int = 0) -> Dict[str, Any]:
    """Invoke Bedrock with exponential backoff retry logic"""
    try:
        response = bedrock_runtime.invoke_model(
            modelId=BEDROCK_MODEL_ID,
            contentType='application/json',
            accept='application/json',
            body=json.dumps({
                'anthropic_version': 'bedrock-2023-05-31',
                'max_tokens': 2000,
                'temperature': TEMPERATURE,
                'messages': [
                    {
                        'role': 'user',
                        'content': prompt
                    }
                ]
            })
        )

        response_body = json.loads(response['body'].read())
        return response_body

    except Exception as error:
        print(f"Bedrock invocation failed (attempt {retry_count + 1}): {error}")

        # Check if we should retry
        error_name = error.__class__.__name__
        should_retry = (error_name in ['ThrottlingException', 'TimeoutError']) and retry_count < MAX_RETRIES

        if should_retry:
            backoff_ms = BASE_BACKOFF_MS * (2 ** retry_count) / 1000.0  # Convert to seconds
            print(f"Retrying after {backoff_ms}s...")
            time.sleep(backoff_ms)
            return invoke_bedrock_with_retry(prompt, retry_count + 1)

        raise


def rules_based_analysis(metrics: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Fallback rules-based analysis"""
    risk_score = 0
    issues = []
    recommendations = []

    for metric in metrics:
        # IOPS threshold analysis
        if metric['iops'] > 100000:
            risk_score += 20
            issues.append(f"Node {metric['nodeId']}: High IOPS ({metric['iops']})")
            recommendations.append(f"Scale out storage for node {metric['nodeId']}")

        # Latency analysis
        if metric['latency'] > 10:
            risk_score += 25
            issues.append(f"Node {metric['nodeId']}: High latency ({metric['latency']}ms)")
            recommendations.append(f"Investigate network congestion on node {metric['nodeId']}")

        # Error rate analysis
        if metric['errorRate'] > 1:
            risk_score += 30
            issues.append(f"Node {metric['nodeId']}: Elevated error rate ({metric['errorRate']}%)")
            recommendations.append(f"Check hardware health on node {metric['nodeId']}")

        # Queue depth analysis
        if metric['queueDepth'] > 64:
            risk_score += 15
            issues.append(f"Node {metric['nodeId']}: Queue saturation (depth: {metric['queueDepth']})")
            recommendations.append(f"Increase queue depth or reduce load on node {metric['nodeId']}")

        # Throughput analysis
        if metric['throughput'] < 1000 and metric['iops'] > 50000:
            risk_score += 10
            issues.append(f"Node {metric['nodeId']}: Low throughput relative to IOPS")
            recommendations.append(f"Optimize block size for node {metric['nodeId']}")

    risk_score = min(risk_score, 100)
    analysis = (f"Rules-based analysis detected {len(issues)} issue(s): {'; '.join(issues)}"
                if issues else 'All metrics within acceptable thresholds')

    return {
        'timestamp': int(time.time() * 1000),
        'nodeId': metrics[0]['nodeId'] if metrics else 'unknown',
        'riskScore': risk_score,
        'analysis': analysis,
        'recommendations': recommendations if recommendations else ['Continue monitoring'],
        'source': 'rules-based'
    }


def analyze_with_ai(metrics: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Analyze metrics using AI (SageMaker or Bedrock)"""
    # Try SageMaker first if enabled
    if USE_SAGEMAKER and SAGEMAKER_ENDPOINT:
        try:
            print('Attempting SageMaker prediction...')
            prediction = invoke_sagemaker(metrics)

            return {
                'timestamp': int(time.time() * 1000),
                'nodeId': metrics[0]['nodeId'] if metrics else 'unknown',
                'riskScore': prediction['risk_score'],
                'analysis': prediction['analysis'],
                'recommendations': prediction['recommendations'],
                'source': 'sagemaker',
                'modelUsed': SAGEMAKER_ENDPOINT
            }
        except Exception as error:
            print(f'SageMaker failed, falling back to Bedrock: {error}')

    # Try Bedrock
    try:
        print('Invoking Bedrock...')
        prompt = build_infiniband_prompt(metrics)
        response = invoke_bedrock_with_retry(prompt)

        response_text = response['content'][0]['text'] if response.get('content') else '{}'
        parsed = json.loads(response_text)

        return {
            'timestamp': int(time.time() * 1000),
            'nodeId': metrics[0]['nodeId'] if metrics else 'unknown',
            'riskScore': parsed.get('risk_score', 0),
            'analysis': parsed.get('analysis', 'No analysis provided'),
            'recommendations': parsed.get('recommendations', []),
            'source': 'bedrock',
            'modelUsed': BEDROCK_MODEL_ID
        }
    except Exception as error:
        print(f'Bedrock failed after retries, falling back to rules-based: {error}')
        return rules_based_analysis(metrics)


def write_insight_to_dynamodb(insight: Dict[str, Any]) -> None:
    """Write insight to DynamoDB matching entity_id/entity_type schema"""
    try:
        from datetime import datetime
        timestamp_iso = datetime.utcnow().isoformat() + 'Z'
        insight_id = f"insight_{insight['nodeId']}_{insight['timestamp']}"

        # Convert recommendations to DynamoDB List format
        recs_list = [{'S': rec} for rec in insight.get('recommendations', [])]

        dynamodb.put_item(
            TableName=DYNAMODB_TABLE,
            Item={
                'entity_id': {'S': insight_id},
                'entity_type': {'S': 'insight'},
                'timestamp': {'S': timestamp_iso},
                'related_entity': {'S': insight['nodeId']},
                'risk_score': {'N': str(insight['riskScore'])},
                'explanation': {'S': insight['analysis']},
                'recommendations': {'L': recs_list},
                'model_used': {'S': insight.get('modelUsed', insight.get('source', 'N/A'))},
                'prediction_type': {'S': get_prediction_type(insight['riskScore'])},
                'confidence': {'N': str(get_confidence(insight.get('source', 'unknown')))}
            }
        )
        print(f"Insight written to DynamoDB: {insight_id}")
    except Exception as error:
        print(f'Failed to write to DynamoDB: {error}')
        raise

def get_prediction_type(risk_score: int) -> str:
    """Convert risk score to prediction type"""
    if risk_score >= 80:
        return 'critical_performance_issue'
    elif risk_score >= 60:
        return 'performance_degradation'
    elif risk_score >= 40:
        return 'anomaly_detected'
    else:
        return 'normal_operation'

def get_confidence(source: str) -> float:
    """Get confidence score based on analysis source"""
    if 'sagemaker' in source.lower():
        return 0.95
    elif 'bedrock' in source.lower():
        return 0.88
    else:
        return 0.75


def trigger_high_risk_alert(insight: Dict[str, Any]) -> None:
    """Trigger EventBridge event for high-risk insights"""
    try:
        eventbridge.put_events(
            Entries=[
                {
                    'Source': 'iops.ai-analysis',
                    'DetailType': 'High Risk Detected',
                    'Detail': json.dumps({
                        'nodeId': insight['nodeId'],
                        'riskScore': insight['riskScore'],
                        'analysis': insight['analysis'],
                        'recommendations': insight['recommendations'],
                        'timestamp': insight['timestamp']
                    }),
                    'EventBusName': EVENTBRIDGE_BUS
                }
            ]
        )
        print('High-risk alert triggered via EventBridge')
    except Exception as error:
        print(f'Failed to trigger EventBridge event: {error}')
        # Don't throw - alerting failure shouldn't block analysis


def lambda_handler(event, context):
    """Lambda handler"""
    print(f"AI Analysis Lambda invoked: {json.dumps(event)}")

    try:
        # Parse metrics from event
        if isinstance(event, list):
            metrics = event
        elif isinstance(event.get('Records'), list):
            metrics = [json.loads(record['body']) for record in event['Records']]
        else:
            metrics = event.get('metrics', [event])

        if len(metrics) == 0:
            return {
                'statusCode': 400,
                'body': json.dumps({'error': 'No metrics provided'})
            }

        # Analyze with AI
        insight = analyze_with_ai(metrics)

        # Write to DynamoDB
        write_insight_to_dynamodb(insight)

        # Trigger alert if high risk
        if insight['riskScore'] >= 80:
            trigger_high_risk_alert(insight)

        return {
            'statusCode': 200,
            'body': json.dumps({
                'success': True,
                'insight': insight
            })
        }
    except Exception as error:
        print(f'Lambda execution failed: {error}')
        return {
            'statusCode': 500,
            'body': json.dumps({
                'error': 'Internal server error',
                'message': str(error)
            })
        }
