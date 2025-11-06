# IOps Dashboard Deployment Guide

## Prerequisites

Before deploying the IOps Dashboard, ensure you have the following:

### Required Tools
- **Node.js** (v18 or later)
  ```bash
  node --version  # Should be v18+
  npm --version
  ```

- **AWS CLI** (v2 or later)
  ```bash
  aws --version  # Should be v2+
  aws configure  # Set up credentials
  ```

- **AWS CDK** (installed via npm)
  ```bash
  npm install -g aws-cdk
  cdk --version
  ```

### AWS Account Requirements
- AWS account with appropriate permissions:
  - IAM: Create roles and policies
  - Lambda: Create and manage functions
  - DynamoDB: Create and manage tables
  - API Gateway: Create and manage APIs
  - EventBridge: Create rules and targets
  - SNS: Create topics and subscriptions
  - CloudWatch: Create dashboards and alarms
  - S3: Create buckets (for ML data)
  - SageMaker: Create training jobs and endpoints (optional)

### Environment Variables
Set the following environment variables before deployment:

```bash
# Required for alert notifications
export CRITICAL_ALERT_EMAILS="your-email@example.com,team@example.com"

# Optional for ML features
export AWS_REGION="us-east-1"
```

## Step-by-Step Deployment

### 1. Clone and Install Dependencies

```bash
# Navigate to project root
cd iops-dashboard

# Install dependencies
npm install

# Install infrastructure dependencies
cd infrastructure
npm install
cd ..
```

### 2. Build TypeScript

```bash
npm run build
```

This compiles all TypeScript code in:
- Backend Lambda functions
- Frontend application
- Infrastructure definitions

### 3. Run Tests (Optional but Recommended)

```bash
npm test
```

Ensure all tests pass before deploying to production.

### 4. Deploy Complete System

```bash
# Make scripts executable
chmod +x scripts/deploy/*.sh
chmod +x scripts/validate/*.sh
chmod +x scripts/monitoring/*.sh

# Run complete deployment
bash scripts/deploy/deploy-all.sh
```

This master script will:
1. Build TypeScript
2. Run tests
3. Deploy CDK infrastructure
4. Deploy ML pipeline (if configured)
5. Validate deployment
6. Configure monitoring

### 5. Manual Component Deployment

If you prefer to deploy components individually:

#### Deploy Infrastructure Only
```bash
bash scripts/deploy/deploy-infrastructure.sh
```

This deploys:
- API Gateway
- Lambda functions
- DynamoDB tables
- EventBridge rules
- SNS topics

#### Deploy ML Pipeline Only
```bash
bash scripts/deploy/deploy-ml-pipeline.sh
```

This deploys:
- Training data to S3
- SageMaker training job
- SageMaker endpoint

### 6. Validate Deployment

```bash
# Run all validations
bash scripts/validate/validate-deployment.sh
bash scripts/validate/validate-cost.sh
bash scripts/validate/validate-performance.sh
```

### 7. Configure Monitoring

```bash
# Create CloudWatch dashboards
bash scripts/monitoring/setup-dashboards.sh

# Create CloudWatch alarms
bash scripts/monitoring/setup-alarms.sh
```

## Post-Deployment Steps

### 1. Confirm SNS Email Subscriptions

Check your email for SNS subscription confirmations and click the confirmation links.

### 2. Access CloudWatch Dashboards

Navigate to the CloudWatch console:
```
https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#dashboards:name=IOps-System-Dashboard
```

### 3. Test API Endpoint

```bash
# Get API URL from deployment outputs
source .deployment-outputs
echo "API URL: $API_URL"

# Send test metric
curl -X POST "$API_URL/metrics" \
  -H "Content-Type: application/json" \
  -d '{
    "timestamp": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'",
    "hostname": "test-host",
    "cpuUsage": 45.5,
    "memoryUsage": 62.3,
    "diskIO": 120.5,
    "networkIO": 89.2
  }'
```

### 4. Switch to SageMaker (Optional)

Once ML training completes:

```bash
bash scripts/deploy/switch-to-sagemaker.sh
```

This performs a canary deployment:
- Phase 1: 10% traffic (2 min monitoring)
- Phase 2: 50% traffic (3 min monitoring)
- Phase 3: 100% traffic (5 min monitoring)

Automatic rollback occurs if error rates spike.

## Deployment Outputs

After deployment, check `.deployment-outputs` file:

```bash
cat .deployment-outputs
```

Contains:
- `API_URL`: API Gateway endpoint
- `METRICS_TABLE`: DynamoDB metrics table name
- `INSIGHTS_TABLE`: DynamoDB insights table name
- `AI_LAMBDA`: AI Lambda function ARN
- `SAGEMAKER_ENDPOINT`: SageMaker endpoint name (if deployed)

## Troubleshooting

### Common Issues

#### 1. CDK Bootstrap Error
```
Error: This stack uses assets, so the toolkit stack must be deployed to the environment
```

**Solution:**
```bash
cdk bootstrap aws://ACCOUNT-ID/REGION
```

#### 2. Lambda Timeout During Deployment
```
Error: Lambda function creation timed out
```

**Solution:**
- Check CloudWatch logs for the Lambda function
- Verify IAM permissions are correct
- Increase timeout in CDK stack

#### 3. DynamoDB Table Already Exists
```
Error: Table already exists
```

**Solution:**
```bash
# Delete existing stack first
cdk destroy

# Or manually delete tables
aws dynamodb delete-table --table-name IOps-Metrics
aws dynamodb delete-table --table-name IOps-Insights
```

#### 4. SageMaker Training Fails
```
Error: Training job failed with status: Failed
```

**Solution:**
- Check SageMaker logs in CloudWatch
- Verify training data in S3
- Check SageMaker IAM role permissions

#### 5. Cost Exceeds Budget
```
Warning: Projected cost ($75) exceeds threshold ($50)
```

**Solution:**
- Delete SageMaker endpoint when not in use
- Reduce DynamoDB capacity (switch to on-demand)
- Implement API Gateway caching
- Review CloudWatch logs retention

### Checking Logs

```bash
# Lambda logs
aws logs tail /aws/lambda/IOpsInfrastructureStack-AiLambda --follow

# CDK deployment logs
cat deployment-*.log

# SageMaker training logs
aws sagemaker describe-training-job --training-job-name YOUR-JOB-NAME
```

## Rollback Procedures

### Rollback Complete Stack
```bash
cd infrastructure
cdk destroy
```

### Rollback to Previous Lambda Version
```bash
# List versions
aws lambda list-versions-by-function --function-name YOUR-LAMBDA

# Rollback to specific version
aws lambda update-alias \
  --function-name YOUR-LAMBDA \
  --name PROD \
  --function-version 2
```

### Rollback SageMaker Switch
```bash
bash scripts/deploy/rollback-sagemaker.sh
```

## Update Procedures

### Update Lambda Code
```bash
npm run build
cd infrastructure
cdk deploy
```

### Update ML Model
```bash
# Retrain model
bash scripts/deploy/deploy-ml-pipeline.sh

# Redeploy with canary
bash scripts/deploy/switch-to-sagemaker.sh
```

### Update Infrastructure
```bash
# Make changes to infrastructure/lib/infrastructure-stack.ts
cd infrastructure
cdk diff  # Preview changes
cdk deploy
```

## Cost Optimization Tips

1. **Use AWS Free Tier**
   - First 12 months: Most services covered
   - Always free: Lambda (1M requests), DynamoDB (25GB), etc.

2. **Enable Auto-Scaling**
   - DynamoDB: Auto-scale based on usage
   - Lambda: Use provisioned concurrency wisely

3. **Implement Caching**
   - API Gateway: Enable caching for GET requests
   - Lambda: Use function-level caching

4. **Optimize SageMaker**
   - Use smaller instance types for training
   - Delete endpoints when not in use
   - Use Savings Plans for long-term usage

5. **Monitor and Alert**
   - Set up AWS Budgets
   - Review Cost Explorer regularly
   - Enable cost allocation tags

## Security Best Practices

1. **IAM Least Privilege**
   - Use specific resource ARNs in policies
   - Rotate credentials regularly
   - Enable MFA for production accounts

2. **Network Security**
   - Use VPC for Lambda functions
   - Enable API Gateway throttling
   - Implement API keys for public endpoints

3. **Data Protection**
   - Enable DynamoDB encryption at rest
   - Use HTTPS for all API calls
   - Implement S3 bucket policies

4. **Monitoring**
   - Enable CloudTrail for audit logs
   - Review security findings in Security Hub
   - Set up GuardDuty for threat detection

## Next Steps

1. **Configure Frontend**
   - Update frontend to use deployed API URL
   - Deploy frontend to S3 + CloudFront
   - Configure custom domain

2. **Set Up CI/CD**
   - Create GitHub Actions workflow
   - Implement automated testing
   - Add deployment approval gates

3. **Scale for Production**
   - Enable API Gateway caching
   - Implement Lambda reserved concurrency
   - Set up multi-region deployment

4. **Add Observability**
   - Implement X-Ray tracing
   - Set up custom CloudWatch metrics
   - Create operational dashboards

## Support

For issues or questions:
1. Check troubleshooting section above
2. Review CloudWatch logs
3. Consult AWS documentation
4. Open an issue in the project repository

## Additional Resources

- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [Lambda Best Practices](https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html)
- [DynamoDB Best Practices](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/best-practices.html)
- [SageMaker Documentation](https://docs.aws.amazon.com/sagemaker/)
- [Cost Optimization](https://aws.amazon.com/pricing/cost-optimization/)
