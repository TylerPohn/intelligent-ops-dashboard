# Migration Plan: Upgrading to TensorFlow Multi-Task Marketplace Health Model

## Executive Summary

**Current State:**
- Lambda functions and DynamoDB schema **ALREADY** set up for tutor marketplace health monitoring
- Processing student/tutor sessions, IB calls, health scores, ratings
- Using OLD SageMaker XGBoost endpoints: `iops-classifier-lite` and `iops-regressor-lite`
- Basic metrics aggregation without ML predictions

**Target State:**
- Deploy NEW TensorFlow multi-task neural network model
- 46-feature engineering (vs current basic aggregation)
- 5 prediction outputs: first_session_success, session_velocity, churn_risk_14d, churn_risk_30d, health_score
- Enhanced customer segmentation (thriving/healthy/at-risk/churned)

**Migration Type:** Model upgrade (NOT a domain pivot) - zero downtime possible

---

## Current System Analysis

### 1. DynamoDB Schema (cdk-stack.ts:42-58)
**ALREADY CORRECT** for marketplace health monitoring:

```typescript
Table: iops-dashboard-metrics
Partition Key: entity_id (STRING)
Sort Key: entity_type (STRING)
GSI: EntityTypeIndex
  - Partition: entity_type
  - Sort: timestamp
Stream: NEW_AND_OLD_IMAGES
```

**Current Attributes (from process/handler.py):**
- `entity_id`: student_id or tutor_id
- `entity_type`: "student" | "tutor" | "subject"
- `sessions_7d`, `sessions_14d`, `sessions_30d`
- `ib_calls_7d`, `ib_calls_14d`
- `avg_rating`
- `health_score`
- `last_updated`

**REQUIRED ADDITIONS:**
- `churn_risk_14d` (Decimal)
- `churn_risk_30d` (Decimal)
- `first_session_success_prob` (Decimal)
- `session_velocity` (Decimal)
- `segment` (STRING): "thriving" | "healthy" | "at_risk" | "churned"
- `model_version` (STRING)
- `prediction_timestamp` (STRING)

**Migration Strategy:** Add new attributes on write (no schema migration needed in DynamoDB)

### 2. Lambda Functions

#### Process Lambda (lambda/process/handler.py)
**Current Functionality:**
- ✅ Decodes Kinesis records
- ✅ Aggregates sessions, IB calls, ratings
- ✅ Updates DynamoDB metrics
- ✅ Detects anomalies (high IB calls, low health score)
- ✅ Sends EventBridge alerts

**REQUIRED CHANGES:**
- None initially - this Lambda aggregates raw metrics
- Later: Add call to AI Lambda for enriched predictions (optional)

#### AI Lambda (MISSING - needs creation)
**Current State:** CDK references AI Lambda but it doesn't exist with SageMaker integration

**Location:** lambda/ai-analysis/handler.py (needs creation)

**Required Functionality:**
1. Read aggregated metrics from DynamoDB
2. Engineer 46 features for TensorFlow model
3. Invoke SageMaker marketplace-health-endpoint
4. Parse 5 predictions from multi-task output
5. Update DynamoDB with predictions and segment
6. Trigger alerts for high churn risk

#### Ingest Lambda (lambda/ingest/)
**Current:** Writes to Kinesis stream
**Required:** No changes (event schema is correct)

#### Stream Processor Lambda (lambda/stream-processor/index.ts)
**Current:** Validates events, writes to DynamoDB, archives to S3
**Required:** No changes

### 3. SageMaker Endpoints

**Current Endpoints:**
```bash
iops-classifier-lite: InService (XGBoost)
iops-regressor-lite: NOT DEPLOYED
```

**New Model Available:**
```
s3://iops-dashboard-ml-data/marketplace-health-model/models/
  marketplace-health-model-2025-11-07-00-19-38-650/output/model.tar.gz (296KB)
```

**Required Endpoint:**
```
Name: marketplace-health-endpoint
Framework: TensorFlow 2.13
Instance: ml.t2.medium (start) → ml.m5.xlarge (production)
Model: s3://.../marketplace-health-model-2025-11-07-00-19-38-650/output/model.tar.gz
Input: 46 features (CSV or JSON)
Output: [first_session_success, session_velocity, churn_risk_14d, churn_risk_30d, health_score]
```

### 4. CDK Infrastructure Updates Required

**File:** cdk/lib/cdk-stack.ts

**Changes:**

1. **Update SageMaker IAM permissions (line 357-365):**
```typescript
// OLD:
actions: ['sagemaker:InvokeEndpoint'],
resources: [
  `arn:aws:sagemaker:${this.region}:${this.account}:endpoint/iops-classifier-lite`,
  `arn:aws:sagemaker:${this.region}:${this.account}:endpoint/iops-regressor-lite`,
]

// NEW:
actions: ['sagemaker:InvokeEndpoint'],
resources: [
  `arn:aws:sagemaker:${this.region}:${this.account}:endpoint/marketplace-health-endpoint`,
  // Keep old endpoints for backward compatibility during transition
  `arn:aws:sagemaker:${this.region}:${this.account}:endpoint/iops-classifier-lite`,
]
```

2. **Update AI Lambda environment variables:**
```typescript
environment: {
  DYNAMODB_TABLE_NAME: this.metricsTable.tableName,
  SAGEMAKER_ENDPOINT_NAME: 'marketplace-health-endpoint',
  MODEL_TYPE: 'tensorflow_multi_task',
  FEATURE_COUNT: '46',
  // OLD: SAGEMAKER_ENDPOINT_NAME: 'iops-classifier-lite'
}
```

3. **Update CloudWatch Alarms:**
```typescript
// Add new alarms for churn risk
const highChurnAlarm = new cloudwatch.Alarm(this, 'HighChurnRateAlarm', {
  alarmName: 'iops-dashboard-high-churn-rate',
  metric: new cloudwatch.Metric({
    namespace: 'IOpsDashboard',
    metricName: 'HighChurnRiskCustomers',
    statistic: 'Sum',
    period: cdk.Duration.minutes(5),
  }),
  threshold: 10, // Alert if 10+ customers at high churn risk
  evaluationPeriods: 2,
  actionsEnabled: true,
});

highChurnAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.riskAlertTopic));
```

---

## Migration Plan (Zero Downtime)

### Phase 1: Deploy New SageMaker Endpoint (Day 1)

**Steps:**

1. **Create SageMaker Model:**
```bash
aws sagemaker create-model \
  --model-name marketplace-health-model-v1 \
  --primary-container Image=763104351884.dkr.ecr.us-east-2.amazonaws.com/tensorflow-inference:2.13-cpu,\
ModelDataUrl=s3://iops-dashboard-ml-data/marketplace-health-model/models/marketplace-health-model-2025-11-07-00-19-38-650/output/model.tar.gz \
  --execution-role-arn arn:aws:iam::971422717446:role/SageMakerExecutionRole \
  --region us-east-2
```

2. **Create Endpoint Configuration:**
```bash
aws sagemaker create-endpoint-config \
  --endpoint-config-name marketplace-health-config-v1 \
  --production-variants \
    VariantName=AllTraffic,\
    ModelName=marketplace-health-model-v1,\
    InstanceType=ml.t2.medium,\
    InitialInstanceCount=1 \
  --region us-east-2
```

3. **Deploy Endpoint:**
```bash
aws sagemaker create-endpoint \
  --endpoint-name marketplace-health-endpoint \
  --endpoint-config-name marketplace-health-config-v1 \
  --region us-east-2
```

4. **Wait for InService (5-10 minutes):**
```bash
aws sagemaker wait endpoint-in-service \
  --endpoint-name marketplace-health-endpoint \
  --region us-east-2
```

**Rollback Plan:** Delete endpoint if issues occur (no impact on current system)

---

### Phase 2: Create AI Lambda with 46-Feature Engineering (Day 1-2)

**File:** lambda/ai-analysis/handler.py

**Implementation:**

```python
import json
import os
import boto3
import numpy as np
from datetime import datetime
from decimal import Decimal

sagemaker_runtime = boto3.client('sagemaker-runtime')
dynamodb = boto3.resource('dynamodb')

TABLE_NAME = os.environ['DYNAMODB_TABLE_NAME']
ENDPOINT_NAME = os.environ['SAGEMAKER_ENDPOINT_NAME']

table = dynamodb.Table(TABLE_NAME)

def engineer_features(metrics: dict) -> np.ndarray:
    """Engineer 46 features for TensorFlow model"""
    features = []

    # Session features (13 features)
    features.append(float(metrics.get('sessions_7d', 0)))
    features.append(float(metrics.get('sessions_14d', 0)))
    features.append(float(metrics.get('sessions_30d', 0)))
    features.append(float(metrics.get('sessions_7d', 0)) / 7.0)  # session_frequency_7d
    features.append(float(metrics.get('sessions_14d', 0)) / 14.0)
    features.append(float(metrics.get('sessions_30d', 0)) / 30.0)
    # ... (add remaining 40 features)

    return np.array(features, dtype=np.float32)

def invoke_sagemaker(features: np.ndarray) -> dict:
    """Invoke TensorFlow multi-task model"""
    payload = ','.join(map(str, features))

    response = sagemaker_runtime.invoke_endpoint(
        EndpointName=ENDPOINT_NAME,
        ContentType='text/csv',
        Body=payload
    )

    result = json.loads(response['Body'].read().decode())
    predictions = result['predictions'][0]  # TensorFlow format

    return {
        'first_session_success': float(predictions[0]),
        'session_velocity': float(predictions[1]),
        'churn_risk_14d': float(predictions[2]),
        'churn_risk_30d': float(predictions[3]),
        'health_score': float(predictions[4]),
    }

def classify_segment(predictions: dict) -> str:
    """Classify customer segment based on predictions"""
    churn_14d = predictions['churn_risk_14d']
    health = predictions['health_score']

    if churn_14d > 0.7:
        return 'churned'
    elif churn_14d > 0.4 or health < 60:
        return 'at_risk'
    elif health > 80:
        return 'thriving'
    else:
        return 'healthy'

def lambda_handler(event, context):
    """Process customer metrics and generate ML predictions"""
    # Triggered by EventBridge rule every 5 minutes
    # Scan DynamoDB for customers needing prediction refresh

    response = table.query(
        IndexName='EntityTypeIndex',
        KeyConditionExpression='entity_type = :type',
        ExpressionAttributeValues={':type': 'student'}
    )

    for item in response['Items']:
        try:
            # Engineer features
            features = engineer_features(item)

            # Get predictions
            predictions = invoke_sagemaker(features)

            # Classify segment
            segment = classify_segment(predictions)

            # Update DynamoDB
            table.update_item(
                Key={
                    'entity_id': item['entity_id'],
                    'entity_type': item['entity_type']
                },
                UpdateExpression='SET churn_risk_14d = :c14, churn_risk_30d = :c30, '
                                'first_session_success_prob = :fss, session_velocity = :sv, '
                                'health_score = :hs, segment = :seg, model_version = :mv, '
                                'prediction_timestamp = :pts',
                AttributeValues={
                    ':c14': Decimal(str(predictions['churn_risk_14d'])),
                    ':c30': Decimal(str(predictions['churn_risk_30d'])),
                    ':fss': Decimal(str(predictions['first_session_success'])),
                    ':sv': Decimal(str(predictions['session_velocity'])),
                    ':hs': Decimal(str(predictions['health_score'])),
                    ':seg': segment,
                    ':mv': 'marketplace-health-v1',
                    ':pts': datetime.utcnow().isoformat(),
                }
            )

            print(f"Updated predictions for {item['entity_id']}: segment={segment}")

        except Exception as e:
            print(f"Error processing {item['entity_id']}: {e}")

    return {'statusCode': 200, 'processed': len(response['Items'])}
```

**Deployment:**
```bash
cd lambda/ai-analysis
pip install -r requirements.txt -t .
zip -r ai-analysis.zip .
```

**Add to CDK (cdk-stack.ts):**
```typescript
const aiLambda = new lambda.Function(this, 'AIFunction', {
  runtime: lambda.Runtime.PYTHON_3_12,
  handler: 'handler.lambda_handler',
  code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/ai-analysis')),
  role: this.lambdaExecutionRole,
  environment: {
    DYNAMODB_TABLE_NAME: this.metricsTable.tableName,
    SAGEMAKER_ENDPOINT_NAME: 'marketplace-health-endpoint',
    MODEL_TYPE: 'tensorflow_multi_task',
    FEATURE_COUNT: '46',
  },
  timeout: cdk.Duration.minutes(5),
  memorySize: 1024,
  description: 'AI inference with TensorFlow multi-task marketplace health model',
});

// Schedule every 5 minutes
const aiRule = new events.Rule(this, 'AIRefreshRule', {
  schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
});
aiRule.addTarget(new targets.LambdaFunction(aiLambda));
```

---

### Phase 3: Update CDK and Deploy (Day 2)

1. **Update cdk-stack.ts** with changes from Phase 2
2. **Deploy CDK:**
```bash
cd cdk
npx cdk deploy IOpsDashboard-CoreStack --require-approval never
```
3. **Verify deployment:**
```bash
aws lambda invoke --function-name IOpsDashboard-CoreStack-AIFunction /tmp/ai-test.json
cat /tmp/ai-test.json
```

---

### Phase 4: Update CloudWatch Alarms (Day 2)

**Add to cdk-stack.ts:**

```typescript
// High churn risk alarm
const highChurnAlarm = new cloudwatch.Alarm(this, 'HighChurnRateAlarm', {
  alarmName: 'iops-dashboard-high-churn-rate',
  metric: new cloudwatch.Metric({
    namespace: 'IOpsDashboard/Predictions',
    metricName: 'HighChurnRiskCount',
    statistic: 'Sum',
    period: cdk.Duration.minutes(5),
  }),
  threshold: 10,
  evaluationPeriods: 2,
  actionsEnabled: true,
  alarmDescription: 'Alert when 10+ customers have >70% churn risk',
});

highChurnAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.riskAlertTopic));

// Low health score alarm
const lowHealthAlarm = new cloudwatch.Alarm(this, 'LowHealthScoreAlarm', {
  alarmName: 'iops-dashboard-low-health-average',
  metric: new cloudwatch.Metric({
    namespace: 'IOpsDashboard/Predictions',
    metricName: 'AverageHealthScore',
    statistic: 'Average',
    period: cdk.Duration.minutes(15),
  }),
  threshold: 60,
  comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
  evaluationPeriods: 2,
  actionsEnabled: true,
  alarmDescription: 'Alert when average customer health score drops below 60',
});

lowHealthAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.riskAlertTopic));
```

**Publish metrics in AI Lambda:**
```python
cloudwatch = boto3.client('cloudwatch')

# Count high churn risk customers
high_churn_count = sum(1 for p in predictions if p['churn_risk_14d'] > 0.7)

cloudwatch.put_metric_data(
    Namespace='IOpsDashboard/Predictions',
    MetricData=[
        {
            'MetricName': 'HighChurnRiskCount',
            'Value': high_churn_count,
            'Unit': 'Count',
        },
        {
            'MetricName': 'AverageHealthScore',
            'Value': np.mean([p['health_score'] for p in predictions]),
            'Unit': 'None',
        },
    ]
)
```

---

### Phase 5: Testing (Day 3)

**Test Data:**
```json
{
  "entity_id": "student_test_123",
  "entity_type": "student",
  "sessions_7d": 2,
  "sessions_14d": 4,
  "sessions_30d": 8,
  "ib_calls_7d": 0,
  "ib_calls_14d": 1,
  "avg_rating": 4.2,
  "health_score": 75,
  "last_updated": "2025-11-07T12:00:00Z"
}
```

**Test Commands:**
```bash
# 1. Insert test data
aws dynamodb put-item \
  --table-name iops-dashboard-metrics \
  --item file://test-student.json

# 2. Trigger AI Lambda
aws lambda invoke \
  --function-name IOpsDashboard-CoreStack-AIFunction \
  --payload '{}' \
  /tmp/ai-result.json

# 3. Verify predictions
aws dynamodb get-item \
  --table-name iops-dashboard-metrics \
  --key '{"entity_id":{"S":"student_test_123"},"entity_type":{"S":"student"}}' \
  | jq '.Item | {
    churn_risk_14d: .churn_risk_14d.N,
    churn_risk_30d: .churn_risk_30d.N,
    health_score: .health_score.N,
    segment: .segment.S
  }'

# Expected output:
# {
#   "churn_risk_14d": "0.23",
#   "churn_risk_30d": "0.45",
#   "health_score": "65.2",
#   "segment": "at_risk"
# }
```

---

### Phase 6: Decommission Old Endpoint (Day 7+)

**After 1 week of successful operation:**

1. **Verify no usage of old endpoint:**
```bash
aws cloudwatch get-metric-statistics \
  --namespace AWS/SageMaker \
  --metric-name ModelInvocations \
  --dimensions Name=EndpointName,Value=iops-classifier-lite \
  --start-time 2025-11-01T00:00:00Z \
  --end-time 2025-11-08T00:00:00Z \
  --period 3600 \
  --statistics Sum
```

2. **Delete old endpoint:**
```bash
aws sagemaker delete-endpoint --endpoint-name iops-classifier-lite
aws sagemaker delete-endpoint-config --endpoint-config-name iops-classifier-lite
aws sagemaker delete-model --model-name iops-classifier-lite
```

3. **Remove from CDK:**
```typescript
// Remove old endpoint ARN from IAM permissions
resources: [
  `arn:aws:sagemaker:${this.region}:${this.account}:endpoint/marketplace-health-endpoint`,
  // DELETE: iops-classifier-lite reference
]
```

---

## Rollback Plan

**If issues occur in any phase:**

### Phase 1 Rollback (SageMaker endpoint issues)
```bash
# Delete problematic endpoint
aws sagemaker delete-endpoint --endpoint-name marketplace-health-endpoint

# No impact on current system (AI Lambda not deployed yet)
```

### Phase 2-3 Rollback (AI Lambda issues)
```bash
# Remove AI Lambda from CDK
# Comment out aiLambda and aiRule in cdk-stack.ts
npx cdk deploy IOpsDashboard-CoreStack

# System continues with basic aggregation (no ML predictions)
```

### Phase 4 Rollback (Alarm issues)
```bash
# Disable problematic alarms via AWS Console or CLI
aws cloudwatch disable-alarm-actions --alarm-names iops-dashboard-high-churn-rate
```

---

## Cost Analysis

**Current Monthly Cost:**
- SageMaker iops-classifier-lite: ~$0 (not seeing invocations)
- DynamoDB: ~$5 (pay-per-request)
- Lambda: ~$2
- **Total: ~$7/month**

**New Monthly Cost:**
- SageMaker marketplace-health-endpoint:
  - ml.t2.medium: $0.065/hr × 730 hrs = $47.45/month
  - ml.m5.xlarge (production): $0.269/hr × 730 hrs = $196.37/month
- DynamoDB: ~$5 (no change)
- Lambda: ~$5 (AI Lambda runs every 5 min)
- **Total: $57-206/month** (depending on instance size)

**Cost Optimization:**
- Start with ml.t2.medium ($57/month)
- Use SageMaker Serverless Inference if <10k predictions/day
- Implement endpoint auto-scaling for variable load

---

## Success Metrics

**Week 1:**
- [ ] New SageMaker endpoint deployed and InService
- [ ] AI Lambda successfully processing all students
- [ ] >95% prediction success rate
- [ ] <500ms average prediction latency

**Week 2:**
- [ ] Churn risk predictions correlate with actual churn (>70% accuracy)
- [ ] At-risk customers identified 14 days before churn
- [ ] CloudWatch alarms trigger for high-risk segments
- [ ] No increase in Lambda errors or timeouts

**Week 4:**
- [ ] Business stakeholders using predictions for interventions
- [ ] Model accuracy validated against holdout test set
- [ ] Old SageMaker endpoint deleted
- [ ] Documentation updated

---

## Next Steps

1. **Immediate (Today):**
   - Review and approve this migration plan
   - Create SageMaker execution role if missing
   - Verify S3 model file accessibility

2. **Tomorrow:**
   - Deploy marketplace-health-endpoint (Phase 1)
   - Implement 46-feature engineering function
   - Create AI Lambda (Phase 2)

3. **Day 2:**
   - Update CDK with AI Lambda
   - Deploy updated stack
   - Run initial tests

4. **Day 3:**
   - Comprehensive testing with production-like data
   - Monitor for 24 hours
   - Fix any issues

5. **Week 2:**
   - Validate predictions against business outcomes
   - Fine-tune alerting thresholds
   - Plan old endpoint decommission

---

## Contact & Support

**Technical Owner:** Tyler (tylerpohn@gmail.com)
**Model Training:** Already complete (s3://...marketplace-health-model-2025-11-07-00-19-38-650/)
**Infrastructure:** AWS SageMaker, Lambda, DynamoDB
**Monitoring:** CloudWatch, SNS alerts

**Questions or Issues:**
- Create GitHub issue in iops-dashboard repo
- Tag with `migration` and `sagemaker`
- Include error logs and reproduction steps
