# SageMaker Training Guide

## Overview

This guide shows you how to generate training data, upload to S3, and train your marketplace health model directly on SageMaker (no local training needed).

## S3 Bucket Structure

```
s3://iops-dashboard-ml-data/
└── marketplace-health-model/
    ├── train/
    │   ├── train.jsonl       # Training data
    │   └── train.csv         # For inspection
    ├── validation/
    │   └── validation.jsonl  # Validation data
    ├── test/
    │   └── test.jsonl        # Test data
    ├── models/
    │   └── marketplace-health-model-2025-01-06-12-34-56/
    │       └── model.tar.gz  # Trained model artifact
    └── training-jobs/
        └── logs/             # Training logs
```

---

## Step 1: Prerequisites

### Install Dependencies

```bash
# Node.js dependencies (for data generation)
npm install

# Python dependencies (for SageMaker)
pip install boto3 sagemaker
```

### AWS Configuration

```bash
# Configure AWS CLI
aws configure
# Enter your AWS Access Key ID, Secret Access Key, Region (us-east-1)

# Verify configuration
aws sts get-caller-identity
```

### Create SageMaker Execution Role

**Option A: AWS Console (Easiest)**

1. Go to [IAM Console](https://console.aws.amazon.com/iam/)
2. Click **Roles** → **Create role**
3. Select **AWS service** → **SageMaker**
4. Click **Next**
5. Attach policies:
   - `AmazonSageMakerFullAccess`
   - `AmazonS3FullAccess`
6. Click **Next**
7. Name: `SageMakerExecutionRole`
8. Click **Create role**
9. Copy the **Role ARN** (looks like: `arn:aws:iam::123456789012:role/SageMakerExecutionRole`)

**Option B: AWS CLI**

```bash
# Create role
aws iam create-role \
  --role-name SageMakerExecutionRole \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "sagemaker.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }]
  }'

# Attach policies
aws iam attach-role-policy \
  --role-name SageMakerExecutionRole \
  --policy-arn arn:aws:iam::aws:policy/AmazonSageMakerFullAccess

aws iam attach-role-policy \
  --role-name SageMakerExecutionRole \
  --policy-arn arn:aws:iam::aws:policy/AmazonS3FullAccess

# Get role ARN
aws iam get-role --role-name SageMakerExecutionRole --query 'Role.Arn' --output text
```

---

## Step 2: Generate Training Data

```bash
cd scripts
npx ts-node generate-training-data.ts
```

**Output:**
```
=== Tutor Marketplace Training Data Generator ===

Generating 10000 customer records...
Generated 10000/10000 records...

=== Dataset Statistics ===
Segment Distribution:
  thriving: 3012 (30.1%)
  healthy: 3998 (40.0%)
  at_risk: 1994 (19.9%)
  churned: 996 (10.0%)

✅ Training data generation complete!

Files created:
  data/train.jsonl (7000 records)
  data/validation.jsonl (1500 records)
  data/test.jsonl (1500 records)
```

---

## Step 3: Upload Data to S3

### Option A: Using Script (Recommended)

```bash
cd scripts
npx ts-node upload-training-data-to-s3.ts
```

**Output:**
```
=== Upload Training Data to S3 ===

✅ Bucket iops-dashboard-ml-data exists
Uploading training data...
✅ Uploaded: s3://iops-dashboard-ml-data/marketplace-health-model/train/train.jsonl
✅ Uploaded: s3://iops-dashboard-ml-data/marketplace-health-model/validation/validation.jsonl
✅ Uploaded: s3://iops-dashboard-ml-data/marketplace-health-model/test/test.jsonl
✅ Uploaded: s3://iops-dashboard-ml-data/marketplace-health-model/train/train.csv

=== S3 Paths ===
Training data:
  s3://iops-dashboard-ml-data/marketplace-health-model/train/
Validation data:
  s3://iops-dashboard-ml-data/marketplace-health-model/validation/
Test data:
  s3://iops-dashboard-ml-data/marketplace-health-model/test/
Models (output):
  s3://iops-dashboard-ml-data/marketplace-health-model/models/
```

### Option B: Manual Upload (AWS CLI)

```bash
# Create bucket (if doesn't exist)
aws s3 mb s3://iops-dashboard-ml-data

# Upload files
aws s3 cp data/train.jsonl s3://iops-dashboard-ml-data/marketplace-health-model/train/
aws s3 cp data/validation.jsonl s3://iops-dashboard-ml-data/marketplace-health-model/validation/
aws s3 cp data/test.jsonl s3://iops-dashboard-ml-data/marketplace-health-model/test/

# Verify
aws s3 ls s3://iops-dashboard-ml-data/marketplace-health-model/ --recursive
```

---

## Step 4: Train on SageMaker

### Quick Start (Wait for completion & deploy)

```bash
cd scripts
python train-on-sagemaker.py \
  --role-name SageMakerExecutionRole \
  --epochs 50 \
  --batch-size 64 \
  --wait \
  --deploy
```

### Custom Training (Advanced)

```bash
# Train without waiting (async)
python train-on-sagemaker.py \
  --role-arn arn:aws:iam::123456789012:role/SageMakerExecutionRole \
  --epochs 100 \
  --batch-size 128 \
  --learning-rate 0.0005

# Monitor later
aws sagemaker describe-training-job \
  --training-job-name marketplace-health-model-2025-01-06-12-34-56
```

### Training Output

```
=== SageMaker Training Job Configuration ===

Training data: s3://iops-dashboard-ml-data/marketplace-health-model/train/
Validation data: s3://iops-dashboard-ml-data/marketplace-health-model/validation/
Output path: s3://iops-dashboard-ml-data/marketplace-health-model/models/
Instance type: ml.m5.xlarge
Hyperparameters: {
  "epochs": 50,
  "batch-size": 64,
  "learning-rate": 0.001
}

🚀 Starting training job...

2025-01-06 12:34:56 Starting - Starting the training job...
2025-01-06 12:36:12 Starting - Launching requested ML instances...
2025-01-06 12:37:45 Starting - Preparing the instances for training...
2025-01-06 12:39:20 Downloading - Downloading input data...
2025-01-06 12:40:15 Training - Training image download completed. Training in progress...

Epoch 1/50
109/109 [==============================] - 2s - loss: 2.34 - val_loss: 1.89
Epoch 2/50
109/109 [==============================] - 1s - loss: 1.78 - val_loss: 1.65
...
Epoch 35/50
109/109 [==============================] - 1s - loss: 0.82 - val_loss: 0.81

Early stopping triggered.

2025-01-06 12:55:30 Uploading - Uploading generated training model
2025-01-06 12:56:45 Completed - Training job completed

✅ Training completed successfully!
Model artifact: s3://iops-dashboard-ml-data/marketplace-health-model/models/marketplace-health-model-2025-01-06-12-34-56/output/model.tar.gz

=== Final Metrics ===
  train:loss: 0.8234
  validation:loss: 0.8145
  first_session_success_auc: 0.9123
  churn_risk_14d_auc: 0.8964
  churn_risk_30d_auc: 0.9031
  health_score_mae: 8.76
```

---

## Step 5: Deploy Endpoint (Optional)

If you didn't use `--deploy` flag during training:

```bash
# Get model artifact path from training output
MODEL_DATA="s3://iops-dashboard-ml-data/marketplace-health-model/models/marketplace-health-model-2025-01-06-12-34-56/output/model.tar.gz"

# Deploy using AWS CLI or script
python deploy-endpoint.py \
  --model-data $MODEL_DATA \
  --endpoint-name marketplace-health-endpoint
```

**Deployment Progress:**
```
🚀 Deploying model to endpoint: marketplace-health-endpoint
Creating model: marketplace-health-endpoint-1736169845
✅ Model created
Creating endpoint config: marketplace-health-endpoint-config-1736169845
✅ Endpoint config created
Creating new endpoint: marketplace-health-endpoint

⏳ Waiting for endpoint to be in service (this takes 5-10 minutes)...

✅ Endpoint deployed: marketplace-health-endpoint

Endpoint ARN: arn:aws:sagemaker:us-east-1:123456789012:endpoint/marketplace-health-endpoint
```

---

## Step 6: Test Endpoint

### Python Test

```python
import boto3
import json

runtime = boto3.client('sagemaker-runtime', region_name='us-east-1')

# Example customer features (59 features)
payload = {
    'features': [
        2, 4, 8,  # session_count (7d, 14d, 30d)
        0.28, 0.28, 0.28,  # session_frequency
        4.2, 4.2, 4.2,  # avg_rating
        0.05, 0.05, 0.05,  # cancellation_rate
        1, 2, 4,  # ib_call_count
        0, 1, 2,  # negative_calls
        15, 18, 20, 5,  # days_since (session, login, payment, ib_call)
        120, 24, 1800,  # tenure, sessions, spend
        1, 0, 2,  # tier, channel, grade
        3, 6, 12,  # login_count
        5, 10, 20,  # message_count
        0.95, 0.95, 0.95,  # payment_success_rate
        0.75, 4.3, 2, 3.5,  # tutor_consistency, rating, switches, response_time
        1,  # first_session_success
        -0.15, -0.2, -2,  # velocity_change, rating_trend, engagement_trend
        5,  # primary_subject
    ]
}

response = runtime.invoke_endpoint(
    EndpointName='marketplace-health-endpoint',
    ContentType='application/json',
    Body=json.dumps(payload)
)

result = json.loads(response['Body'].read())
print(json.dumps(result, indent=2))
```

**Output:**
```json
{
  "predictions": {
    "first_session_success": 0.68,
    "session_velocity": 0.28,
    "churn_risk_14d": 0.73,
    "churn_risk_30d": 0.84,
    "health_score": 42.3
  }
}
```

### AWS CLI Test

```bash
# Create payload file
cat > payload.json <<EOF
{
  "features": [2, 4, 8, 0.28, 0.28, 0.28, 4.2, 4.2, 4.2, 0.05, 0.05, 0.05, 1, 2, 4, 0, 1, 2, 15, 18, 20, 5, 120, 24, 1800, 1, 0, 2, 3, 6, 12, 5, 10, 20, 0.95, 0.95, 0.95, 0.75, 4.3, 2, 3.5, 1, -0.15, -0.2, -2, 5]
}
EOF

# Invoke endpoint
aws sagemaker-runtime invoke-endpoint \
  --endpoint-name marketplace-health-endpoint \
  --content-type application/json \
  --body file://payload.json \
  output.json

# View result
cat output.json | jq '.'
```

---

## Cost Breakdown

### Training Costs

| Instance | Price/Hour | Training Time | Total |
|----------|-----------|---------------|-------|
| ml.m5.xlarge | $0.269 | ~20 minutes | **$0.09** |
| ml.m5.2xlarge | $0.538 | ~10 minutes | **$0.09** |

**One-time cost:** ~$0.10 per training run

### Endpoint Costs (If Deployed)

| Instance | Price/Hour | Monthly (24/7) |
|----------|-----------|----------------|
| ml.t3.medium | $0.065 | **$46.80** |
| ml.m5.large | $0.134 | **$96.48** |
| ml.m5.xlarge | $0.269 | **$193.68** |

**Recommendation:** Start with ml.t3.medium, scale up if needed.

### S3 Storage Costs

- Training data: ~50 MB = **$0.001/month**
- Model artifacts: ~200 MB = **$0.005/month**

**Total storage:** ~$0.01/month (negligible)

---

## Troubleshooting

### Error: "No such entity: role/SageMakerExecutionRole"

**Solution:** Create the IAM role (see Step 1)

### Error: "ResourceLimitExceeded"

**Solution:** You've hit SageMaker instance limits. Request limit increase:
```bash
aws service-quotas request-service-quota-increase \
  --service-code sagemaker \
  --quota-code L-D9C0EF5C \
  --desired-value 2
```

### Training job fails with "Out of memory"

**Solutions:**
1. Reduce batch size: `--batch-size 32`
2. Use larger instance: `ml.m5.2xlarge`
3. Reduce model size (edit architecture in training script)

### Endpoint takes too long to respond (>5 seconds)

**Solutions:**
1. Use ml.m5.large instead of ml.t3.medium
2. Enable auto-scaling
3. Add model caching

### "Access Denied" when accessing S3

**Solution:** Ensure SageMaker role has S3 permissions:
```bash
aws iam attach-role-policy \
  --role-name SageMakerExecutionRole \
  --policy-arn arn:aws:iam::aws:policy/AmazonS3FullAccess
```

---

## Monitoring & Logs

### View Training Logs

```bash
# List training jobs
aws sagemaker list-training-jobs --max-results 10

# Get specific job details
aws sagemaker describe-training-job \
  --training-job-name marketplace-health-model-2025-01-06-12-34-56

# View CloudWatch logs
aws logs tail /aws/sagemaker/TrainingJobs --follow
```

### Monitor Endpoint

```bash
# Check endpoint status
aws sagemaker describe-endpoint \
  --endpoint-name marketplace-health-endpoint

# View invocation metrics (CloudWatch)
aws cloudwatch get-metric-statistics \
  --namespace AWS/SageMaker \
  --metric-name ModelLatency \
  --dimensions Name=EndpointName,Value=marketplace-health-endpoint \
  --start-time 2025-01-06T00:00:00Z \
  --end-time 2025-01-06T23:59:59Z \
  --period 3600 \
  --statistics Average
```

---

## Next Steps

1. ✅ Generate training data
2. ✅ Upload to S3
3. ✅ Train on SageMaker
4. ✅ Deploy endpoint (optional)
5. ⏳ Integrate with Lambda
6. ⏳ Connect to Kinesis stream
7. ⏳ Build alerting dashboard

See `LAMBDA_INTEGRATION.md` for next steps.

---

## Quick Reference

### Generate & Upload Data
```bash
npx ts-node scripts/generate-training-data.ts
npx ts-node scripts/upload-training-data-to-s3.ts
```

### Train Model
```bash
python scripts/train-on-sagemaker.py --wait --deploy
```

### Test Endpoint
```bash
aws sagemaker-runtime invoke-endpoint \
  --endpoint-name marketplace-health-endpoint \
  --content-type application/json \
  --body file://payload.json \
  output.json
```

### Delete Endpoint (Stop Billing)
```bash
aws sagemaker delete-endpoint --endpoint-name marketplace-health-endpoint
aws sagemaker delete-endpoint-config --endpoint-config-name marketplace-health-endpoint-config-*
aws sagemaker delete-model --model-name marketplace-health-endpoint-*
```
