# PR-02: Data Ingestion Lambda

## Overview
Create the data ingestion Lambda function that receives events from external sources (API Gateway) and forwards them to Kinesis Data Stream for processing.

## Dependencies
- PR-01: Core Infrastructure (requires Lambda execution role)

## AWS Credentials Setup
**IMPORTANT**: Ensure AWS credentials are configured before running CDK/CLI commands.

See `/Users/tyler/Desktop/Gauntlet/iops-dashboard/docs/AWS-credentials.md` for setup instructions.

## Objectives
- Create Kinesis Data Stream for event ingestion
- Build Lambda function to validate and forward events
- Set up API Gateway endpoint for external event submission
- Add schema validation for incoming events

## Step-by-Step Instructions

### 1. Add Kinesis to Core Stack
**File:** `cdk/lib/core-stack.ts` (update)

Add import:
```typescript
import * as kinesis from 'aws-cdk-lib/aws-kinesis';
```

Add to CoreStack class:
```typescript
// Add as public property
public readonly eventStream: kinesis.Stream;

// Add in constructor after lambdaExecutionRole
this.eventStream = new kinesis.Stream(this, 'EventStream', {
  streamName: 'iops-dashboard-events',
  shardCount: 2, // Start with 2 shards for 50+ concurrent streams
  retentionPeriod: cdk.Duration.hours(24),
  streamMode: kinesis.StreamMode.PROVISIONED,
});

// Grant Lambda role permissions to write to stream
this.eventStream.grantWrite(this.lambdaExecutionRole);

// Output stream name
new cdk.CfnOutput(this, 'EventStreamName', {
  value: this.eventStream.streamName,
  description: 'Kinesis stream for event ingestion',
  exportName: 'IOpsDashboard-EventStreamName',
});
```

### 2. Create Lambda Function Code
**File:** `lambda/ingest/index.ts`

```typescript
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { KinesisClient, PutRecordCommand } from '@aws-sdk/client-kinesis';

const kinesis = new KinesisClient({ region: process.env.AWS_REGION });
const STREAM_NAME = process.env.KINESIS_STREAM_NAME!;

// Valid event types based on PRD
const VALID_EVENT_TYPES = [
  'session_started',
  'session_completed',
  'ib_call_logged',
  'tutor_availability_updated',
  'customer_health_update',
  'supply_demand_update',
];

interface IncomingEvent {
  event_type: string;
  timestamp?: string;
  payload: Record<string, any>;
}

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('Received event:', JSON.stringify(event, null, 2));

  try {
    // Parse request body
    if (!event.body) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Request body is required' }),
      };
    }

    const incomingEvent: IncomingEvent = JSON.parse(event.body);

    // Validate event structure
    if (!incomingEvent.event_type) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'event_type is required' }),
      };
    }

    // Validate event type
    if (!VALID_EVENT_TYPES.includes(incomingEvent.event_type)) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: `Invalid event_type. Must be one of: ${VALID_EVENT_TYPES.join(', ')}`,
        }),
      };
    }

    // Validate payload exists
    if (!incomingEvent.payload) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'payload is required' }),
      };
    }

    // Add timestamp if not provided
    const enrichedEvent = {
      ...incomingEvent,
      timestamp: incomingEvent.timestamp || new Date().toISOString(),
      ingested_at: new Date().toISOString(),
    };

    // Write to Kinesis
    const command = new PutRecordCommand({
      StreamName: STREAM_NAME,
      Data: Buffer.from(JSON.stringify(enrichedEvent)),
      PartitionKey: incomingEvent.event_type, // Partition by event type
    });

    const result = await kinesis.send(command);

    console.log('Successfully written to Kinesis:', result.SequenceNumber);

    return {
      statusCode: 202,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Event accepted',
        sequenceNumber: result.SequenceNumber,
        shardId: result.ShardId,
      }),
    };
  } catch (error) {
    console.error('Error processing event:', error);

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};
```

### 3. Create package.json for Lambda
**File:** `lambda/ingest/package.json`

```json
{
  "name": "ingest-lambda",
  "version": "1.0.0",
  "description": "Data ingestion Lambda for IOps Dashboard",
  "main": "index.js",
  "scripts": {
    "build": "tsc",
    "test": "jest"
  },
  "dependencies": {
    "@aws-sdk/client-kinesis": "^3.450.0"
  },
  "devDependencies": {
    "@types/aws-lambda": "^8.10.130",
    "@types/node": "^20.10.0",
    "typescript": "^5.3.0"
  }
}
```

### 4. Create TypeScript config for Lambda
**File:** `lambda/ingest/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

### 5. Install Lambda Dependencies
```bash
cd lambda/ingest
npm install
npm run build
```

### 6. Add Lambda to CDK Stack
**File:** `cdk/lib/core-stack.ts` (update)

Add imports:
```typescript
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as path from 'path';
```

Add to CoreStack constructor (after eventStream):
```typescript
// Create Ingestion Lambda (TypeScript)
const ingestLambda = new lambda.Function(this, 'IngestFunction', {
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: 'index.handler',
  code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/ingest/dist')),
  role: this.lambdaExecutionRole,
  environment: {
    KINESIS_STREAM_NAME: this.eventStream.streamName,
  },
  timeout: cdk.Duration.seconds(30),
  memorySize: 256,
  description: 'Ingests events into Kinesis stream (TypeScript)',
});

// Create API Gateway for ingestion endpoint
const api = new apigateway.RestApi(this, 'IngestApi', {
  restApiName: 'IOpsDashboard-IngestApi',
  description: 'API Gateway for event ingestion',
  deployOptions: {
    stageName: 'prod',
    throttlingBurstLimit: 1000,
    throttlingRateLimit: 500,
  },
});

const ingestResource = api.root.addResource('ingest');
ingestResource.addMethod('POST', new apigateway.LambdaIntegration(ingestLambda));

// Output API URL
new cdk.CfnOutput(this, 'IngestApiUrl', {
  value: api.url,
  description: 'URL of the ingestion API',
  exportName: 'IOpsDashboard-IngestApiUrl',
});
```

### 7. Deploy Stack
```bash
cd cdk
npm run build
cdk deploy CdkStack
```

## Verification Steps

### 1. Test API Endpoint
```bash
# Get the API URL from stack outputs
API_URL=$(aws cloudformation describe-stacks \
  --stack-name CdkStack \
  --query 'Stacks[0].Outputs[?OutputKey==`IngestApiUrl`].OutputValue' \
  --output text)

# Send test event
curl -X POST ${API_URL}ingest \
  -H "Content-Type: application/json" \
  -d '{
    "event_type": "session_started",
    "payload": {
      "session_id": "sess_123",
      "student_id": "stu_456",
      "tutor_id": "tut_789"
    }
  }'
```

Expected response:
```json
{
  "message": "Event received successfully",
  "eventType": "session_started",
  "sequenceNumber": "...",
  "shardId": "..."
}
```

### 2. Verify Kinesis Stream
```bash
# Check stream status
aws kinesis describe-stream --stream-name iops-dashboard-events

# Get records (should see your test event)
SHARD_ITERATOR=$(aws kinesis get-shard-iterator \
  --stream-name iops-dashboard-events \
  --shard-id shardId-000000000000 \
  --shard-iterator-type TRIM_HORIZON \
  --query 'ShardIterator' \
  --output text)

aws kinesis get-records --shard-iterator $SHARD_ITERATOR
```

### 3. Check CloudWatch Logs
```bash
aws logs tail /aws/lambda/CdkStack-IngestFunction --follow
```

## Testing Invalid Events

```bash
# Missing event_type
curl -X POST $API_URL \
  -H "Content-Type: application/json" \
  -d '{"payload": {}}'

# Invalid event_type
curl -X POST $API_URL \
  -H "Content-Type: application/json" \
  -d '{
    "event_type": "invalid_event",
    "payload": {}
  }'
```

Both should return 400 errors with descriptive messages.

## Troubleshooting

### Issue: Lambda Build Fails
**Solution:**
```bash
cd lambda/ingest
rm -rf node_modules dist
npm install
npm run build
```

### Issue: Kinesis Permission Denied
**Solution:** Verify IAM role has write permissions:
```bash
aws iam get-role-policy --role-name <LambdaRoleName> --policy-name <PolicyName>
```

### Issue: API Gateway 500 Error
**Solution:** Check Lambda logs for specific error:
```bash
aws logs tail /aws/lambda/IOpsDashboard-CoreStack-IngestFunction --since 5m
```

## Files Created
- `lambda/ingest/index.ts`
- `lambda/ingest/package.json`
- `lambda/ingest/tsconfig.json`
- `cdk/lib/core-stack.ts` (updated)

## Next Steps
- PR-03: Synthetic Data Generator (will use this API endpoint)
- PR-04: Processing Lambda (will read from Kinesis stream)

## Estimated Time
- 45-60 minutes

## Skills Required
- Basic TypeScript
- Understanding of REST APIs
- Basic AWS Lambda knowledge
- Kinesis concepts (streams, shards, partition keys)

## References
- [AWS Lambda TypeScript](https://docs.aws.amazon.com/lambda/latest/dg/lambda-typescript.html)
- [Amazon Kinesis Data Streams](https://docs.aws.amazon.com/kinesis/)
- [API Gateway Lambda Integration](https://docs.aws.amazon.com/apigateway/latest/developerguide/getting-started-with-lambda-integration.html)
