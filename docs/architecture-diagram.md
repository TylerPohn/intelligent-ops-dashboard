# IOps Dashboard Architecture

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           IOps Dashboard System                          │
└─────────────────────────────────────────────────────────────────────────┘

                                  ┌──────────┐
                                  │  Client  │
                                  │  Browser │
                                  └────┬─────┘
                                       │ HTTPS
                                       │
                      ┌────────────────▼────────────────┐
                      │     API Gateway (REST API)      │
                      │  - Rate limiting (10K req/sec)  │
                      │  - Request validation           │
                      │  - CORS enabled                 │
                      └────┬───────────────┬────────────┘
                           │ POST /metrics │
                           │               │ GET /metrics
                           │               │ GET /insights
                           │               │
        ┌──────────────────▼───────┐      │
        │   Metrics Ingestion       │      │
        │   Lambda Function         │      │
        │  - Validate data          │      │
        │  - Store to DynamoDB      │◄─────┘
        │  - Trigger AI processing  │
        │  - 512MB RAM, 30s timeout │
        └──────────┬────────────────┘
                   │
                   │ Write
                   ▼
        ┌──────────────────────────┐
        │   DynamoDB: Metrics      │
        │  - On-demand pricing     │
        │  - TTL: 90 days          │
        │  - Partition: hostname   │
        │  - Sort: timestamp       │
        └──────────┬───────────────┘
                   │
                   │ Stream
                   ▼
        ┌──────────────────────────┐
        │    DynamoDB Streams      │
        │  - New item events       │
        │  - Batch size: 100       │
        └──────────┬───────────────┘
                   │
                   │ Trigger
                   ▼
        ┌──────────────────────────────────┐
        │    AI Processing Lambda          │
        │  - Anomaly detection             │
        │  - Pattern recognition           │
        │  - Predictive insights           │
        │  - 1024MB RAM, 60s timeout       │
        │                                  │
        │  ┌──────────────────────────┐   │
        │  │  Built-in Model          │   │
        │  │  - TensorFlow.js         │   │
        │  │  - LSTM network          │   │
        │  │  - 95% accuracy          │   │
        │  └──────────┬───────────────┘   │
        │             │ OR                 │
        │  ┌──────────▼───────────────┐   │
        │  │  SageMaker Endpoint      │   │
        │  │  - Custom trained model  │   │
        │  │  - Real-time inference   │   │
        │  │  - Auto-scaling          │   │
        │  └──────────────────────────┘   │
        └──────────┬───────────────────────┘
                   │
                   │ Write insights
                   ▼
        ┌──────────────────────────┐
        │  DynamoDB: Insights      │
        │  - On-demand pricing     │
        │  - TTL: 180 days         │
        │  - GSI: severity         │
        └──────────┬───────────────┘
                   │
                   │ High severity
                   ▼
        ┌──────────────────────────┐
        │     EventBridge Rule     │
        │  - Filter: severity=HIGH │
        │  - Filter: severity=CRIT │
        └──────────┬───────────────┘
                   │
                   │ Publish
                   ▼
        ┌──────────────────────────┐
        │      SNS Topic           │
        │  - Email notifications   │
        │  - SMS (optional)        │
        │  - Webhook (optional)    │
        └──────────┬───────────────┘
                   │
                   ▼
            [Alert Recipients]


┌─────────────────────────────────────────────────────────────────────────┐
│                       Monitoring & Observability                         │
└─────────────────────────────────────────────────────────────────────────┘

        ┌──────────────────────────┐
        │   CloudWatch Logs        │
        │  - Lambda logs           │
        │  - API Gateway logs      │
        │  - Retention: 30 days    │
        └──────────────────────────┘

        ┌──────────────────────────┐
        │   CloudWatch Metrics     │
        │  - Lambda duration       │
        │  - API latency           │
        │  - DynamoDB capacity     │
        │  - Custom metrics        │
        └──────────────────────────┘

        ┌──────────────────────────┐
        │   CloudWatch Alarms      │
        │  - Error rate > 5%       │
        │  - Duration > 3000ms     │
        │  - 5xx errors > 10       │
        │  - Cost > $60/month      │
        └──────────────────────────┘

        ┌──────────────────────────┐
        │   CloudWatch Dashboard   │
        │  - System overview       │
        │  - Performance metrics   │
        │  - Cost tracking         │
        └──────────────────────────┘


┌─────────────────────────────────────────────────────────────────────────┐
│                    ML Training Pipeline (Optional)                       │
└─────────────────────────────────────────────────────────────────────────┘

        ┌──────────────────────────┐
        │   Training Data          │
        │   Generation Script      │
        │  - Historical metrics    │
        │  - Labeled anomalies     │
        └──────────┬───────────────┘
                   │
                   │ Upload
                   ▼
        ┌──────────────────────────┐
        │     S3 Bucket            │
        │  - Training data         │
        │  - Model artifacts       │
        │  - Versioning enabled    │
        │  - Lifecycle: 90 days    │
        └──────────┬───────────────┘
                   │
                   │ Read
                   ▼
        ┌──────────────────────────┐
        │   SageMaker Training     │
        │  - ml.m5.xlarge          │
        │  - Training time: 10-30m │
        │  - Auto-stop on complete │
        └──────────┬───────────────┘
                   │
                   │ Deploy
                   ▼
        ┌──────────────────────────┐
        │   SageMaker Endpoint     │
        │  - ml.t2.medium          │
        │  - Auto-scaling: 1-3     │
        │  - $0.05/hour            │
        └──────────────────────────┘
```

## Data Flow

### 1. Metric Ingestion Flow
```
Client → API Gateway → Lambda (Ingest) → DynamoDB (Metrics) → DynamoDB Streams
```

### 2. AI Processing Flow
```
DynamoDB Streams → Lambda (AI) → [Built-in Model OR SageMaker] → DynamoDB (Insights)
```

### 3. Alert Flow
```
DynamoDB (Insights) → EventBridge → SNS → Email/SMS/Webhook
```

### 4. Query Flow
```
Client → API Gateway → Lambda (Query) → DynamoDB → Response
```

## Component Details

### API Gateway
- **Type**: REST API
- **Endpoints**:
  - `POST /metrics` - Ingest metrics
  - `GET /metrics` - Query metrics
  - `GET /insights` - Get AI insights
- **Rate Limit**: 10,000 requests/sec
- **Throttle**: Burst 5,000 requests
- **Cost**: $3.50 per million requests (after free tier)

### Lambda Functions

#### Metrics Ingestion Lambda
- **Runtime**: Node.js 18
- **Memory**: 512 MB
- **Timeout**: 30 seconds
- **Concurrency**: 100 (reserved)
- **Cost**: Free tier covers 1M requests

#### AI Processing Lambda
- **Runtime**: Node.js 18 (TensorFlow.js) or Python 3.9 (SageMaker)
- **Memory**: 1024 MB
- **Timeout**: 60 seconds
- **Concurrency**: 50 (reserved)
- **Cost**: ~$0.0000166667 per invocation

### DynamoDB Tables

#### Metrics Table
- **Partition Key**: `hostname` (String)
- **Sort Key**: `timestamp` (Number)
- **Attributes**:
  - `cpuUsage` (Number)
  - `memoryUsage` (Number)
  - `diskIO` (Number)
  - `networkIO` (Number)
- **TTL**: 90 days
- **Billing**: On-demand
- **Cost**: $1.25 per million write requests, $0.25 per million read requests

#### Insights Table
- **Partition Key**: `insightId` (String)
- **Sort Key**: `timestamp` (Number)
- **GSI**: `severity-timestamp-index`
- **Attributes**:
  - `type` (String): anomaly, prediction, pattern
  - `severity` (String): LOW, MEDIUM, HIGH, CRITICAL
  - `confidence` (Number): 0-100
  - `message` (String)
  - `affectedHosts` (List)
- **TTL**: 180 days
- **Billing**: On-demand
- **Cost**: Same as Metrics table

### SageMaker (Optional)

#### Training Job
- **Instance**: ml.m5.xlarge
- **Training Time**: 10-30 minutes
- **Cost**: ~$0.23/hour → $0.05-0.15 per training

#### Endpoint
- **Instance**: ml.t2.medium
- **Auto-scaling**: 1-3 instances
- **Cost**: $0.05/hour → $36/month (continuous)

### EventBridge
- **Rule**: High severity insights
- **Filter**: `severity IN ["HIGH", "CRITICAL"]`
- **Target**: SNS topic
- **Cost**: Free (state changes), $1 per million custom events

### SNS
- **Topic**: Critical alerts
- **Protocols**: Email, SMS, HTTPS
- **Cost**: Email: $2 per 100,000, SMS: $0.00645 per message

### CloudWatch
- **Dashboards**: 2 (System, SageMaker)
- **Alarms**: 6 (Error rate, duration, throttles, 5xx, DynamoDB, cost)
- **Logs**: Lambda and API Gateway
- **Retention**: 30 days
- **Cost**: $3 per dashboard, $0.10 per alarm, $0.50 per GB ingested

## Cost Breakdown

### Base Infrastructure (No SageMaker)
```
Service              Monthly Cost    Notes
─────────────────────────────────────────────────────────────
API Gateway          $5-10           1M requests free tier
Lambda               $0-5            1M requests + 400K GB-sec free
DynamoDB             $0-2            25 GB + 200M requests free
EventBridge          $0-1            State changes free
SNS                  $0-1            1,000 emails free
CloudWatch           $0-5            10 metrics + 1M API requests free
S3 (optional)        $0-2            5 GB free
─────────────────────────────────────────────────────────────
TOTAL (no ML)        $5-25/month     Heavily leverages free tier
```

### With SageMaker
```
Service              Monthly Cost    Notes
─────────────────────────────────────────────────────────────
Base Infrastructure  $5-25           See above
SageMaker Training   $0-5            One-time or monthly retraining
SageMaker Endpoint   $36-108         $0.05/hr continuous or scaled
─────────────────────────────────────────────────────────────
TOTAL (with ML)      $40-140/month   Endpoint is main cost driver
```

### Cost Optimization Strategies

1. **Use Built-in Model**: Saves $36-108/month
2. **Schedule SageMaker**: Run endpoint only during business hours (saves 50%)
3. **Implement Caching**: Reduce Lambda invocations by 30-50%
4. **Optimize DynamoDB**: Use on-demand pricing for variable workloads
5. **Compress Logs**: Reduce CloudWatch ingestion costs

## Scalability

### Current Capacity
- **API Gateway**: 10,000 req/sec
- **Lambda**: 100 concurrent invocations
- **DynamoDB**: Auto-scales to millions of requests
- **SageMaker**: Auto-scales 1-3 instances

### Scaling Considerations
1. **Lambda Concurrency**: Increase reserved concurrency for higher load
2. **DynamoDB**: Switch to provisioned capacity for predictable workloads
3. **API Gateway**: Implement caching for read-heavy workloads
4. **Multi-Region**: Deploy to multiple regions for global availability

## Security

### Network Security
- All traffic over HTTPS/TLS 1.2+
- API Gateway with AWS WAF (optional)
- Lambda in VPC (optional, for private resources)

### IAM Roles
- Lambda execution roles with least privilege
- SageMaker training/endpoint roles
- API Gateway invoke roles

### Data Protection
- DynamoDB encryption at rest (AWS managed keys)
- S3 bucket encryption (SSE-S3)
- CloudWatch Logs encryption

### Monitoring
- CloudTrail for API audit logs
- GuardDuty for threat detection (optional)
- Security Hub for compliance (optional)

## Disaster Recovery

### Backup Strategy
- **DynamoDB**: Point-in-time recovery enabled
- **S3**: Versioning enabled
- **Lambda**: Code stored in version control
- **Infrastructure**: CDK code in Git

### Recovery Procedures
1. **Lambda Failure**: Automatic retries + DLQ
2. **DynamoDB Failure**: AWS handles replication across AZs
3. **Region Failure**: Deploy to secondary region (manual)
4. **Data Loss**: Restore from DynamoDB backup

## Monitoring Checklist

- [ ] CloudWatch Dashboard configured
- [ ] All 6 alarms created and tested
- [ ] SNS email subscriptions confirmed
- [ ] Lambda logs retention set to 30 days
- [ ] Cost Explorer tags configured
- [ ] Monthly budget alerts enabled
- [ ] Performance baseline established
- [ ] Error tracking dashboard created
