# ML Training Pipeline - Quick Start Guide

Get your IOPS ML models trained and deployed in 3 steps!

## 🚀 Quick Start (3 Commands)

```bash
# 1. Install Python dependencies
npm run ml:setup

# 2. Configure AWS credentials and environment
cp scripts/ml/.env.example scripts/ml/.env
# Edit .env with your AWS account details

# 3. Run complete pipeline (data generation → feature engineering → training)
npm run ml:pipeline
```

That's it! Your models will be trained and deployed to SageMaker endpoints in ~2 hours.

---

## 📋 Individual Steps (For Development)

### Step 1: Generate Training Data (10K insights)
```bash
npm run ml:generate

# Or with custom parameters:
export AWS_REGION=us-east-1
export DYNAMODB_TABLE=IOPSInsights
export S3_BUCKET=iops-ml-training
npx ts-node scripts/ml/generate-training-data.ts
```

**Output:**
- ✅ 10,000 insights in DynamoDB
- ✅ S3: `s3://iops-ml-training/raw/insights-YYYY-MM-DD.json`
- ✅ 80% auto-labeled (8,000 records)

**Time:** ~5 minutes

---

### Step 2: Feature Engineering (25 features)
```bash
npm run ml:features

# Or directly:
python3 scripts/ml/feature-engineering.py
```

**Output:**
- ✅ 25 features extracted
- ✅ Train/Val/Test split (70/15/15)
- ✅ Normalized datasets
- ✅ S3: `s3://iops-ml-training/processed/`

**Time:** ~2 minutes

---

### Step 3: Train & Deploy Models
```bash
npm run ml:train

# Or directly:
python3 scripts/ml/train-sagemaker-model.py
```

**Output:**
- ✅ Risk classifier endpoint (4 classes)
- ✅ Performance regressor endpoint (0-100 score)
- ✅ Auto-scaling: 1-3 instances
- ✅ Accuracy: >90%

**Time:** ~1-2 hours (50 hyperparameter tuning jobs per model)

---

## 🔧 Prerequisites

### 1. AWS CLI Configured
```bash
aws configure
# Enter your AWS Access Key ID, Secret Key, and Region
```

### 2. Python Dependencies
```bash
pip install -r scripts/ml/requirements.txt
```

### 3. Node.js Dependencies
```bash
npm install
```

### 4. S3 Bucket
```bash
aws s3 mb s3://iops-ml-training --region us-east-1
```

### 5. SageMaker Execution Role
Create a role with these policies:
- `AmazonSageMakerFullAccess`
- `AmazonS3FullAccess`

Get the role ARN:
```bash
aws iam get-role --role-name SageMakerExecutionRole --query 'Role.Arn'
```

Update in `scripts/ml/train-sagemaker-model.py` (line 36):
```python
role = 'arn:aws:iam::YOUR_ACCOUNT_ID:role/SageMakerExecutionRole'
```

---

## 📊 What You Get

### Two Production-Ready Models

#### 1. Risk Level Classifier
- **Input:** 25 features (IOPS metrics, latency, throughput, etc.)
- **Output:** Risk level (low, medium, high, critical)
- **Accuracy:** >90%
- **Endpoint:** `iops-risk-classifier-endpoint-TIMESTAMP`

#### 2. Performance Forecaster
- **Input:** 25 features
- **Output:** Performance score (0-100)
- **Metric:** RMSE <10
- **Endpoint:** `iops-perf-regressor-endpoint-TIMESTAMP`

### Auto-Scaling Configuration
- **Instance Type:** ml.t3.medium (~$0.05/hour)
- **Min Instances:** 1
- **Max Instances:** 3
- **Scaling Trigger:** 70% invocations per instance

### 25 Features Per Prediction
- IOPS metrics (4): read_iops, write_iops, total_iops, iops_variance
- Latency (4): avg, p95, p99, spike_count
- Throughput (2): bandwidth_mbps, variance
- Error rates (2): error_rate, trend
- Time-based (3): hour, day_of_week, time_since_alert
- Patterns (2): sequential_ratio, random_ratio
- Device (3): queue_depth, io_size_avg, io_size_variance
- Derived (5): iops_per_latency, anomaly_score, trend_score, load_factor, efficiency_ratio

---

## 🎯 Testing Your Endpoints

### Test Risk Classifier
```python
import boto3
import json

client = boto3.client('sagemaker-runtime')

# Example features (25 values)
features = [
    1000,  # read_iops
    500,   # write_iops
    1500,  # total_iops
    50.2,  # iops_variance
    # ... 21 more features
]

response = client.invoke_endpoint(
    EndpointName='iops-risk-classifier-endpoint-TIMESTAMP',
    ContentType='text/csv',
    Body=','.join(map(str, features))
)

prediction = json.loads(response['Body'].read())
risk_levels = ['low', 'medium', 'high', 'critical']
print(f"Risk Level: {risk_levels[int(prediction[0])]}")
```

### Test Performance Forecaster
```python
response = client.invoke_endpoint(
    EndpointName='iops-perf-regressor-endpoint-TIMESTAMP',
    ContentType='text/csv',
    Body=','.join(map(str, features))
)

prediction = json.loads(response['Body'].read())
print(f"Performance Score: {prediction[0]:.2f}/100")
```

---

## 💰 Cost Estimate

### Training (One-Time)
- **Hyperparameter Tuning:** 100 jobs total (50 per model)
- **Instance Type:** ml.m5.xlarge
- **Time:** ~2 hours
- **Cost:** ~$20-30

### Inference (Monthly)
- **Instance Type:** ml.t3.medium
- **Running:** 24/7 with auto-scaling (1-3 instances)
- **Average Load:** 2 instances
- **Cost:** ~$72/month (2 instances × $0.05/hour × 730 hours)

### Storage
- **Training Data:** ~100 MB
- **Model Artifacts:** ~50 MB
- **Cost:** ~$0.01/month

**Total Estimated Cost:** ~$75/month after initial setup

---

## 🐛 Troubleshooting

### Issue: "Role not found"
```bash
# Create SageMaker execution role
aws iam create-role --role-name SageMakerExecutionRole \
  --assume-role-policy-document file://trust-policy.json

# Attach policies
aws iam attach-role-policy \
  --role-name SageMakerExecutionRole \
  --policy-arn arn:aws:iam::aws:policy/AmazonSageMakerFullAccess
```

### Issue: "S3 bucket does not exist"
```bash
aws s3 mb s3://iops-ml-training --region us-east-1
```

### Issue: "No processed data found"
```bash
# Run feature engineering first
npm run ml:features
```

### Issue: "Training job failed"
```bash
# Check CloudWatch logs
aws logs tail /aws/sagemaker/TrainingJobs --follow
```

### Issue: "Endpoint deployment timeout"
```bash
# Check endpoint status
aws sagemaker describe-endpoint --endpoint-name ENDPOINT_NAME
```

---

## 📈 Monitoring Your Models

### CloudWatch Metrics
```bash
# View endpoint metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/SageMaker \
  --metric-name ModelLatency \
  --dimensions Name=EndpointName,Value=iops-risk-classifier-endpoint-* \
  --start-time 2025-01-01T00:00:00Z \
  --end-time 2025-01-05T00:00:00Z \
  --period 3600 \
  --statistics Average
```

### Key Metrics to Monitor
- **ModelLatency:** Should be <100ms
- **ModelInvocations:** Track usage patterns
- **ModelInvocationErrors:** Should be <1%
- **CPUUtilization:** Trigger for auto-scaling
- **MemoryUtilization:** Watch for memory leaks

---

## 🔄 Retraining Models

Models should be retrained periodically as new data comes in:

```bash
# Schedule monthly retraining
# Add to cron or AWS EventBridge

# 1. Generate fresh training data
npm run ml:generate

# 2. Re-run feature engineering
npm run ml:features

# 3. Train new models
npm run ml:train

# 4. A/B test new vs old endpoints
# 5. Gradually shift traffic to new endpoint
# 6. Delete old endpoint
```

---

## 🎉 Success Checklist

After running the pipeline, verify:

- [ ] ✅ 10,000 insights generated
- [ ] ✅ 25 features extracted
- [ ] ✅ Train/Val/Test splits created
- [ ] ✅ Classifier endpoint deployed
- [ ] ✅ Regressor endpoint deployed
- [ ] ✅ Auto-scaling configured
- [ ] ✅ CloudWatch metrics visible
- [ ] ✅ Test predictions working
- [ ] ✅ Accuracy >90%

---

## 📞 Support

### Documentation
- Main README: `scripts/ml/README.md`
- Feature Details: `scripts/ml/feature-engineering.py`
- Training Details: `scripts/ml/train-sagemaker-model.py`

### AWS Resources
- [SageMaker Console](https://console.aws.amazon.com/sagemaker)
- [CloudWatch Logs](https://console.aws.amazon.com/cloudwatch)
- [S3 Bucket](https://console.aws.amazon.com/s3)

---

**Ready to go?** Run `npm run ml:pipeline` and grab a coffee! ☕

Your models will be production-ready in ~2 hours.
