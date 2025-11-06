# IOPS ML Training Pipeline

Complete machine learning training pipeline for IOPS Dashboard with AWS SageMaker integration.

## 📁 Scripts Overview

### 1. `generate-training-data.ts`
**Purpose:** Generate 10K synthetic IOPS insights and export to S3

**Features:**
- Generates 10,000 realistic IOPS insights with performance patterns
- Auto-labels 80% of data (8,000 records) with risk levels and performance scores
- Exports to DynamoDB table: `IOPSInsights`
- Uploads to S3: `s3://iops-ml-training/raw/`

**Usage:**
```bash
# Set environment variables
export AWS_REGION=us-east-1
export DYNAMODB_TABLE=IOPSInsights
export S3_BUCKET=iops-ml-training

# Install dependencies
npm install

# Run generation
npx ts-node scripts/ml/generate-training-data.ts

# Or add to package.json:
npm run generate:showcase
```

**Output:**
- DynamoDB: 10,000 records in `IOPSInsights` table
- S3: `s3://iops-ml-training/raw/insights-YYYY-MM-DD.json`

---

### 2. `feature-engineering.py`
**Purpose:** Extract 25 features from raw data and prepare train/val/test splits

**25 Features Extracted:**

#### IOPS Metrics (4)
- `read_iops` - Read IOPS count
- `write_iops` - Write IOPS count
- `total_iops` - Total IOPS (read + write)
- `iops_variance` - IOPS variance over time

#### Latency (4)
- `avg_latency` - Average latency (ms)
- `p95_latency` - 95th percentile latency
- `p99_latency` - 99th percentile latency
- `latency_spike_count` - Number of latency spikes (p99 > 2x avg)

#### Throughput (2)
- `bandwidth_mbps` - Bandwidth in MB/s
- `throughput_variance` - Throughput variance

#### Error Rates (2)
- `error_rate` - Error rate (0-1)
- `error_trend` - Error trend (-1: decreasing, 0: stable, 1: increasing)

#### Time-based (3)
- `hour_of_day` - Hour of day (0-23)
- `day_of_week` - Day of week (0-6)
- `time_since_last_alert` - Hours since last alert

#### Pattern (2)
- `sequential_access_ratio` - Sequential access ratio (0-1)
- `random_access_ratio` - Random access ratio (0-1)

#### Device (3)
- `queue_depth` - I/O queue depth
- `io_size_avg` - Average I/O size (KB)
- `io_size_variance` - I/O size variance

#### Derived (5)
- `iops_per_latency` - IOPS efficiency (IOPS / latency)
- `anomaly_score` - Anomaly detection score
- `trend_score` - Rate of change
- `load_factor` - System load (0-1)
- `efficiency_ratio` - Throughput per IOPS

**Data Split:**
- Training: 70% (~5,600 records)
- Validation: 15% (~1,200 records)
- Test: 15% (~1,200 records)

**Usage:**
```bash
# Install dependencies
pip install boto3 pandas numpy scikit-learn

# Run feature engineering
python3 scripts/ml/feature-engineering.py
```

**Output:**
- `s3://iops-ml-training/processed/train-YYYY-MM-DD.csv`
- `s3://iops-ml-training/processed/validation-YYYY-MM-DD.csv`
- `s3://iops-ml-training/processed/test-YYYY-MM-DD.csv`
- `s3://iops-ml-training/processed/feature-metadata-YYYY-MM-DD.json`

---

### 3. `train-sagemaker-model.py`
**Purpose:** Train XGBoost models on SageMaker with hyperparameter tuning

**Two Models:**

#### Model 1: Risk Level Classifier
- **Algorithm:** XGBoost Multi-class Classifier
- **Target:** `risk_level` (4 classes: low, medium, high, critical)
- **Objective:** `multi:softmax`
- **Metric:** Multi-class log loss (mlogloss)

#### Model 2: Performance Forecaster
- **Algorithm:** XGBoost Regressor
- **Target:** `performance_score` (0-100 continuous)
- **Objective:** `reg:squarederror`
- **Metric:** Root Mean Squared Error (RMSE)

**Hyperparameter Tuning:**
- **Strategy:** Bayesian Optimization
- **Max Jobs:** 50 per model
- **Parallel Jobs:** 5
- **Parameters Tuned:**
  - `eta` (learning rate): 0.01 - 0.3
  - `max_depth`: 3 - 10
  - `min_child_weight`: 1 - 10
  - `subsample`: 0.5 - 1.0
  - `colsample_bytree`: 0.5 - 1.0
  - `gamma`: 0 - 5
  - `alpha`: 0 - 2
  - `lambda`: 0 - 2

**Deployment Configuration:**
- **Instance Type:** `ml.t3.medium`
- **Auto-scaling:** 1-3 instances
- **Scaling Policy:** Target Tracking (70% invocations/instance)
- **Target Accuracy:** >90%

**Usage:**
```bash
# Install dependencies
pip install boto3 sagemaker

# Update SageMaker execution role in script
# Line 36: role = 'arn:aws:iam::YOUR_ACCOUNT:role/SageMakerExecutionRole'

# Run training
python3 scripts/ml/train-sagemaker-model.py
```

**Output:**
- **Endpoints:**
  - `iops-risk-classifier-endpoint-TIMESTAMP`
  - `iops-perf-regressor-endpoint-TIMESTAMP`
- **Models:** `s3://iops-ml-training/models/`
- **Metrics:** `s3://iops-ml-training/models/metrics/`

**Expected Runtime:**
- Training: 30-60 minutes per model (50 jobs)
- Deployment: 5-10 minutes per endpoint

---

## 🚀 Complete Workflow

### Step 1: Generate Training Data
```bash
# Generate 10K insights
npx ts-node scripts/ml/generate-training-data.ts
```

### Step 2: Feature Engineering
```bash
# Extract 25 features and split data
python3 scripts/ml/feature-engineering.py
```

### Step 3: Train Models
```bash
# Train and deploy with SageMaker
python3 scripts/ml/train-sagemaker-model.py
```

### Step 4: Integration (Next Steps)
1. Update Lambda functions to call SageMaker endpoints
2. Integrate predictions into API Gateway responses
3. Display ML predictions in React dashboard
4. Set up CloudWatch monitoring for endpoints

---

## 📊 Expected Results

### Data Generation
- ✅ 10,000 synthetic insights
- ✅ 80% auto-labeled (8,000 records)
- ✅ Realistic IOPS patterns and correlations

### Feature Engineering
- ✅ 25 features extracted
- ✅ 70/15/15 train/val/test split
- ✅ Normalized features with StandardScaler

### Model Training
- ✅ Risk classifier accuracy: >90%
- ✅ Performance forecaster RMSE: <10
- ✅ Auto-scaling endpoints deployed
- ✅ 50 hyperparameter tuning jobs per model

---

## 🔧 AWS Prerequisites

### IAM Permissions Required
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::iops-ml-training/*",
        "arn:aws:s3:::iops-ml-training"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:Scan",
        "dynamodb:BatchWriteItem"
      ],
      "Resource": "arn:aws:dynamodb:*:*:table/IOPSInsights"
    },
    {
      "Effect": "Allow",
      "Action": [
        "sagemaker:CreateTrainingJob",
        "sagemaker:CreateModel",
        "sagemaker:CreateEndpointConfig",
        "sagemaker:CreateEndpoint",
        "sagemaker:DescribeTrainingJob",
        "sagemaker:DescribeEndpoint"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "application-autoscaling:RegisterScalableTarget",
        "application-autoscaling:PutScalingPolicy"
      ],
      "Resource": "*"
    }
  ]
}
```

### S3 Bucket Setup
```bash
# Create S3 bucket
aws s3 mb s3://iops-ml-training --region us-east-1

# Create folder structure
aws s3api put-object --bucket iops-ml-training --key raw/
aws s3api put-object --bucket iops-ml-training --key processed/
aws s3api put-object --bucket iops-ml-training --key models/
```

### SageMaker Execution Role
```bash
# Create role with trust policy for SageMaker
aws iam create-role --role-name SageMakerExecutionRole \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "sagemaker.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }]
  }'

# Attach managed policies
aws iam attach-role-policy \
  --role-name SageMakerExecutionRole \
  --policy-arn arn:aws:iam::aws:policy/AmazonSageMakerFullAccess

aws iam attach-role-policy \
  --role-name SageMakerExecutionRole \
  --policy-arn arn:aws:iam::aws:policy/AmazonS3FullAccess
```

---

## 📈 Performance Expectations

### Training Performance
- **Classifier Training:** 30-60 min (50 jobs)
- **Regressor Training:** 30-60 min (50 jobs)
- **Total Training Time:** 1-2 hours

### Inference Performance
- **Latency:** <100ms per prediction
- **Throughput:** 1000+ predictions/sec (with auto-scaling)
- **Cost:** ~$0.05/hour per instance (ml.t3.medium)

### Model Accuracy
- **Classifier:** >90% accuracy (target)
- **Regressor:** RMSE <10 (target)

---

## 🎯 Next Integration Steps

### 1. Lambda Functions
```python
# Example: Call SageMaker endpoint from Lambda
import boto3

runtime = boto3.client('sagemaker-runtime')

response = runtime.invoke_endpoint(
    EndpointName='iops-risk-classifier-endpoint-TIMESTAMP',
    ContentType='text/csv',
    Body='1000,500,1500,50,...'  # 25 features
)

prediction = json.loads(response['Body'].read())
risk_level = ['low', 'medium', 'high', 'critical'][prediction[0]]
```

### 2. API Gateway Integration
- Add `/api/predict/risk` endpoint
- Add `/api/predict/performance` endpoint

### 3. Dashboard Updates
- Display ML predictions alongside real data
- Show confidence scores
- Add prediction explanations

---

## 📝 Monitoring

### CloudWatch Metrics
- `ModelLatency` - Prediction latency
- `ModelInvocations` - Number of predictions
- `ModelInvocationErrors` - Prediction errors
- `CPUUtilization` - Instance CPU usage
- `MemoryUtilization` - Instance memory usage

### Alerts
```bash
# Create CloudWatch alarm for high latency
aws cloudwatch put-metric-alarm \
  --alarm-name iops-ml-high-latency \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2 \
  --metric-name ModelLatency \
  --namespace AWS/SageMaker \
  --period 300 \
  --statistic Average \
  --threshold 500 \
  --dimensions Name=EndpointName,Value=iops-risk-classifier-endpoint-*
```

---

## 🐛 Troubleshooting

### Common Issues

**Issue:** S3 bucket not found
```bash
# Create bucket
aws s3 mb s3://iops-ml-training --region us-east-1
```

**Issue:** SageMaker role not found
```bash
# Update role ARN in train-sagemaker-model.py line 36
role = 'arn:aws:iam::YOUR_ACCOUNT_ID:role/SageMakerExecutionRole'
```

**Issue:** Training job fails
```bash
# Check CloudWatch logs
aws logs tail /aws/sagemaker/TrainingJobs --follow
```

**Issue:** Endpoint deployment fails
```bash
# Check endpoint status
aws sagemaker describe-endpoint --endpoint-name ENDPOINT_NAME
```

---

## 📚 Additional Resources

- [AWS SageMaker Documentation](https://docs.aws.amazon.com/sagemaker/)
- [XGBoost Algorithm](https://xgboost.readthedocs.io/)
- [SageMaker Python SDK](https://sagemaker.readthedocs.io/)
- [Auto-scaling Configuration](https://docs.aws.amazon.com/sagemaker/latest/dg/endpoint-auto-scaling.html)

---

**Author:** ML Training Pipeline Engineer
**Created:** 2025-11-05
**Version:** 1.0.0
