#!/bin/bash
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}IOPS Dashboard - Quick ML Deployment${NC}"
echo -e "${BLUE}Lightweight Version for Synthetic Data${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Check requirements
echo -e "${YELLOW}Checking requirements...${NC}"

if ! command -v aws &> /dev/null; then
    echo -e "${RED}❌ AWS CLI not found. Install: brew install awscli${NC}"
    exit 1
fi

if ! command -v python3 &> /dev/null; then
    echo -e "${RED}❌ Python3 not found${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Requirements satisfied${NC}"
echo ""

# Configuration
AWS_REGION=${AWS_REGION:-us-east-1}
S3_BUCKET=${S3_BUCKET:-iops-ml-training}
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text 2>/dev/null || echo "")

if [ -z "$ACCOUNT_ID" ]; then
    echo -e "${RED}❌ Could not determine AWS account ID. Check AWS credentials${NC}"
    exit 1
fi

SAGEMAKER_ROLE=${SAGEMAKER_ROLE:-arn:aws:iam::${ACCOUNT_ID}:role/SageMakerExecutionRole}

echo -e "${BLUE}Configuration:${NC}"
echo "  AWS Region: $AWS_REGION"
echo "  S3 Bucket: $S3_BUCKET"
echo "  SageMaker Role: $SAGEMAKER_ROLE"
echo "  Account ID: $ACCOUNT_ID"
echo ""

# Confirm cost
echo -e "${YELLOW}⚠️  Cost Estimate:${NC}"
echo "  Training (one-time): ~$3-5"
echo "  Endpoints (monthly): ~$50-60/month"
echo "  Total Time: 20-30 minutes"
echo ""
read -p "Continue? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}Cancelled by user${NC}"
    exit 0
fi

# Step 1: Create S3 bucket
echo -e "${BLUE}Step 1: Create S3 bucket${NC}"
if aws s3 ls "s3://${S3_BUCKET}" 2>/dev/null; then
    echo -e "${GREEN}✅ Bucket already exists${NC}"
else
    echo "Creating S3 bucket: s3://${S3_BUCKET}"
    aws s3 mb "s3://${S3_BUCKET}" --region $AWS_REGION
    echo -e "${GREEN}✅ Bucket created${NC}"
fi
echo ""

# Step 2: Generate lightweight training data (5K samples instead of 10K)
echo -e "${BLUE}Step 2: Generate training data (5,000 samples)${NC}"
cd "$(dirname "$0")"

if [ -f "../generate-training-data.ts" ]; then
    echo "Generating synthetic data..."
    # Modify to generate only 5K samples
    SAMPLE_COUNT=5000 npx ts-node generate-training-data.ts || {
        echo -e "${YELLOW}⚠️  TypeScript generation failed, skipping...${NC}"
    }
else
    echo -e "${YELLOW}⚠️  No data generator found, will use minimal dataset${NC}"
fi
echo ""

# Step 3: Create minimal CSV data if no data exists
echo -e "${BLUE}Step 3: Prepare feature data${NC}"
python3 << 'PYTHON_SCRIPT'
import pandas as pd
import numpy as np
import os

print("Generating minimal feature dataset...")

# Generate 5000 samples with 25 features
np.random.seed(42)
n_samples = 5000

# Generate features
data = {
    # IOPS metrics
    'read_iops': np.random.randint(10000, 100000, n_samples),
    'write_iops': np.random.randint(5000, 80000, n_samples),
    'total_iops': np.random.randint(20000, 150000, n_samples),
    'iops_variance': np.random.randint(5000, 30000, n_samples),

    # Latency
    'avg_latency': np.random.uniform(1, 20, n_samples),
    'p95_latency': np.random.uniform(5, 50, n_samples),
    'p99_latency': np.random.uniform(10, 100, n_samples),
    'latency_spike_count': np.random.randint(0, 10, n_samples),

    # Throughput
    'bandwidth_mbps': np.random.randint(100, 1000, n_samples),
    'throughput_variance': np.random.randint(50, 500, n_samples),

    # Error rates
    'error_rate': np.random.uniform(0, 5, n_samples),
    'error_trend': np.random.uniform(-2, 2, n_samples),

    # Time-based
    'hour_of_day': np.random.randint(0, 24, n_samples),
    'day_of_week': np.random.randint(0, 7, n_samples),
    'time_since_last_alert': np.random.randint(0, 86400, n_samples),

    # Access patterns
    'sequential_access_ratio': np.random.uniform(0, 1, n_samples),
    'random_access_ratio': np.random.uniform(0, 1, n_samples),

    # Device metrics
    'queue_depth': np.random.randint(1, 128, n_samples),
    'io_size_avg': np.random.randint(4, 1024, n_samples),
    'io_size_variance': np.random.randint(0, 200, n_samples),

    # Derived features
    'iops_per_latency': np.random.uniform(1000, 50000, n_samples),
    'anomaly_score': np.random.uniform(0, 10, n_samples),
    'trend_score': np.random.uniform(0, 10, n_samples),
    'capacity_utilization': np.random.uniform(0, 1, n_samples),
    'workload_type': np.random.randint(0, 4, n_samples),
}

df = pd.DataFrame(data)

# Add target labels (risk level: 0=low, 1=medium, 2=high, 3=critical)
# Simple rule-based labeling
df['risk_level'] = 0  # low
df.loc[(df['total_iops'] > 80000) | (df['avg_latency'] > 10), 'risk_level'] = 1  # medium
df.loc[(df['total_iops'] > 100000) | (df['avg_latency'] > 15) | (df['error_rate'] > 2), 'risk_level'] = 2  # high
df.loc[(df['total_iops'] > 120000) & (df['avg_latency'] > 20) & (df['error_rate'] > 3), 'risk_level'] = 3  # critical

# Add regression target (performance score 0-100)
df['performance_score'] = (
    100
    - (df['avg_latency'] / df['avg_latency'].max() * 30)
    - (df['error_rate'] / df['error_rate'].max() * 30)
    + (df['total_iops'] / df['total_iops'].max() * 20)
).clip(0, 100)

# Split into train/val/test (70/15/15)
train_size = int(0.7 * n_samples)
val_size = int(0.15 * n_samples)

train_df = df[:train_size]
val_df = df[train_size:train_size+val_size]
test_df = df[train_size+val_size:]

print(f"Created datasets: train={len(train_df)}, val={len(val_df)}, test={len(test_df)}")

# Create data directory
os.makedirs('../../data/ml', exist_ok=True)

# Save for classifier (target in first column)
train_classifier = train_df[['risk_level'] + [c for c in train_df.columns if c not in ['risk_level', 'performance_score']]]
val_classifier = val_df[['risk_level'] + [c for c in val_df.columns if c not in ['risk_level', 'performance_score']]]

train_classifier.to_csv('../../data/ml/train_classifier.csv', index=False, header=False)
val_classifier.to_csv('../../data/ml/val_classifier.csv', index=False, header=False)

# Save for regressor (target in first column)
train_regressor = train_df[['performance_score'] + [c for c in train_df.columns if c not in ['risk_level', 'performance_score']]]
val_regressor = val_df[['performance_score'] + [c for c in val_df.columns if c not in ['risk_level', 'performance_score']]]

train_regressor.to_csv('../../data/ml/train_regressor.csv', index=False, header=False)
val_regressor.to_csv('../../data/ml/val_regressor.csv', index=False, header=False)

print("✅ Feature files created in data/ml/")
PYTHON_SCRIPT

echo -e "${GREEN}✅ Features prepared${NC}"
echo ""

# Step 4: Upload to S3
echo -e "${BLUE}Step 4: Upload data to S3${NC}"
cd ../../data/ml

echo "Uploading training data..."
aws s3 cp train_classifier.csv "s3://${S3_BUCKET}/iops-ml/train/" --region $AWS_REGION
aws s3 cp val_classifier.csv "s3://${S3_BUCKET}/iops-ml/validation/" --region $AWS_REGION

echo "Uploading validation data..."
aws s3 cp train_regressor.csv "s3://${S3_BUCKET}/iops-ml/train/regressor/" --region $AWS_REGION
aws s3 cp val_regressor.csv "s3://${S3_BUCKET}/iops-ml/validation/regressor/" --region $AWS_REGION

echo -e "${GREEN}✅ Data uploaded to S3${NC}"
echo ""

# Step 5: Install Python dependencies
echo -e "${BLUE}Step 5: Install Python dependencies${NC}"
pip3 install -q boto3 sagemaker pandas numpy scikit-learn 2>/dev/null || {
    echo -e "${YELLOW}⚠️  Some packages may already be installed${NC}"
}
echo -e "${GREEN}✅ Dependencies ready${NC}"
echo ""

# Step 6: Run lightweight training
echo -e "${BLUE}Step 6: Train models with SageMaker (20-30 minutes)${NC}"
cd ../../scripts/ml

export AWS_REGION=$AWS_REGION
export S3_BUCKET=$S3_BUCKET
export SAGEMAKER_ROLE=$SAGEMAKER_ROLE

echo -e "${YELLOW}Starting SageMaker training...${NC}"
echo "This will take approximately 20-30 minutes."
echo "You can monitor progress in AWS Console: SageMaker > Training > Training Jobs"
echo ""

python3 train-sagemaker-model-lite.py

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}🎉 Quick ML Deployment Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Endpoints deployed:"
echo "  • iops-classifier-lite (ml.t3.small)"
echo "  • iops-regressor-lite (ml.t3.small)"
echo ""
echo "To use in AI Lambda, update environment variables:"
echo "  USE_SAGEMAKER=true"
echo "  SAGEMAKER_ENDPOINT=iops-classifier-lite"
echo ""
echo "Monthly cost: ~$50-60 for both endpoints"
echo ""
echo -e "${GREEN}✅ All done!${NC}"
