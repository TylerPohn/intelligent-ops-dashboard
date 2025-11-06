# IOps Dashboard Operations Runbook

## Table of Contents
1. [Common Operational Tasks](#common-operational-tasks)
2. [Switch to SageMaker](#switch-to-sagemaker)
3. [Update ML Model](#update-ml-model)
4. [Scale Resources](#scale-resources)
5. [Emergency Procedures](#emergency-procedures)
6. [Monitoring & Alerting](#monitoring--alerting)
7. [Troubleshooting Guide](#troubleshooting-guide)

---

## Common Operational Tasks

### Check System Health

```bash
# Quick health check
bash scripts/validate/validate-deployment.sh

# Detailed system status
source .deployment-outputs

# Check Lambda function
aws lambda get-function --function-name $(echo $AI_LAMBDA | awk -F: '{print $NF}')

# Check DynamoDB tables
aws dynamodb describe-table --table-name $METRICS_TABLE
aws dynamodb describe-table --table-name $INSIGHTS_TABLE

# Check API Gateway
aws apigateway get-rest-api --rest-api-id $(echo $API_URL | grep -oE '[a-z0-9]{10}')
```

### View Recent Metrics

```bash
# Get last 10 metrics from DynamoDB
aws dynamodb scan \
  --table-name $METRICS_TABLE \
  --limit 10 \
  --query 'Items[*].[hostname.S,timestamp.N,cpuUsage.N]' \
  --output table

# Get recent insights
aws dynamodb scan \
  --table-name $INSIGHTS_TABLE \
  --limit 10 \
  --query 'Items[*].[type.S,severity.S,message.S]' \
  --output table
```

### View Lambda Logs

```bash
# Get Lambda function name
LAMBDA_NAME=$(echo $AI_LAMBDA | awk -F: '{print $NF}')

# Tail logs in real-time
aws logs tail /aws/lambda/$LAMBDA_NAME --follow

# Get recent errors
aws logs filter-log-events \
  --log-group-name /aws/lambda/$LAMBDA_NAME \
  --filter-pattern "ERROR" \
  --start-time $(($(date +%s) * 1000 - 3600000))
```

### Test API Endpoint

```bash
# Send test metric
curl -X POST "$API_URL/metrics" \
  -H "Content-Type: application/json" \
  -d '{
    "timestamp": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'",
    "hostname": "ops-test-'$(date +%s)'",
    "cpuUsage": 75.5,
    "memoryUsage": 82.3,
    "diskIO": 200.5,
    "networkIO": 150.2
  }'

# Expected response:
# {"message":"Metric stored successfully","metricId":"..."}
```

### Check Cost to Date

```bash
# Run cost validation
bash scripts/validate/validate-cost.sh

# Get current month cost from Cost Explorer
aws ce get-cost-and-usage \
  --time-period Start=$(date -u +"%Y-%m-01"),End=$(date -u +"%Y-%m-%d") \
  --granularity MONTHLY \
  --metrics UnblendedCost \
  --query 'ResultsByTime[0].Total.UnblendedCost'
```

---

## Switch to SageMaker

### Prerequisites
- ML model trained and deployed
- SageMaker endpoint in "InService" status
- Baseline error rate established

### Canary Deployment Process

```bash
# Step 1: Verify SageMaker endpoint
aws sagemaker describe-endpoint --endpoint-name $SAGEMAKER_ENDPOINT

# Step 2: Run canary deployment (automatic)
bash scripts/deploy/switch-to-sagemaker.sh
```

The script will:
1. **Phase 1**: Route 10% traffic → Monitor 2 minutes
2. **Phase 2**: Route 50% traffic → Monitor 3 minutes
3. **Phase 3**: Route 100% traffic → Monitor 5 minutes

### Manual Traffic Control

```bash
# Get Lambda function name
LAMBDA_NAME=$(echo $AI_LAMBDA | awk -F: '{print $NF}')

# Set traffic percentage (10, 50, or 100)
aws lambda update-function-configuration \
  --function-name $LAMBDA_NAME \
  --environment "Variables={
    USE_SAGEMAKER=true,
    SAGEMAKER_ENDPOINT=$SAGEMAKER_ENDPOINT,
    CANARY_PERCENTAGE=50
  }"
```

### Monitor SageMaker Performance

```bash
# Get endpoint metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/SageMaker \
  --metric-name ModelInvocations \
  --dimensions Name=EndpointName,Value=$SAGEMAKER_ENDPOINT \
  --start-time $(date -u -v-1H +"%Y-%m-%dT%H:%M:%S") \
  --end-time $(date -u +"%Y-%m-%dT%H:%M:%S") \
  --period 300 \
  --statistics Sum

# Get endpoint latency
aws cloudwatch get-metric-statistics \
  --namespace AWS/SageMaker \
  --metric-name ModelLatency \
  --dimensions Name=EndpointName,Value=$SAGEMAKER_ENDPOINT \
  --start-time $(date -u -v-1H +"%Y-%m-%dT%H:%M:%S") \
  --end-time $(date -u +"%Y-%m-%dT%H:%M:%S") \
  --period 300 \
  --statistics Average
```

### Rollback to Built-in Model

```bash
# Quick rollback
bash scripts/deploy/rollback-sagemaker.sh

# Or manually
aws lambda update-function-configuration \
  --function-name $LAMBDA_NAME \
  --environment "Variables={USE_SAGEMAKER=false}"
```

---

## Update ML Model

### Retrain Model with New Data

```bash
# Step 1: Generate new training data
cd ml
python3 scripts/generate-training-data.py --days 90 --output data/

# Step 2: Upload to S3
aws s3 sync data/ s3://iops-ml-data-$(aws sts get-caller-identity --query Account --output text)/training-data/

# Step 3: Start training job
python3 scripts/train-sagemaker.py

# Step 4: Monitor training
TRAINING_JOB=$(aws sagemaker list-training-jobs --sort-by CreationTime --sort-order Descending --max-results 1 --query 'TrainingJobSummaries[0].TrainingJobName' --output text)

aws sagemaker describe-training-job --training-job-name $TRAINING_JOB
```

### Deploy New Model Version

```bash
# Step 1: Create model from training job
aws sagemaker create-model \
  --model-name iops-model-$(date +%Y%m%d-%H%M%S) \
  --primary-container Image=...,ModelDataUrl=...

# Step 2: Create endpoint config
aws sagemaker create-endpoint-config \
  --endpoint-config-name iops-config-$(date +%Y%m%d-%H%M%S) \
  --production-variants VariantName=AllTraffic,ModelName=...

# Step 3: Update endpoint
aws sagemaker update-endpoint \
  --endpoint-name $SAGEMAKER_ENDPOINT \
  --endpoint-config-name iops-config-$(date +%Y%m%d-%H%M%S)

# Step 4: Monitor update
aws sagemaker describe-endpoint --endpoint-name $SAGEMAKER_ENDPOINT
```

### A/B Test Two Models

```bash
# Create endpoint config with traffic splitting
aws sagemaker create-endpoint-config \
  --endpoint-config-name iops-ab-test-$(date +%Y%m%d) \
  --production-variants \
    VariantName=ModelA,ModelName=iops-model-v1,InitialInstanceCount=1,InstanceType=ml.t2.medium,InitialVariantWeight=0.5 \
    VariantName=ModelB,ModelName=iops-model-v2,InitialInstanceCount=1,InstanceType=ml.t2.medium,InitialVariantWeight=0.5

# Update endpoint
aws sagemaker update-endpoint \
  --endpoint-name $SAGEMAKER_ENDPOINT \
  --endpoint-config-name iops-ab-test-$(date +%Y%m%d)
```

---

## Scale Resources

### Scale Lambda Concurrency

```bash
# Get current concurrency
LAMBDA_NAME=$(echo $AI_LAMBDA | awk -F: '{print $NF}')
aws lambda get-function-concurrency --function-name $LAMBDA_NAME

# Increase reserved concurrency
aws lambda put-function-concurrency \
  --function-name $LAMBDA_NAME \
  --reserved-concurrent-executions 200

# Remove concurrency limit (use account limit)
aws lambda delete-function-concurrency --function-name $LAMBDA_NAME
```

### Scale DynamoDB Capacity

#### Switch to Provisioned Capacity
```bash
# For predictable workloads
aws dynamodb update-table \
  --table-name $METRICS_TABLE \
  --billing-mode PROVISIONED \
  --provisioned-throughput ReadCapacityUnits=100,WriteCapacityUnits=50

# Enable auto-scaling
aws application-autoscaling register-scalable-target \
  --service-namespace dynamodb \
  --resource-id table/$METRICS_TABLE \
  --scalable-dimension dynamodb:table:ReadCapacityUnits \
  --min-capacity 5 \
  --max-capacity 500

aws application-autoscaling put-scaling-policy \
  --service-namespace dynamodb \
  --resource-id table/$METRICS_TABLE \
  --scalable-dimension dynamodb:table:ReadCapacityUnits \
  --policy-name ReadCapacityScaling \
  --policy-type TargetTrackingScaling \
  --target-tracking-scaling-policy-configuration \
    PredefinedMetricSpecification={PredefinedMetricType=DynamoDBReadCapacityUtilization},TargetValue=70.0
```

#### Switch Back to On-Demand
```bash
aws dynamodb update-table \
  --table-name $METRICS_TABLE \
  --billing-mode PAY_PER_REQUEST
```

### Scale SageMaker Endpoint

```bash
# Update instance count
aws sagemaker update-endpoint-weights-and-capacities \
  --endpoint-name $SAGEMAKER_ENDPOINT \
  --desired-weights-and-capacities \
    VariantName=AllTraffic,DesiredInstanceCount=3

# Enable auto-scaling
aws application-autoscaling register-scalable-target \
  --service-namespace sagemaker \
  --resource-id endpoint/$SAGEMAKER_ENDPOINT/variant/AllTraffic \
  --scalable-dimension sagemaker:variant:DesiredInstanceCount \
  --min-capacity 1 \
  --max-capacity 5

aws application-autoscaling put-scaling-policy \
  --service-namespace sagemaker \
  --resource-id endpoint/$SAGEMAKER_ENDPOINT/variant/AllTraffic \
  --scalable-dimension sagemaker:variant:DesiredInstanceCount \
  --policy-name InvocationScaling \
  --policy-type TargetTrackingScaling \
  --target-tracking-scaling-policy-configuration \
    PredefinedMetricSpecification={PredefinedMetricType=SageMakerVariantInvocationsPerInstance},TargetValue=1000.0
```

### Scale API Gateway Throttling

```bash
# Get current usage plan
API_ID=$(echo $API_URL | grep -oE '[a-z0-9]{10}')
aws apigateway get-usage-plans --query "items[?apiStages[?apiId=='$API_ID']]"

# Update throttle limits
aws apigateway update-usage-plan \
  --usage-plan-id YOUR-PLAN-ID \
  --patch-operations \
    op=replace,path=/throttle/rateLimit,value=10000 \
    op=replace,path=/throttle/burstLimit,value=5000
```

---

## Emergency Procedures

### High Error Rate Alert

**Symptoms**: Error rate > 5% alarm triggered

**Immediate Actions**:
```bash
# 1. Check recent errors
LAMBDA_NAME=$(echo $AI_LAMBDA | awk -F: '{print $NF}')
aws logs filter-log-events \
  --log-group-name /aws/lambda/$LAMBDA_NAME \
  --filter-pattern "ERROR" \
  --start-time $(($(date +%s) * 1000 - 900000)) | head -20

# 2. Check Lambda throttling
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Throttles \
  --dimensions Name=FunctionName,Value=$LAMBDA_NAME \
  --start-time $(date -u -v-15M +"%Y-%m-%dT%H:%M:%S") \
  --end-time $(date -u +"%Y-%m-%dT%H:%M:%S") \
  --period 300 \
  --statistics Sum

# 3. If using SageMaker, rollback
bash scripts/deploy/rollback-sagemaker.sh

# 4. Increase Lambda memory if OOM errors
aws lambda update-function-configuration \
  --function-name $LAMBDA_NAME \
  --memory-size 1536
```

### High Latency Alert

**Symptoms**: p99 latency > 3 seconds

**Immediate Actions**:
```bash
# 1. Check Lambda duration metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Duration \
  --dimensions Name=FunctionName,Value=$LAMBDA_NAME \
  --start-time $(date -u -v-15M +"%Y-%m-%dT%H:%M:%S") \
  --end-time $(date -u +"%Y-%m-%dT%H:%M:%S") \
  --period 300 \
  --statistics Average,p99

# 2. Check DynamoDB throttling
aws cloudwatch get-metric-statistics \
  --namespace AWS/DynamoDB \
  --metric-name UserErrors \
  --dimensions Name=TableName,Value=$METRICS_TABLE \
  --start-time $(date -u -v-15M +"%Y-%m-%dT%H:%M:%S") \
  --end-time $(date -u +"%Y-%m-%dT%H:%M:%S") \
  --period 300 \
  --statistics Sum

# 3. Increase Lambda timeout
aws lambda update-function-configuration \
  --function-name $LAMBDA_NAME \
  --timeout 90

# 4. Increase DynamoDB capacity (if provisioned)
aws dynamodb update-table \
  --table-name $METRICS_TABLE \
  --provisioned-throughput ReadCapacityUnits=200,WriteCapacityUnits=100
```

### Complete System Outage

**Symptoms**: API Gateway returning 5xx errors, Lambda not responding

**Immediate Actions**:
```bash
# 1. Check AWS service health
aws health describe-events --filter eventStatusCodes=open

# 2. Check Lambda function status
aws lambda get-function --function-name $LAMBDA_NAME

# 3. Check DynamoDB table status
aws dynamodb describe-table --table-name $METRICS_TABLE

# 4. Redeploy if necessary
cd infrastructure
cdk deploy --force

# 5. If region is down, failover to backup region (requires multi-region setup)
# Update Route53 to point to secondary region
```

### Cost Runaway

**Symptoms**: Cost exceeds $100 in a day

**Immediate Actions**:
```bash
# 1. Check current day costs
aws ce get-cost-and-usage \
  --time-period Start=$(date -u +"%Y-%m-%d"),End=$(date -u -v+1d +"%Y-%m-%d") \
  --granularity DAILY \
  --metrics UnblendedCost \
  --group-by Type=SERVICE

# 2. Stop SageMaker endpoint immediately
aws sagemaker delete-endpoint --endpoint-name $SAGEMAKER_ENDPOINT

# 3. Reduce Lambda concurrency
aws lambda put-function-concurrency \
  --function-name $LAMBDA_NAME \
  --reserved-concurrent-executions 10

# 4. Enable API Gateway throttling
aws apigateway update-usage-plan \
  --usage-plan-id YOUR-PLAN-ID \
  --patch-operations op=replace,path=/throttle/rateLimit,value=100

# 5. Review DynamoDB capacity
aws dynamodb update-table \
  --table-name $METRICS_TABLE \
  --billing-mode PAY_PER_REQUEST
```

### Data Loss Incident

**Symptoms**: Missing data in DynamoDB tables

**Immediate Actions**:
```bash
# 1. Check DynamoDB point-in-time recovery status
aws dynamodb describe-continuous-backups --table-name $METRICS_TABLE

# 2. List available backups
aws dynamodb list-backups --table-name $METRICS_TABLE

# 3. Restore from backup
aws dynamodb restore-table-from-backup \
  --target-table-name ${METRICS_TABLE}-restored \
  --backup-arn arn:aws:dynamodb:...

# 4. Or restore to point in time
aws dynamodb restore-table-to-point-in-time \
  --source-table-name $METRICS_TABLE \
  --target-table-name ${METRICS_TABLE}-restored \
  --restore-date-time $(date -u -v-1H +"%Y-%m-%dT%H:%M:%S")

# 5. Verify restored data
aws dynamodb scan --table-name ${METRICS_TABLE}-restored --limit 10

# 6. Swap tables (update Lambda environment)
aws lambda update-function-configuration \
  --function-name $LAMBDA_NAME \
  --environment "Variables={METRICS_TABLE=${METRICS_TABLE}-restored}"
```

---

## Monitoring & Alerting

### View CloudWatch Dashboard

```bash
# Get dashboard URL
REGION=$(echo $AI_LAMBDA | awk -F: '{print $4}')
echo "https://console.aws.amazon.com/cloudwatch/home?region=$REGION#dashboards:name=IOps-System-Dashboard"
```

### Test Alarms

```bash
# Trigger test alarm
aws cloudwatch set-alarm-state \
  --alarm-name "IOps-Lambda-HighErrorRate" \
  --state-value ALARM \
  --state-reason "Testing alarm notification"

# Reset alarm
aws cloudwatch set-alarm-state \
  --alarm-name "IOps-Lambda-HighErrorRate" \
  --state-value OK \
  --state-reason "Test complete"
```

### Update SNS Subscriptions

```bash
# List current subscriptions
aws sns list-subscriptions-by-topic --topic-arn YOUR-SNS-TOPIC-ARN

# Add new email subscription
aws sns subscribe \
  --topic-arn YOUR-SNS-TOPIC-ARN \
  --protocol email \
  --notification-endpoint new-email@example.com

# Remove subscription
aws sns unsubscribe --subscription-arn YOUR-SUBSCRIPTION-ARN
```

---

## Troubleshooting Guide

### Lambda Timeout Errors

```bash
# Increase timeout
aws lambda update-function-configuration \
  --function-name $LAMBDA_NAME \
  --timeout 120

# Increase memory (also increases CPU)
aws lambda update-function-configuration \
  --function-name $LAMBDA_NAME \
  --memory-size 2048
```

### DynamoDB Throttling

```bash
# Switch to on-demand (recommended for variable workloads)
aws dynamodb update-table \
  --table-name $METRICS_TABLE \
  --billing-mode PAY_PER_REQUEST

# Or increase provisioned capacity
aws dynamodb update-table \
  --table-name $METRICS_TABLE \
  --provisioned-throughput ReadCapacityUnits=500,WriteCapacityUnits=250
```

### SageMaker Endpoint Errors

```bash
# Check endpoint status
aws sagemaker describe-endpoint --endpoint-name $SAGEMAKER_ENDPOINT

# Check endpoint logs
aws logs tail /aws/sagemaker/Endpoints/$SAGEMAKER_ENDPOINT --follow

# Update endpoint instance type
aws sagemaker update-endpoint \
  --endpoint-name $SAGEMAKER_ENDPOINT \
  --endpoint-config-name NEW-CONFIG-WITH-LARGER-INSTANCE
```

### API Gateway 429 (Too Many Requests)

```bash
# Increase throttle limits
aws apigateway update-usage-plan \
  --usage-plan-id YOUR-PLAN-ID \
  --patch-operations \
    op=replace,path=/throttle/rateLimit,value=20000 \
    op=replace,path=/throttle/burstLimit,value=10000
```

---

## Useful Commands Reference

```bash
# Quick status check
source .deployment-outputs && \
aws lambda get-function --function-name $(echo $AI_LAMBDA | awk -F: '{print $NF}') --query 'Configuration.State'

# Get API Gateway ID
echo $API_URL | grep -oE '[a-z0-9]{10}'

# Count metrics in last hour
aws dynamodb query \
  --table-name $METRICS_TABLE \
  --key-condition-expression "hostname = :host AND #ts > :time" \
  --expression-attribute-names '{"#ts":"timestamp"}' \
  --expression-attribute-values '{":host":{"S":"your-host"},":time":{"N":"'$(($(date +%s) - 3600))'"}}' \
  --select COUNT

# Get Lambda invocation count today
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Invocations \
  --dimensions Name=FunctionName,Value=$LAMBDA_NAME \
  --start-time $(date -u +"%Y-%m-%dT00:00:00") \
  --end-time $(date -u +"%Y-%m-%dT23:59:59") \
  --period 86400 \
  --statistics Sum
```

---

## On-Call Checklist

- [ ] Have AWS credentials configured
- [ ] Know how to access CloudWatch dashboard
- [ ] Have `.deployment-outputs` file accessible
- [ ] Know rollback procedures
- [ ] Have escalation contacts
- [ ] Know cost thresholds and limits
- [ ] Have access to this runbook

## Escalation

- **Lambda Issues**: AWS Support → Lambda service team
- **DynamoDB Issues**: AWS Support → DynamoDB service team
- **SageMaker Issues**: AWS Support → SageMaker service team
- **Cost Issues**: AWS Account Manager
- **Security Issues**: AWS Security → Internal security team
