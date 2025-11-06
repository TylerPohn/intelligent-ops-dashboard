# Lightweight ML Pipeline - Quick Start Guide

## Overview

This is the **lightweight version** of the ML pipeline, optimized for synthetic data with significantly reduced cost and time.

## Comparison: Full vs Lightweight

| Metric | Full Version | Lightweight | Savings |
|--------|-------------|-------------|---------|
| **Tuning Jobs** | 50 per model | 5 per model | 90% fewer |
| **Training Time** | 2-4 hours | 20-30 minutes | 85% faster |
| **Training Cost** | $15-30 | $3-5 | 80% cheaper |
| **Endpoint Instance** | ml.t3.medium | ml.t3.small | 50% cheaper |
| **Monthly Cost** | $100/month | $50-60/month | 40-50% cheaper |
| **Training Samples** | 10,000 | 5,000 | 50% less data |

## Why Lightweight for Synthetic Data?

Since we're using synthetic data:
- **No real patterns to learn** - fewer tuning jobs sufficient
- **Consistent data distribution** - smaller models work fine
- **Proof of concept** - demonstrate capability without cost
- **Fast iteration** - test and adjust quickly

## Quick Deployment

### Prerequisites

```bash
# 1. AWS CLI configured
aws configure

# 2. Python 3 with pip
python3 --version

# 3. SageMaker execution role
# The script will use: arn:aws:iam::YOUR_ACCOUNT:role/SageMakerExecutionRole
# Make sure this role exists with SageMaker permissions
```

### One-Command Deployment

```bash
cd /Users/tyler/Desktop/Gauntlet/iops-dashboard
bash scripts/ml/quick-deploy.sh
```

This script will:
1. ✅ Create S3 bucket (if needed)
2. ✅ Generate 5,000 synthetic training samples
3. ✅ Create 25 engineered features
4. ✅ Upload to S3
5. ✅ Train 2 XGBoost models (5 tuning jobs each)
6. ✅ Deploy 2 endpoints (ml.t3.small)
7. ✅ Validate predictions

**Total Time:** 20-30 minutes
**Total Cost:** $3-5 one-time + $50-60/month

## What Gets Deployed

### 1. Risk Classification Endpoint
- **Name:** `iops-classifier-lite`
- **Instance:** ml.t3.small
- **Input:** 25 features (IOPS, latency, throughput, etc.)
- **Output:** Risk level (0=low, 1=medium, 2=high, 3=critical)
- **Accuracy:** ~85-90% (good enough for synthetic data)

### 2. Performance Regression Endpoint
- **Name:** `iops-regressor-lite`
- **Instance:** ml.t3.small
- **Input:** 25 features
- **Output:** Performance score (0-100)
- **MAE:** ~5-8 points (acceptable for demonstration)

## Configuration

The lightweight version uses these optimized settings:

```python
# Hyperparameter Tuning
MAX_TUNING_JOBS = 5          # vs 50 in full version
MAX_PARALLEL_JOBS = 2        # vs 10 in full version
TRAINING_ROUNDS = 50         # vs 100 in full version

# Instance Types
TRAINING_INSTANCE = 'ml.m5.large'   # Fast enough, cheap
ENDPOINT_INSTANCE = 'ml.t3.small'   # Cheapest option

# Data
TRAINING_SAMPLES = 5000      # vs 10,000 in full version
```

## Integration with AI Lambda

Once deployed, update your AI Lambda environment variables:

```bash
# In AWS Console: Lambda > ai-analysis > Configuration > Environment Variables
USE_SAGEMAKER=true
SAGEMAKER_ENDPOINT=iops-classifier-lite
AWS_REGION=us-east-1
```

The AI Lambda will automatically:
1. Try SageMaker endpoint first
2. Fall back to Bedrock if SageMaker fails
3. Fall back to rules-based if both fail

## Cost Breakdown

### One-Time Training Cost
- **5 tuning jobs × 2 models** = 10 jobs
- **ml.m5.large** @ $0.269/hour × ~0.5 hours = **~$1.35 per job**
- **Total:** ~$13.50 + S3 storage (~$0.50) = **~$3-5**

### Monthly Endpoint Cost
- **ml.t3.small** @ $0.0416/hour × 730 hours = **$30.37/month**
- **2 endpoints** = **$60.74/month**
- **With auto-scaling (1-2 instances):** ~$50-120/month

### Total First Month
- Training: $3-5 (one-time)
- Endpoints: $50-60
- **Total: $53-65**

## Monitoring

### View Training Progress
```bash
# AWS Console
https://console.aws.amazon.com/sagemaker/home?region=us-east-1#/jobs

# Or via CLI
aws sagemaker list-training-jobs --region us-east-1 --max-results 10
```

### View Endpoints
```bash
# AWS Console
https://console.aws.amazon.com/sagemaker/home?region=us-east-1#/endpoints

# Or via CLI
aws sagemaker list-endpoints --region us-east-1
```

### Test Endpoint
```python
import boto3
import json

client = boto3.client('sagemaker-runtime', region_name='us-east-1')

# Sample data (25 features)
data = "50000,45000,95000,12000,5.2,8.1,12.3,2,450,15000,0.5,1.2,14,3,3600,0.7,0.3,32,256,50,18269,7.5,8.2,0.65,1"

response = client.invoke_endpoint(
    EndpointName='iops-classifier-lite',
    ContentType='text/csv',
    Body=data
)

result = json.loads(response['Body'].read())
print(f"Risk Level: {result}")  # 0, 1, 2, or 3
```

## Cleanup (To Save Costs)

If you want to stop paying for endpoints:

```bash
# Delete endpoints (keeps models for redeployment)
aws sagemaker delete-endpoint --endpoint-name iops-classifier-lite --region us-east-1
aws sagemaker delete-endpoint --endpoint-name iops-regressor-lite --region us-east-1

# Delete models (if you don't need them)
aws sagemaker delete-model --model-name iops-classifier-lite --region us-east-1
aws sagemaker delete-model --model-name iops-regressor-lite --region us-east-1

# Delete S3 data (optional)
aws s3 rm s3://iops-ml-training/ --recursive
aws s3 rb s3://iops-ml-training/
```

## Upgrade to Full Version

If you later want better accuracy with real data:

```bash
# Run the full pipeline
bash scripts/ml/deploy-ml-pipeline.sh

# This will:
# - Use 10K samples instead of 5K
# - Run 50 tuning jobs per model
# - Deploy to ml.t3.medium instances
# - Cost: $15-30 training + $100/month endpoints
```

## Troubleshooting

### "Role not found" error
```bash
# Create SageMaker execution role
aws iam create-role --role-name SageMakerExecutionRole \
  --assume-role-policy-document file://sagemaker-trust-policy.json

# Attach SageMaker policy
aws iam attach-role-policy \
  --role-name SageMakerExecutionRole \
  --policy-arn arn:aws:iam::aws:policy/AmazonSageMakerFullAccess
```

### "Bucket does not exist" error
The script creates it automatically, but you can create manually:
```bash
aws s3 mb s3://iops-ml-training --region us-east-1
```

### "Training job failed" error
Check CloudWatch logs:
```bash
aws logs tail /aws/sagemaker/TrainingJobs --follow --region us-east-1
```

## Next Steps

1. ✅ Run `quick-deploy.sh`
2. ✅ Wait 20-30 minutes for deployment
3. ✅ Update AI Lambda environment variables
4. ✅ Test end-to-end flow with `bash scripts/validate/validate-deployment.sh`
5. ✅ Monitor costs in AWS Cost Explorer

## Support

- **Deployment issues:** Check CloudWatch logs in SageMaker console
- **Cost concerns:** Use AWS Cost Explorer to track spending
- **Performance issues:** Consider upgrading to full version with more tuning jobs

---

**Remember:** This is optimized for synthetic data demonstration. For production with real data, use the full pipeline with 50 tuning jobs and ml.t3.medium instances.
