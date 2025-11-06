# PR-08: DynamoDB Schema

## Overview
Create DynamoDB tables for storing aggregated metrics, AI insights, and alert history with appropriate indexes for efficient querying.

## Dependencies
- PR-01: Core Infrastructure (for stack placement)

## AWS Credentials Setup
**IMPORTANT**: Ensure AWS credentials are configured before running CDK/CLI commands.

See `/Users/tyler/Desktop/Gauntlet/iops-dashboard/docs/AWS-credentials.md` for setup instructions.

## Objectives
- Design DynamoDB table schema for metrics and insights
- Create tables with appropriate partition/sort keys
- Add Global Secondary Indexes (GSI) for common query patterns
- Configure Time-to-Live (TTL) for auto-cleanup
- Set up backup and point-in-time recovery

## Step-by-Step Instructions

### 1. Create DynamoDB Stack
**File:** `cdk/lib/database-stack.ts`

```typescript
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';

export interface DatabaseStackProps extends cdk.StackProps {
  lambdaExecutionRole: iam.Role;
}

export class DatabaseStack extends cdk.Stack {
  public readonly metricsTable: dynamodb.Table;
  public readonly insightsTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    // ============================================================
    // METRICS TABLE
    // Stores aggregated operational metrics per entity
    // ============================================================
    this.metricsTable = new dynamodb.Table(this, 'MetricsTable', {
      tableName: 'iops-dashboard-metrics',
      partitionKey: {
        name: 'entity_id',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'entity_type',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST, // On-demand pricing
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Change to RETAIN for production
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES, // Enable streams for real-time updates
    });

    // GSI for querying by entity type and health score
    this.metricsTable.addGlobalSecondaryIndex({
      indexName: 'EntityTypeHealthIndex',
      partitionKey: {
        name: 'entity_type',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'health_score',
        type: dynamodb.AttributeType.NUMBER,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI for querying by last updated timestamp
    this.metricsTable.addGlobalSecondaryIndex({
      indexName: 'LastUpdatedIndex',
      partitionKey: {
        name: 'entity_type',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'last_updated',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ============================================================
    // INSIGHTS TABLE
    // Stores AI-generated insights and predictions
    // ============================================================
    this.insightsTable = new dynamodb.Table(this, 'InsightsTable', {
      tableName: 'iops-dashboard-insights',
      partitionKey: {
        name: 'pk', // Composite: insight#entity_id
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'sk', // timestamp for chronological ordering
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl', // Auto-delete old insights after 90 days
    });

    // GSI for querying by prediction type
    this.insightsTable.addGlobalSecondaryIndex({
      indexName: 'PredictionTypeIndex',
      partitionKey: {
        name: 'prediction_type',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI for querying by risk score
    this.insightsTable.addGlobalSecondaryIndex({
      indexName: 'RiskScoreIndex',
      partitionKey: {
        name: 'prediction_type',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'risk_score',
        type: dynamodb.AttributeType.NUMBER,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Grant read/write permissions to Lambda execution role
    this.metricsTable.grantReadWriteData(props.lambdaExecutionRole);
    this.insightsTable.grantReadWriteData(props.lambdaExecutionRole);

    // Outputs
    new cdk.CfnOutput(this, 'MetricsTableName', {
      value: this.metricsTable.tableName,
      description: 'DynamoDB table for operational metrics',
      exportName: 'IOpsDashboard-MetricsTableName',
    });

    new cdk.CfnOutput(this, 'MetricsTableArn', {
      value: this.metricsTable.tableArn,
      description: 'ARN of metrics table',
      exportName: 'IOpsDashboard-MetricsTableArn',
    });

    new cdk.CfnOutput(this, 'InsightsTableName', {
      value: this.insightsTable.tableName,
      description: 'DynamoDB table for AI insights',
      exportName: 'IOpsDashboard-InsightsTableName',
    });

    new cdk.CfnOutput(this, 'InsightsTableArn', {
      value: this.insightsTable.tableArn,
      description: 'ARN of insights table',
      exportName: 'IOpsDashboard-InsightsTableArn',
    });

    new cdk.CfnOutput(this, 'MetricsTableStreamArn', {
      value: this.metricsTable.tableStreamArn || 'N/A',
      description: 'DynamoDB stream ARN for real-time updates',
      exportName: 'IOpsDashboard-MetricsTableStreamArn',
    });
  }
}
```

### 2. Update CDK App to Include Database Stack
**File:** `cdk/bin/cdk.ts` (update)

```typescript
#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CoreStack } from '../lib/core-stack';
import { DatabaseStack } from '../lib/database-stack';
import { IntelligenceStack } from '../lib/intelligence-stack';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
};

// Deploy Core Stack (IAM roles, Kinesis, Lambdas)
const coreStack = new CoreStack(app, 'IOpsDashboard-CoreStack', {
  env,
  description: 'Core infrastructure for Intelligent Operations Dashboard',
});

// Deploy Database Stack (DynamoDB tables)
const databaseStack = new DatabaseStack(app, 'IOpsDashboard-DatabaseStack', {
  env,
  description: 'DynamoDB tables for metrics and insights',
  lambdaExecutionRole: coreStack.lambdaExecutionRole,
});

// Deploy Intelligence Stack (EventBridge, AI, SNS)
const intelligenceStack = new IntelligenceStack(app, 'IOpsDashboard-IntelligenceStack', {
  env,
  description: 'AI inference and alerting',
  lambdaExecutionRole: coreStack.lambdaExecutionRole,
});

app.synth();
```

### 3. Document Table Schemas
**File:** `docs/database-schema.md`

```markdown
# DynamoDB Schema Documentation

## Metrics Table

**Table Name:** `iops-dashboard-metrics`

### Primary Key
- **Partition Key:** `entity_id` (STRING) - Unique identifier (student_id, tutor_id, subject)
- **Sort Key:** `entity_type` (STRING) - Entity type: student, tutor, subject, region

### Attributes
| Attribute | Type | Description |
|-----------|------|-------------|
| entity_id | STRING | Primary identifier |
| entity_type | STRING | student, tutor, subject, region |
| sessions_7d | NUMBER | Session count last 7 days |
| sessions_14d | NUMBER | Session count last 14 days |
| sessions_30d | NUMBER | Session count last 30 days |
| ib_calls_7d | NUMBER | IB call count last 7 days |
| ib_calls_14d | NUMBER | IB call count last 14 days |
| avg_rating | NUMBER | Average rating (0-5) |
| health_score | NUMBER | Health score (0-100) |
| last_updated | STRING | ISO8601 timestamp |

### Global Secondary Indexes

**EntityTypeHealthIndex:**
- Partition Key: `entity_type`
- Sort Key: `health_score`
- Use Case: Find all students with health_score < 70

**LastUpdatedIndex:**
- Partition Key: `entity_type`
- Sort Key: `last_updated`
- Use Case: Find recently updated entities

### Example Item
```json
{
  "entity_id": "stu_4532",
  "entity_type": "student",
  "sessions_7d": 2,
  "sessions_14d": 5,
  "sessions_30d": 12,
  "ib_calls_7d": 1,
  "ib_calls_14d": 3,
  "avg_rating": 4.5,
  "health_score": 72,
  "last_updated": "2025-01-15T10:30:00Z"
}
```

---

## Insights Table

**Table Name:** `iops-dashboard-insights`

### Primary Key
- **Partition Key:** `pk` (STRING) - Format: `insight#{entity_id}`
- **Sort Key:** `sk` (STRING) - ISO8601 timestamp

### Attributes
| Attribute | Type | Description |
|-----------|------|-------------|
| pk | STRING | insight#{entity_id} |
| sk | STRING | ISO8601 timestamp |
| alert_id | STRING | Unique alert identifier |
| entity_id | STRING | Related entity ID |
| prediction_type | STRING | Alert type |
| risk_score | NUMBER | Risk score (0-100) |
| explanation | STRING | AI-generated explanation |
| recommendations | LIST | Array of recommendation strings |
| timestamp | STRING | ISO8601 timestamp |
| model_used | STRING | AI model identifier |
| ttl | NUMBER | Unix timestamp for auto-deletion |

### Global Secondary Indexes

**PredictionTypeIndex:**
- Partition Key: `prediction_type`
- Sort Key: `timestamp`
- Use Case: Find all churn risk predictions

**RiskScoreIndex:**
- Partition Key: `prediction_type`
- Sort Key: `risk_score`
- Use Case: Find highest risk predictions

### Example Item
```json
{
  "pk": "insight#stu_4532",
  "sk": "2025-01-15T10:30:00Z",
  "alert_id": "high_ib_call_frequency_stu_4532_1705318200000",
  "entity_id": "stu_4532",
  "prediction_type": "high_ib_call_frequency",
  "risk_score": 82,
  "explanation": "Student shows high IB call frequency with declining health score...",
  "recommendations": [
    "Schedule immediate check-in call",
    "Review IB call transcripts",
    "Offer session with senior tutor"
  ],
  "timestamp": "2025-01-15T10:30:00Z",
  "model_used": "bedrock-claude-3.5-haiku",
  "ttl": 1712822400
}
```

### Query Examples

#### Get all insights for a student
```
PK = insight#stu_4532
SK begins_with 2025-01
```

#### Find high-risk churn predictions
```
GSI: RiskScoreIndex
PK = high_ib_call_frequency
SK > 80
```

#### Find students with low health scores
```
GSI: EntityTypeHealthIndex
PK = student
SK < 70
```
```

### 4. Deploy Database Stack
```bash
cd cdk
npm run build
cdk deploy IOpsDashboard-DatabaseStack
```

### 5. Verify Tables Created
```bash
# List tables
aws dynamodb list-tables

# Describe metrics table
aws dynamodb describe-table --table-name iops-dashboard-metrics

# Describe insights table
aws dynamodb describe-table --table-name iops-dashboard-insights

# Verify GSIs
aws dynamodb describe-table --table-name iops-dashboard-metrics \
  | jq '.Table.GlobalSecondaryIndexes'
```

## Verification Steps

### 1. Insert Test Data into Metrics Table
```bash
aws dynamodb put-item \
  --table-name iops-dashboard-metrics \
  --item '{
    "entity_id": {"S": "stu_test_001"},
    "entity_type": {"S": "student"},
    "sessions_7d": {"N": "3"},
    "sessions_14d": {"N": "7"},
    "sessions_30d": {"N": "15"},
    "ib_calls_7d": {"N": "0"},
    "ib_calls_14d": {"N": "2"},
    "avg_rating": {"N": "4.5"},
    "health_score": {"N": "85"},
    "last_updated": {"S": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}
  }'
```

### 2. Query Test Data
```bash
# Get by primary key
aws dynamodb get-item \
  --table-name iops-dashboard-metrics \
  --key '{
    "entity_id": {"S": "stu_test_001"},
    "entity_type": {"S": "student"}
  }'

# Query GSI for all students
aws dynamodb query \
  --table-name iops-dashboard-metrics \
  --index-name EntityTypeHealthIndex \
  --key-condition-expression "entity_type = :et" \
  --expression-attribute-values '{
    ":et": {"S": "student"}
  }'
```

### 3. Insert Test Insight
```bash
aws dynamodb put-item \
  --table-name iops-dashboard-insights \
  --item '{
    "pk": {"S": "insight#stu_test_001"},
    "sk": {"S": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"},
    "alert_id": {"S": "test_alert_001"},
    "entity_id": {"S": "stu_test_001"},
    "prediction_type": {"S": "low_health_score"},
    "risk_score": {"N": "45"},
    "explanation": {"S": "Test insight explanation"},
    "recommendations": {"L": [
      {"S": "Test recommendation 1"},
      {"S": "Test recommendation 2"}
    ]},
    "timestamp": {"S": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"},
    "model_used": {"S": "test-model"},
    "ttl": {"N": "'$(($(date +%s) + 7776000))'"}
  }'
```

### 4. Test DynamoDB Streams
```bash
# Get stream ARN
STREAM_ARN=$(aws dynamodb describe-table \
  --table-name iops-dashboard-metrics \
  --query 'Table.LatestStreamArn' \
  --output text)

# Describe stream
aws dynamodbstreams describe-stream --stream-arn $STREAM_ARN

# Get records (for future WebSocket integration)
SHARD_ID=$(aws dynamodbstreams describe-stream \
  --stream-arn $STREAM_ARN \
  --query 'StreamDescription.Shards[0].ShardId' \
  --output text)

ITERATOR=$(aws dynamodbstreams get-shard-iterator \
  --stream-arn $STREAM_ARN \
  --shard-id $SHARD_ID \
  --shard-iterator-type LATEST \
  --query 'ShardIterator' \
  --output text)

aws dynamodbstreams get-records --shard-iterator $ITERATOR
```

### 5. Create Query Helper Scripts
**File:** `scripts/query-metrics.sh`

```bash
#!/bin/bash

# Query students by health score
aws dynamodb query \
  --table-name iops-dashboard-metrics \
  --index-name EntityTypeHealthIndex \
  --key-condition-expression "entity_type = :et AND health_score < :hs" \
  --expression-attribute-values '{
    ":et": {"S": "student"},
    ":hs": {"N": "70"}
  }' \
  | jq '.Items[] | {
      student_id: .entity_id.S,
      health_score: .health_score.N,
      sessions_7d: .sessions_7d.N,
      ib_calls_14d: .ib_calls_14d.N
    }'
```

**File:** `scripts/query-insights.sh`

```bash
#!/bin/bash

ENTITY_ID=${1:-"stu_test_001"}

# Get all insights for an entity
aws dynamodb query \
  --table-name iops-dashboard-insights \
  --key-condition-expression "pk = :pk" \
  --expression-attribute-values "{
    \":pk\": {\"S\": \"insight#$ENTITY_ID\"}
  }" \
  --scan-index-forward false \
  --limit 10 \
  | jq '.Items[] | {
      timestamp: .sk.S,
      prediction_type: .prediction_type.S,
      risk_score: .risk_score.N,
      explanation: .explanation.S
    }'
```

Make executable:
```bash
chmod +x scripts/query-metrics.sh scripts/query-insights.sh
```

## Performance Optimization

### Enable Auto Scaling (Optional)
If switching from on-demand to provisioned capacity:

```typescript
this.metricsTable = new dynamodb.Table(this, 'MetricsTable', {
  // ... other settings
  billingMode: dynamodb.BillingMode.PROVISIONED,
  readCapacity: 5,
  writeCapacity: 5,
});

// Add auto-scaling
this.metricsTable.autoScaleReadCapacity({
  minCapacity: 5,
  maxCapacity: 100,
}).scaleOnUtilization({ targetUtilizationPercent: 70 });

this.metricsTable.autoScaleWriteCapacity({
  minCapacity: 5,
  maxCapacity: 100,
}).scaleOnUtilization({ targetUtilizationPercent: 70 });
```

## Troubleshooting

### Issue: Table Already Exists
**Solution:**
```bash
# Delete table (WARNING: loses all data)
aws dynamodb delete-table --table-name iops-dashboard-metrics

# Wait for deletion
aws dynamodb wait table-not-exists --table-name iops-dashboard-metrics

# Redeploy
cdk deploy IOpsDashboard-DatabaseStack
```

### Issue: GSI Not Found
**Cause:** Index still being created
**Check:**
```bash
aws dynamodb describe-table --table-name iops-dashboard-metrics \
  | jq '.Table.GlobalSecondaryIndexes[].IndexStatus'
```

Wait for status to be "ACTIVE"

### Issue: Permission Denied
**Solution:** Verify Lambda role has permissions:
```bash
# Check table policy
aws dynamodb describe-table --table-name iops-dashboard-metrics \
  | jq '.Table.TableArn'

# Verify Lambda role can access
```

## Files Created
- `cdk/lib/database-stack.ts`
- `cdk/bin/cdk.ts` (updated)
- `docs/database-schema.md`
- `scripts/query-metrics.sh`
- `scripts/query-insights.sh`

## Next Steps
- PR-04: Update Processing Lambda to use tables
- PR-05: Update AI Lambda to use insights table
- PR-10: Frontend WebSocket (use DynamoDB Streams)

## Estimated Time
- 45-60 minutes

## Skills Required
- DynamoDB concepts (partition keys, GSIs, TTL)
- Basic data modeling
- AWS CLI for DynamoDB

## References
- [DynamoDB Best Practices](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/best-practices.html)
- [DynamoDB Streams](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Streams.html)
- [GSI Design](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GSI.html)
- [TTL](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html)
