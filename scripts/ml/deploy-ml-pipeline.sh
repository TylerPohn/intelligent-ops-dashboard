#!/bin/bash

###############################################################################
# IOPS ML Pipeline Deployment Script
# Complete end-to-end ML pipeline for IOPS risk prediction
###############################################################################

set -e  # Exit on error

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DATA_DIR="$PROJECT_ROOT/data/training"
MODELS_DIR="$PROJECT_ROOT/models"

# AWS Configuration
S3_BUCKET="${S3_BUCKET:-iops-ml-training}"
AWS_REGION="${AWS_REGION:-us-east-1}"
SAGEMAKER_ROLE="${SAGEMAKER_ROLE:-}"

# Model Configuration
TARGET_ACCURACY=0.90
MODEL_TYPE="${MODEL_TYPE:-classifier}"
ENDPOINT_NAME="${ENDPOINT_NAME:-iops-risk-predictor}"

###############################################################################
# Helper Functions
###############################################################################

print_header() {
    echo -e "\n${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}\n"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

check_dependencies() {
    print_header "Checking Dependencies"

    local deps=("node" "npx" "python3" "aws")
    local missing=()

    for dep in "${deps[@]}"; do
        if ! command -v $dep &> /dev/null; then
            missing+=($dep)
            print_error "$dep is not installed"
        else
            print_success "$dep is available"
        fi
    done

    if [ ${#missing[@]} -ne 0 ]; then
        print_error "Missing dependencies: ${missing[*]}"
        exit 1
    fi

    # Check Python packages
    python3 -c "import pandas, numpy, boto3, sagemaker" 2>/dev/null || {
        print_warning "Installing required Python packages..."
        pip3 install pandas numpy boto3 sagemaker scikit-learn
    }

    print_success "All dependencies satisfied"
}

create_directories() {
    print_header "Creating Directory Structure"

    mkdir -p "$DATA_DIR"
    mkdir -p "$MODELS_DIR"
    mkdir -p "$DATA_DIR/sagemaker"

    print_success "Directories created"
}

###############################################################################
# Pipeline Steps
###############################################################################

step_1_generate_training_data() {
    print_header "Step 1: Generate Training Data"

    cd "$PROJECT_ROOT"

    if [ -f "$DATA_DIR/training-data.json" ]; then
        print_warning "Training data already exists. Skipping generation."
        return 0
    fi

    print_info "Generating 10,000 training insights..."

    # Install dependencies if needed
    if [ ! -d "node_modules" ]; then
        npm install
    fi

    # Generate data
    npx ts-node scripts/ml/generate-training-data.ts

    if [ -f "$DATA_DIR/training-data.json" ]; then
        print_success "Training data generated successfully"

        # Show statistics
        local count=$(jq length "$DATA_DIR/training-data.json")
        print_info "Total records: $count"
    else
        print_error "Failed to generate training data"
        exit 1
    fi
}

step_2_export_to_s3() {
    print_header "Step 2: Export Training Data to S3"

    print_info "Checking if S3 bucket exists..."

    if aws s3 ls "s3://$S3_BUCKET" 2>/dev/null; then
        print_success "S3 bucket exists: $S3_BUCKET"
    else
        print_warning "Creating S3 bucket: $S3_BUCKET"
        aws s3 mb "s3://$S3_BUCKET" --region "$AWS_REGION"
    fi

    print_info "Uploading training data to S3..."

    # Upload JSON data
    aws s3 cp "$DATA_DIR/training-data.json" \
        "s3://$S3_BUCKET/raw/training-data.json" \
        --region "$AWS_REGION"

    # Upload CSV data
    aws s3 cp "$DATA_DIR/training-data.csv" \
        "s3://$S3_BUCKET/raw/training-data.csv" \
        --region "$AWS_REGION"

    # Upload statistics
    aws s3 cp "$DATA_DIR/training-stats.json" \
        "s3://$S3_BUCKET/raw/training-stats.json" \
        --region "$AWS_REGION"

    print_success "Training data uploaded to s3://$S3_BUCKET/raw/"
}

step_3_engineer_features() {
    print_header "Step 3: Engineer Features"

    print_info "Generating 25 features from raw data..."

    python3 scripts/ml/feature-engineering.py \
        --input "$DATA_DIR/training-data.csv" \
        --output "$DATA_DIR/features.csv" \
        --format csv \
        --split

    if [ -f "$DATA_DIR/features.csv" ]; then
        print_success "Features engineered successfully"

        # Show feature statistics
        if [ -f "$DATA_DIR/feature-statistics.json" ]; then
            local feature_count=$(jq '.total_features' "$DATA_DIR/feature-statistics.json")
            print_info "Total features: $feature_count"
        fi
    else
        print_error "Feature engineering failed"
        exit 1
    fi

    # Upload to S3
    print_info "Uploading features to S3..."
    aws s3 cp "$DATA_DIR/features.csv" \
        "s3://$S3_BUCKET/features/features.csv" \
        --region "$AWS_REGION"

    aws s3 cp "$DATA_DIR/train.csv" \
        "s3://$S3_BUCKET/features/train.csv" \
        --region "$AWS_REGION"

    aws s3 cp "$DATA_DIR/val.csv" \
        "s3://$S3_BUCKET/features/val.csv" \
        --region "$AWS_REGION"

    aws s3 cp "$DATA_DIR/test.csv" \
        "s3://$S3_BUCKET/features/test.csv" \
        --region "$AWS_REGION"

    print_success "Features uploaded to S3"
}

step_4_train_models() {
    print_header "Step 4: Train Models with SageMaker"

    print_info "Starting SageMaker training job..."
    print_info "Model type: $MODEL_TYPE"

    # Check if role is provided
    if [ -z "$SAGEMAKER_ROLE" ]; then
        print_warning "SAGEMAKER_ROLE not set. Using default..."
        SAGEMAKER_ROLE="arn:aws:iam::$(aws sts get-caller-identity --query Account --output text):role/SageMakerExecutionRole"
    fi

    print_info "Using SageMaker role: $SAGEMAKER_ROLE"

    # Start training
    python3 scripts/ml/train-sagemaker-model.py \
        --bucket "$S3_BUCKET" \
        --features "$DATA_DIR/features.csv" \
        --role "$SAGEMAKER_ROLE" \
        --model-type "$MODEL_TYPE"

    print_success "Training job submitted to SageMaker"
    print_info "Check SageMaker console for job status"
}

step_5_deploy_endpoint() {
    print_header "Step 5: Deploy Model Endpoint"

    print_warning "This step requires manual intervention after training completes"
    print_info "To deploy the model after training:"
    print_info "1. Go to SageMaker console"
    print_info "2. Find the best training job from hyperparameter tuning"
    print_info "3. Deploy to endpoint: $ENDPOINT_NAME"
    print_info "4. Configure auto-scaling (1-3 instances)"

    echo ""
    print_info "Or use the Python script:"
    echo "  python3 scripts/ml/train-sagemaker-model.py --deploy-job <JOB_NAME>"
}

step_6_validate_accuracy() {
    print_header "Step 6: Validate Model Accuracy"

    print_info "Target accuracy: ${TARGET_ACCURACY}%"

    if aws sagemaker describe-endpoint --endpoint-name "$ENDPOINT_NAME" --region "$AWS_REGION" &>/dev/null; then
        print_success "Endpoint $ENDPOINT_NAME is deployed"

        # Run evaluation
        print_info "Running model evaluation..."

        # TODO: Add evaluation script
        print_warning "Manual validation required"
        print_info "Run predictions on test set and calculate metrics"

    else
        print_warning "Endpoint $ENDPOINT_NAME not found"
        print_info "Deploy the model first using step 5"
    fi
}

###############################################################################
# Main Execution
###############################################################################

main() {
    print_header "IOPS ML Pipeline Deployment"

    print_info "Configuration:"
    echo "  S3 Bucket:    $S3_BUCKET"
    echo "  AWS Region:   $AWS_REGION"
    echo "  Model Type:   $MODEL_TYPE"
    echo "  Endpoint:     $ENDPOINT_NAME"
    echo ""

    # Check dependencies
    check_dependencies

    # Create directories
    create_directories

    # Execute pipeline steps
    step_1_generate_training_data
    step_2_export_to_s3
    step_3_engineer_features
    step_4_train_models
    step_5_deploy_endpoint
    step_6_validate_accuracy

    # Summary
    print_header "Pipeline Execution Complete"

    print_success "All automated steps completed"
    print_info "Next steps:"
    echo "  1. Monitor SageMaker training job in AWS console"
    echo "  2. Deploy best model to endpoint after training completes"
    echo "  3. Configure endpoint auto-scaling"
    echo "  4. Run validation tests to ensure >90% accuracy"
    echo "  5. Integrate endpoint with application"

    print_info "Training data: s3://$S3_BUCKET/raw/"
    print_info "Features:      s3://$S3_BUCKET/features/"
    print_info "Models:        Check SageMaker console"
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --bucket)
            S3_BUCKET="$2"
            shift 2
            ;;
        --region)
            AWS_REGION="$2"
            shift 2
            ;;
        --role)
            SAGEMAKER_ROLE="$2"
            shift 2
            ;;
        --model-type)
            MODEL_TYPE="$2"
            shift 2
            ;;
        --endpoint)
            ENDPOINT_NAME="$2"
            shift 2
            ;;
        --help)
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --bucket BUCKET        S3 bucket name (default: iops-ml-training)"
            echo "  --region REGION        AWS region (default: us-east-1)"
            echo "  --role ROLE_ARN        SageMaker execution role ARN"
            echo "  --model-type TYPE      classifier or regressor (default: classifier)"
            echo "  --endpoint NAME        Endpoint name (default: iops-risk-predictor)"
            echo "  --help                 Show this help message"
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Run main pipeline
main
