#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${BLUE}[ML]${NC} $1"; }
log_success() { echo -e "${GREEN}[ML] ✓${NC} $1"; }
log_error() { echo -e "${RED}[ML] ✗${NC} $1"; }
log_warning() { echo -e "${YELLOW}[ML] ⚠${NC} $1"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ML_DIR="$PROJECT_ROOT/ml"

log "Starting ML pipeline deployment..."

# Check if ML directory exists
if [ ! -d "$ML_DIR" ]; then
    log_warning "ML directory not found at: $ML_DIR"
    log_warning "Skipping ML pipeline deployment"
    log "To deploy ML later, create ML models and run this script again"
    exit 0
fi

cd "$ML_DIR"

# Step 1: Generate training data
log "Step 1: Generating training data..."
if [ -f "scripts/generate-training-data.py" ]; then
    python3 scripts/generate-training-data.py || {
        log_error "Failed to generate training data"
        exit 1
    }
    log_success "Training data generated"
else
    log_warning "Training data generation script not found"
    log "Expected: $ML_DIR/scripts/generate-training-data.py"
fi

# Step 2: Export to S3
log "Step 2: Exporting data to S3..."

# Get or create S3 bucket
BUCKET_NAME="iops-ml-data-$(aws sts get-caller-identity --query Account --output text)"
S3_URI="s3://$BUCKET_NAME/training-data"

# Check if bucket exists, create if not
if aws s3 ls "s3://$BUCKET_NAME" 2>&1 | grep -q 'NoSuchBucket'; then
    log "Creating S3 bucket: $BUCKET_NAME"
    aws s3 mb "s3://$BUCKET_NAME" --region us-east-1 || {
        log_error "Failed to create S3 bucket"
        exit 1
    }

    # Enable versioning
    aws s3api put-bucket-versioning \
        --bucket "$BUCKET_NAME" \
        --versioning-configuration Status=Enabled

    # Add lifecycle policy to delete old data after 90 days
    cat > /tmp/lifecycle-policy.json << EOF
{
    "Rules": [{
        "Id": "DeleteOldTrainingData",
        "Status": "Enabled",
        "Prefix": "training-data/",
        "Expiration": { "Days": 90 }
    }]
}
EOF
    aws s3api put-bucket-lifecycle-configuration \
        --bucket "$BUCKET_NAME" \
        --lifecycle-configuration file:///tmp/lifecycle-policy.json

    log_success "S3 bucket created: $BUCKET_NAME"
else
    log_success "S3 bucket exists: $BUCKET_NAME"
fi

# Upload training data
if [ -d "data" ]; then
    log "Uploading training data to S3..."
    aws s3 sync data/ "$S3_URI/" --exclude "*.pyc" --exclude "__pycache__/*" || {
        log_error "Failed to upload training data to S3"
        exit 1
    }
    log_success "Training data uploaded to: $S3_URI"
else
    log_warning "No data directory found, skipping S3 upload"
fi

# Step 3: Trigger SageMaker training
log "Step 3: Checking for SageMaker training job..."

# Check if SageMaker training script exists
if [ -f "scripts/train-sagemaker.py" ]; then
    log "Starting SageMaker training job..."

    # Set SageMaker role (create if not exists)
    ROLE_NAME="IOps-SageMaker-Role"
    ROLE_ARN=$(aws iam get-role --role-name "$ROLE_NAME" --query 'Role.Arn' --output text 2>/dev/null || echo "")

    if [ -z "$ROLE_ARN" ]; then
        log "Creating SageMaker IAM role..."

        # Create trust policy
        cat > /tmp/trust-policy.json << EOF
{
    "Version": "2012-10-17",
    "Statement": [{
        "Effect": "Allow",
        "Principal": { "Service": "sagemaker.amazonaws.com" },
        "Action": "sts:AssumeRole"
    }]
}
EOF

        ROLE_ARN=$(aws iam create-role \
            --role-name "$ROLE_NAME" \
            --assume-role-policy-document file:///tmp/trust-policy.json \
            --query 'Role.Arn' --output text)

        # Attach policies
        aws iam attach-role-policy \
            --role-name "$ROLE_NAME" \
            --policy-arn arn:aws:iam::aws:policy/AmazonSageMakerFullAccess

        aws iam attach-role-policy \
            --role-name "$ROLE_NAME" \
            --policy-arn arn:aws:iam::aws:policy/AmazonS3FullAccess

        log_success "SageMaker role created: $ROLE_ARN"
        log "Waiting 10 seconds for IAM propagation..."
        sleep 10
    else
        log_success "SageMaker role exists: $ROLE_ARN"
    fi

    # Run training
    export SAGEMAKER_ROLE_ARN="$ROLE_ARN"
    export S3_DATA_URI="$S3_URI"

    python3 scripts/train-sagemaker.py || {
        log_error "SageMaker training job failed to start"
        exit 1
    }

    log_success "SageMaker training job started"

    # Step 4: Wait for training completion
    log "Step 4: Waiting for training completion..."
    log "This may take 10-30 minutes depending on data size..."

    # Get latest training job
    TRAINING_JOB=$(aws sagemaker list-training-jobs \
        --sort-by CreationTime \
        --sort-order Descending \
        --max-results 1 \
        --query 'TrainingJobSummaries[0].TrainingJobName' \
        --output text)

    if [ -n "$TRAINING_JOB" ] && [ "$TRAINING_JOB" != "None" ]; then
        log "Monitoring training job: $TRAINING_JOB"

        # Wait for completion (with timeout)
        TIMEOUT=3600  # 1 hour
        ELAPSED=0
        while [ $ELAPSED -lt $TIMEOUT ]; do
            STATUS=$(aws sagemaker describe-training-job \
                --training-job-name "$TRAINING_JOB" \
                --query 'TrainingJobStatus' \
                --output text)

            if [ "$STATUS" == "Completed" ]; then
                log_success "Training completed successfully"

                # Get model metrics
                ACCURACY=$(aws sagemaker describe-training-job \
                    --training-job-name "$TRAINING_JOB" \
                    --query 'FinalMetricDataList[?MetricName==`accuracy`].Value' \
                    --output text || echo "N/A")

                log "Model accuracy: $ACCURACY"
                break
            elif [ "$STATUS" == "Failed" ] || [ "$STATUS" == "Stopped" ]; then
                log_error "Training job $STATUS"
                FAILURE_REASON=$(aws sagemaker describe-training-job \
                    --training-job-name "$TRAINING_JOB" \
                    --query 'FailureReason' \
                    --output text)
                log_error "Reason: $FAILURE_REASON"
                exit 1
            else
                log "Training status: $STATUS (elapsed: ${ELAPSED}s)"
                sleep 30
                ELAPSED=$((ELAPSED+30))
            fi
        done

        if [ $ELAPSED -ge $TIMEOUT ]; then
            log_error "Training job timeout after 1 hour"
            exit 1
        fi

        # Step 5: Deploy endpoint
        log "Step 5: Deploying SageMaker endpoint..."

        if [ -f "scripts/deploy-endpoint.py" ]; then
            python3 scripts/deploy-endpoint.py || {
                log_error "Failed to deploy endpoint"
                exit 1
            }
            log_success "SageMaker endpoint deployed"

            # Get endpoint name
            ENDPOINT_NAME=$(aws sagemaker list-endpoints \
                --sort-by CreationTime \
                --sort-order Descending \
                --max-results 1 \
                --query 'Endpoints[0].EndpointName' \
                --output text)

            log_success "Endpoint name: $ENDPOINT_NAME"

            # Save to outputs file
            echo "SAGEMAKER_ENDPOINT=$ENDPOINT_NAME" >> "$PROJECT_ROOT/.deployment-outputs"

        else
            log_warning "Endpoint deployment script not found"
        fi

        # Step 6: Validate accuracy
        log "Step 6: Validating model accuracy..."

        if [ "$ACCURACY" != "N/A" ]; then
            ACCURACY_INT=$(echo "$ACCURACY" | awk '{print int($1*100)}')
            if [ "$ACCURACY_INT" -ge 90 ]; then
                log_success "Model accuracy ($ACCURACY) meets threshold (>90%)"
            else
                log_warning "Model accuracy ($ACCURACY) below threshold (90%)"
                log "Consider retraining with more data or tuning hyperparameters"
            fi
        else
            log_warning "Could not validate model accuracy"
        fi
    else
        log_warning "No training job found"
    fi

else
    log_warning "SageMaker training script not found"
    log "Expected: $ML_DIR/scripts/train-sagemaker.py"
    log "ML pipeline deployment skipped"
fi

log "=========================================="
log_success "ML pipeline deployment completed"
log "=========================================="
log "To use SageMaker for predictions:"
log "  1. Run: bash scripts/deploy/switch-to-sagemaker.sh"
log "  2. Monitor performance in CloudWatch"
log "  3. Rollback if needed with provided script"
