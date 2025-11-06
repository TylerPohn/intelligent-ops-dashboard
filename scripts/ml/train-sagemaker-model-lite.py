#!/usr/bin/env python3
"""
Lightweight SageMaker Training Script - Optimized for Synthetic Data
Cost: ~$3-5 (vs $15-30 full version)
Time: ~20-30 minutes (vs 2-4 hours)
"""

import boto3
import sagemaker
from sagemaker import get_execution_role
from sagemaker.estimator import Estimator
from sagemaker.tuner import HyperparameterTuner, IntegerParameter, ContinuousParameter
import os
import json
from datetime import datetime

# Configuration
REGION = os.environ.get('AWS_REGION', 'us-east-1')
S3_BUCKET = os.environ.get('S3_BUCKET', 'iops-ml-training')
ROLE_ARN = os.environ.get('SAGEMAKER_ROLE')

# Lightweight settings
INSTANCE_TYPE = 'ml.m5.large'  # Cheaper than ml.t3.medium for training
INSTANCE_COUNT = 1
MAX_TUNING_JOBS = 5  # Reduced from 50
MAX_PARALLEL_JOBS = 2  # Reduced from 10
TRAINING_SAMPLES = 5000  # Use half the data for speed

# Initialize clients
sagemaker_client = boto3.client('sagemaker', region_name=REGION)
s3_client = boto3.client('s3', region_name=REGION)
sess = sagemaker.Session()

if not ROLE_ARN:
    try:
        ROLE_ARN = get_execution_role()
    except:
        print("ERROR: SAGEMAKER_ROLE environment variable not set")
        print("Set it with: export SAGEMAKER_ROLE=arn:aws:iam::ACCOUNT:role/SageMakerExecutionRole")
        exit(1)

print(f"Using SageMaker Role: {ROLE_ARN}")
print(f"Using S3 Bucket: {S3_BUCKET}")
print(f"Lightweight Mode: {MAX_TUNING_JOBS} tuning jobs, {TRAINING_SAMPLES} samples")

# S3 paths - separate paths for classifier and regressor
S3_PREFIX = 'iops-ml'
S3_OUTPUT = f's3://{S3_BUCKET}/{S3_PREFIX}/output/'

print(f"\nS3 Configuration:")
print(f"  Bucket: s3://{S3_BUCKET}")
print(f"  Output: {S3_OUTPUT}")


def create_xgboost_estimator(model_type='classifier'):
    """Create XGBoost estimator with lightweight configuration"""

    # Get XGBoost container
    container = sagemaker.image_uris.retrieve(
        framework='xgboost',
        region=REGION,
        version='1.5-1',
        image_scope='training'
    )

    # Base hyperparameters - optimized for speed
    hyperparameters = {
        'max_depth': '5',  # Reduced from 8
        'eta': '0.2',  # Faster learning
        'objective': 'multi:softmax' if model_type == 'classifier' else 'reg:squarederror',
        'num_class': '4' if model_type == 'classifier' else '',
        'num_round': '50',  # Reduced from 100
        'early_stopping_rounds': '5',  # Stop early if no improvement
        'eval_metric': 'merror' if model_type == 'classifier' else 'rmse',
    }

    # Remove empty values
    hyperparameters = {k: v for k, v in hyperparameters.items() if v}

    estimator = Estimator(
        image_uri=container,
        role=ROLE_ARN,
        instance_count=INSTANCE_COUNT,
        instance_type=INSTANCE_TYPE,
        hyperparameters=hyperparameters,
        output_path=S3_OUTPUT,
        sagemaker_session=sess,
        base_job_name=f'iops-{model_type}-lite'
    )

    return estimator


def create_tuner(estimator, model_type='classifier'):
    """Create hyperparameter tuner with reduced job count"""

    # Lightweight hyperparameter ranges
    hyperparameter_ranges = {
        'max_depth': IntegerParameter(3, 7),  # Reduced range
        'eta': ContinuousParameter(0.1, 0.3),  # Narrower range
        'subsample': ContinuousParameter(0.7, 1.0),
        'colsample_bytree': ContinuousParameter(0.7, 1.0),
    }

    objective_metric_name = 'validation:merror' if model_type == 'classifier' else 'validation:rmse'
    objective_type = 'Minimize'

    tuner = HyperparameterTuner(
        estimator=estimator,
        objective_metric_name=objective_metric_name,
        hyperparameter_ranges=hyperparameter_ranges,
        objective_type=objective_type,
        max_jobs=MAX_TUNING_JOBS,  # Only 5 jobs
        max_parallel_jobs=MAX_PARALLEL_JOBS,
        strategy='Bayesian',  # More efficient than Random
        early_stopping_type='Auto'  # Stop unpromising jobs early
    )

    return tuner


def train_model(model_type='classifier'):
    """Train XGBoost model with hyperparameter tuning"""

    print(f"\n{'='*60}")
    print(f"Training {model_type.upper()} model (Lightweight Mode)")
    print(f"{'='*60}\n")

    # Create estimator
    estimator = create_xgboost_estimator(model_type)

    # Create tuner
    tuner = create_tuner(estimator, model_type)

    # Define data channels - DIFFERENT PATHS for classifier vs regressor
    if model_type == 'classifier':
        train_path = f's3://{S3_BUCKET}/{S3_PREFIX}/classifier/train/'
        val_path = f's3://{S3_BUCKET}/{S3_PREFIX}/classifier/validation/'
    else:
        train_path = f's3://{S3_BUCKET}/{S3_PREFIX}/regressor/train/'
        val_path = f's3://{S3_BUCKET}/{S3_PREFIX}/regressor/validation/'

    print(f"Data paths:")
    print(f"  Train: {train_path}")
    print(f"  Validation: {val_path}\n")

    train_input = sagemaker.inputs.TrainingInput(
        s3_data=train_path,
        content_type='csv'
    )
    val_input = sagemaker.inputs.TrainingInput(
        s3_data=val_path,
        content_type='csv'
    )

    # Start tuning
    print(f"Starting hyperparameter tuning with {MAX_TUNING_JOBS} jobs...")
    print(f"This will take approximately 15-20 minutes...\n")

    tuner.fit(
        inputs={
            'train': train_input,
            'validation': val_input
        },
        wait=True,
        logs='All'
    )

    print(f"\n✅ {model_type.capitalize()} tuning complete!")
    print(f"Best training job: {tuner.best_training_job()}")

    return tuner


def deploy_endpoint(tuner, model_type='classifier'):
    """Deploy best model to endpoint with minimal instance"""

    print(f"\n{'='*60}")
    print(f"Deploying {model_type.upper()} endpoint")
    print(f"{'='*60}\n")

    endpoint_name = f'iops-{model_type}-lite'

    print(f"Deploying to endpoint: {endpoint_name}")
    print(f"Instance: ml.t3.small (minimal cost)")
    print(f"This will take approximately 5-8 minutes...\n")

    # Deploy with minimal instance
    predictor = tuner.deploy(
        initial_instance_count=1,
        instance_type='ml.t2.medium',  # Cheapest valid option ($0.065/hr = $47/month)
        endpoint_name=endpoint_name,
        serializer=sagemaker.serializers.CSVSerializer(),
        deserializer=sagemaker.deserializers.JSONDeserializer()
    )

    print(f"\n✅ Endpoint deployed: {endpoint_name}")
    print(f"Status: InService")

    return predictor, endpoint_name


def validate_endpoint(predictor, endpoint_name):
    """Test endpoint with sample data"""

    print(f"\n{'='*60}")
    print(f"Validating endpoint: {endpoint_name}")
    print(f"{'='*60}\n")

    # Sample test data (25 features)
    test_data = [
        [50000, 45000, 95000, 12000,  # IOPS metrics
         5.2, 8.1, 12.3, 2,  # Latency
         450, 15000,  # Throughput
         0.5, 1.2,  # Error rates
         14, 3, 3600,  # Time-based
         0.7, 0.3,  # Access patterns
         32, 256, 50,  # Device metrics
         18269, 7.5, 8.2, 0.65, 1]  # Derived features
    ]

    print("Sending test prediction request...")

    try:
        result = predictor.predict(test_data)
        print(f"✅ Prediction successful!")
        print(f"Result: {result}")
        return True
    except Exception as e:
        print(f"❌ Prediction failed: {e}")
        return False


def main():
    """Main training and deployment pipeline"""

    print("\n" + "="*60)
    print("IOPS Dashboard - Lightweight ML Pipeline")
    print("Optimized for Synthetic Data")
    print("="*60)
    print(f"\nStarted: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"\nConfiguration:")
    print(f"  Tuning Jobs: {MAX_TUNING_JOBS} (vs 50 full)")
    print(f"  Training Instance: {INSTANCE_TYPE}")
    print(f"  Endpoint Instance: ml.t3.small")
    print(f"  Estimated Cost: $3-5 (vs $15-30 full)")
    print(f"  Estimated Time: 20-30 minutes (vs 2-4 hours full)")

    # Train classifier
    print("\n\n" + "="*60)
    print("PHASE 1: Train Risk Classification Model")
    print("="*60)
    classifier_tuner = train_model('classifier')

    # Deploy classifier
    classifier_predictor, classifier_endpoint = deploy_endpoint(classifier_tuner, 'classifier')

    # Validate classifier
    validate_endpoint(classifier_predictor, classifier_endpoint)

    # Train regressor
    print("\n\n" + "="*60)
    print("PHASE 2: Train Performance Regression Model")
    print("="*60)
    regressor_tuner = train_model('regressor')

    # Deploy regressor
    regressor_predictor, regressor_endpoint = deploy_endpoint(regressor_tuner, 'regressor')

    # Validate regressor
    validate_endpoint(regressor_predictor, regressor_endpoint)

    # Summary
    print("\n\n" + "="*60)
    print("🎉 LIGHTWEIGHT ML PIPELINE COMPLETE!")
    print("="*60)
    print(f"\nEndpoints Deployed:")
    print(f"  1. {classifier_endpoint} (ml.t3.small)")
    print(f"  2. {regressor_endpoint} (ml.t3.small)")
    print(f"\nMonthly Cost Estimate:")
    print(f"  ml.t3.small x 2 endpoints: ~$50-60/month")
    print(f"\nTo use in AI Lambda, set:")
    print(f"  SAGEMAKER_ENDPOINT={classifier_endpoint}")
    print(f"  USE_SAGEMAKER=true")
    print(f"\nCompleted: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    return {
        'classifier_endpoint': classifier_endpoint,
        'regressor_endpoint': regressor_endpoint,
        'status': 'success'
    }


if __name__ == '__main__':
    try:
        result = main()
        print("\n✅ All done!")
        exit(0)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        exit(1)
