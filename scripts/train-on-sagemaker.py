"""
Train Marketplace Health Model on SageMaker

This script:
1. Creates a SageMaker training job
2. Uses TensorFlow container
3. Trains on ml.m5.xlarge instance
4. Saves model to S3
"""

import boto3
import sagemaker
from sagemaker.tensorflow import TensorFlow
from sagemaker import get_execution_role
import time
import argparse
import json

# Configuration
CONFIG = {
    'bucket': 'iops-dashboard-ml-data',
    'prefix': 'marketplace-health-model',
    'region': 'us-east-1',
    'instance_type': 'ml.m5.xlarge',  # $0.269/hour
    'instance_count': 1,
    'max_runtime_seconds': 3600,  # 1 hour max
    'tensorflow_version': '2.13',
    'python_version': 'py310',
}


def get_or_create_role(role_name: str = 'SageMakerExecutionRole') -> str:
    """
    Get existing SageMaker execution role or provide instructions to create one.
    """
    iam = boto3.client('iam')

    try:
        # Try to get existing role
        response = iam.get_role(RoleName=role_name)
        role_arn = response['Role']['Arn']
        print(f"✅ Using existing role: {role_arn}")
        return role_arn
    except iam.exceptions.NoSuchEntityException:
        print(f"\n❌ SageMaker execution role '{role_name}' not found")
        print("\nCreate role with these steps:")
        print("1. Go to IAM Console: https://console.aws.amazon.com/iam/")
        print("2. Click 'Roles' → 'Create role'")
        print("3. Select 'AWS service' → 'SageMaker'")
        print("4. Attach policies:")
        print("   - AmazonSageMakerFullAccess")
        print("   - AmazonS3FullAccess")
        print("5. Name it 'SageMakerExecutionRole'")
        print("\nOr run: aws iam create-role --role-name SageMakerExecutionRole ...")
        raise


def create_training_job(
    role_arn: str,
    training_script: str = 'train-sagemaker-model.py',
    hyperparameters: dict = None,
    wait: bool = True
) -> dict:
    """
    Create SageMaker training job.
    """

    # Default hyperparameters
    if hyperparameters is None:
        hyperparameters = {
            'epochs': 50,
            'batch-size': 64,
            'learning-rate': 0.001,
        }

    # S3 paths
    s3_train_data = f"s3://{CONFIG['bucket']}/{CONFIG['prefix']}/train/"
    s3_validation_data = f"s3://{CONFIG['bucket']}/{CONFIG['prefix']}/validation/"
    s3_output_path = f"s3://{CONFIG['bucket']}/{CONFIG['prefix']}/models/"

    print("\n=== SageMaker Training Job Configuration ===\n")
    print(f"Training data: {s3_train_data}")
    print(f"Validation data: {s3_validation_data}")
    print(f"Output path: {s3_output_path}")
    print(f"Instance type: {CONFIG['instance_type']}")
    print(f"Hyperparameters: {json.dumps(hyperparameters, indent=2)}")

    # Create TensorFlow estimator
    estimator = TensorFlow(
        entry_point=training_script,
        role=role_arn,
        instance_count=CONFIG['instance_count'],
        instance_type=CONFIG['instance_type'],
        framework_version=CONFIG['tensorflow_version'],
        py_version=CONFIG['python_version'],
        hyperparameters=hyperparameters,
        output_path=s3_output_path,
        max_run=CONFIG['max_runtime_seconds'],
        base_job_name='marketplace-health-model',
        disable_profiler=True,  # Reduce costs
        debugger_hook_config=False,  # Reduce costs
    )

    print("\n🚀 Starting training job...")

    # Start training
    estimator.fit(
        inputs={
            'train': s3_train_data,
            'validation': s3_validation_data,
        },
        wait=wait,
        logs='All' if wait else None,
    )

    job_name = estimator.latest_training_job.name
    print(f"\n✅ Training job started: {job_name}")

    return {
        'job_name': job_name,
        'model_data': estimator.model_data,
        's3_output_path': s3_output_path,
    }


def monitor_training_job(job_name: str):
    """
    Monitor training job progress.
    """
    sagemaker_client = boto3.client('sagemaker', region_name=CONFIG['region'])

    print(f"\n📊 Monitoring training job: {job_name}\n")

    while True:
        response = sagemaker_client.describe_training_job(TrainingJobName=job_name)
        status = response['TrainingJobStatus']

        print(f"Status: {status}", end='')

        if status == 'Completed':
            print("\n\n✅ Training completed successfully!")
            print(f"Model artifact: {response['ModelArtifacts']['S3ModelArtifacts']}")

            # Print metrics
            if 'FinalMetricDataList' in response:
                print("\n=== Final Metrics ===")
                for metric in response['FinalMetricDataList']:
                    print(f"  {metric['MetricName']}: {metric['Value']:.4f}")

            break
        elif status == 'Failed':
            print("\n\n❌ Training failed!")
            print(f"Failure reason: {response.get('FailureReason', 'Unknown')}")
            break
        elif status == 'Stopped':
            print("\n\n⚠️  Training stopped")
            break
        else:
            print(" (in progress...)")
            time.sleep(30)


def deploy_endpoint(
    model_data: str,
    role_arn: str,
    endpoint_name: str = 'marketplace-health-endpoint'
) -> str:
    """
    Deploy trained model to SageMaker endpoint.
    """
    print(f"\n🚀 Deploying model to endpoint: {endpoint_name}")

    sagemaker_client = boto3.client('sagemaker', region_name=CONFIG['region'])

    # Create model
    model_name = f"{endpoint_name}-{int(time.time())}"

    print(f"Creating model: {model_name}")

    # TensorFlow serving container
    container_uri = sagemaker.image_uris.retrieve(
        framework='tensorflow',
        region=CONFIG['region'],
        version=CONFIG['tensorflow_version'],
        py_version=CONFIG['python_version'],
        instance_type='ml.m5.xlarge',
        image_scope='inference',
    )

    sagemaker_client.create_model(
        ModelName=model_name,
        PrimaryContainer={
            'Image': container_uri,
            'ModelDataUrl': model_data,
        },
        ExecutionRoleArn=role_arn,
    )

    print(f"✅ Model created: {model_name}")

    # Create endpoint config
    endpoint_config_name = f"{endpoint_name}-config-{int(time.time())}"

    print(f"Creating endpoint config: {endpoint_config_name}")

    sagemaker_client.create_endpoint_config(
        EndpointConfigName=endpoint_config_name,
        ProductionVariants=[
            {
                'VariantName': 'AllTraffic',
                'ModelName': model_name,
                'InitialInstanceCount': 1,
                'InstanceType': 'ml.m5.xlarge',
            }
        ],
    )

    print(f"✅ Endpoint config created: {endpoint_config_name}")

    # Create or update endpoint
    try:
        sagemaker_client.describe_endpoint(EndpointName=endpoint_name)
        print(f"Updating existing endpoint: {endpoint_name}")
        sagemaker_client.update_endpoint(
            EndpointName=endpoint_name,
            EndpointConfigName=endpoint_config_name,
        )
    except sagemaker_client.exceptions.ClientError:
        print(f"Creating new endpoint: {endpoint_name}")
        sagemaker_client.create_endpoint(
            EndpointName=endpoint_name,
            EndpointConfigName=endpoint_config_name,
        )

    # Wait for endpoint to be in service
    print("\n⏳ Waiting for endpoint to be in service (this takes 5-10 minutes)...")

    waiter = sagemaker_client.get_waiter('endpoint_in_service')
    waiter.wait(EndpointName=endpoint_name)

    print(f"\n✅ Endpoint deployed: {endpoint_name}")
    print(f"\nEndpoint ARN: arn:aws:sagemaker:{CONFIG['region']}:*:endpoint/{endpoint_name}")
    print(f"\nTest with: aws sagemaker-runtime invoke-endpoint --endpoint-name {endpoint_name}")

    return endpoint_name


def main():
    parser = argparse.ArgumentParser(description='Train model on SageMaker')
    parser.add_argument('--role-arn', type=str, help='SageMaker execution role ARN')
    parser.add_argument('--role-name', type=str, default='SageMakerExecutionRole',
                        help='SageMaker execution role name (if ARN not provided)')
    parser.add_argument('--epochs', type=int, default=50, help='Number of epochs')
    parser.add_argument('--batch-size', type=int, default=64, help='Batch size')
    parser.add_argument('--learning-rate', type=float, default=0.001, help='Learning rate')
    parser.add_argument('--deploy', action='store_true', help='Deploy endpoint after training')
    parser.add_argument('--wait', action='store_true', help='Wait for training to complete')
    parser.add_argument('--endpoint-name', type=str, default='marketplace-health-endpoint',
                        help='Endpoint name for deployment')

    args = parser.parse_args()

    print("=== SageMaker Training Script ===\n")

    # Get role ARN
    if args.role_arn:
        role_arn = args.role_arn
    else:
        role_arn = get_or_create_role(args.role_name)

    # Hyperparameters
    hyperparameters = {
        'epochs': args.epochs,
        'batch-size': args.batch_size,
        'learning-rate': args.learning_rate,
    }

    # Create training job
    result = create_training_job(
        role_arn=role_arn,
        hyperparameters=hyperparameters,
        wait=args.wait,
    )

    # Monitor if not waiting
    if not args.wait:
        print("\nTo monitor progress:")
        print(f"  aws sagemaker describe-training-job --training-job-name {result['job_name']}")
        print(f"\nOr run: python {__file__} --monitor {result['job_name']}")

        if args.deploy:
            print("\n⚠️  Cannot deploy without waiting for training to complete")
            print("Re-run with --wait flag to deploy automatically")
    else:
        # Training completed, deploy if requested
        if args.deploy:
            deploy_endpoint(
                model_data=result['model_data'],
                role_arn=role_arn,
                endpoint_name=args.endpoint_name,
            )

    print("\n✅ Done!")


if __name__ == '__main__':
    main()
