# PR-10: WebSocket API and Real-Time Updates - Implementation Summary

## Overview

Successfully implemented WebSocket API Gateway with DynamoDB Streams integration to enable real-time dashboard updates for the IOps Dashboard application.

## Implementation Details

### 1. Infrastructure (CDK)

#### New Stack: ExperienceStack (`cdk/lib/experience-stack.ts`)

Created a dedicated CDK stack for the WebSocket API and real-time update infrastructure:

- **WebSocket API Gateway v2**
  - Endpoint: `wss://<api-id>.execute-api.<region>.amazonaws.com/prod`
  - Routes: `$connect`, `$disconnect`
  - Stage: `prod` with auto-deployment enabled

- **DynamoDB Connections Table**
  - Table: `iops-dashboard-websocket-connections`
  - Primary Key: `connectionId` (String)
  - GSI: `ConnectedAtIndex` for querying by connected timestamp
  - TTL: 24-hour automatic cleanup of stale connections
  - Stores: connection metadata (IP, user agent, timestamp)

- **Lambda Functions**
  - Connect Handler: Manages new WebSocket connections
  - Disconnect Handler: Cleans up closed connections
  - Stream Processor: Broadcasts DynamoDB updates to all connected clients

#### Updated: CoreStack (`cdk/lib/cdk-stack.ts`)

- **Enabled DynamoDB Streams** on metrics table
  - Stream View Type: `NEW_AND_OLD_IMAGES`
  - Allows tracking both before and after states of records

- **Fixed Kinesis Event Source**
  - Migrated from `EventSourceMapping` to `KinesisEventSource`
  - Proper CDK best practices for event source bindings

#### Updated: CDK Entry Point (`cdk/bin/cdk.ts`)

- Instantiate both CoreStack and ExperienceStack
- Pass metrics table reference to ExperienceStack
- Proper dependency management between stacks

### 2. Lambda Functions (TypeScript)

#### Connect Handler (`lambda/websocket/connect.ts`)

```typescript
// Handles WebSocket $connect route
- Extracts connection ID from request context
- Captures client metadata (IP, user agent)
- Stores connection in DynamoDB with 24h TTL
- Returns 200 OK on success
```

**Key Features:**
- Graceful error handling
- Automatic TTL for cleanup
- Connection metadata tracking

#### Disconnect Handler (`lambda/websocket/disconnect.ts`)

```typescript
// Handles WebSocket $disconnect route
- Extracts connection ID from request context
- Removes connection from DynamoDB
- Returns 200 OK on success
```

**Key Features:**
- Cleanup on disconnect
- Error logging for debugging

#### Stream Processor (`lambda/websocket/stream-processor.ts`)

```typescript
// Triggered by DynamoDB Streams on metrics table
- Scans all active connections from connections table
- Unmarshalls DynamoDB Stream records to JavaScript objects
- Batches updates into broadcast messages
- Posts to all WebSocket connections via API Gateway Management API
- Removes stale connections (GoneException handling)
```

**Key Features:**
- Batch processing (100 records, 5-second window)
- Stale connection cleanup
- Comprehensive error handling
- Message format: `{ type: 'METRICS_UPDATE', updates: [...] }`

### 3. Configuration

#### Package Configuration (`lambda/websocket/package.json`)

Dependencies:
- `@aws-sdk/client-apigatewaymanagementapi` - WebSocket message posting
- `@aws-sdk/client-dynamodb` - DynamoDB operations
- `@aws-sdk/lib-dynamodb` - Document client for easier DynamoDB operations
- `@aws-sdk/util-dynamodb` - Unmarshalling Stream records
- `@types/aws-lambda` - TypeScript types for Lambda handlers

#### TypeScript Configuration (`lambda/websocket/tsconfig.json`)

- Target: ES2022
- Module: CommonJS (for Lambda Node.js runtime)
- Strict mode enabled
- Output directory: `dist/`

### 4. IAM Permissions

#### Lambda Execution Role Permissions

**All WebSocket Lambdas:**
- `logs:CreateLogGroup`
- `logs:CreateLogStream`
- `logs:PutLogEvents`

**Connect/Disconnect Handlers:**
- `dynamodb:PutItem` (connections table)
- `dynamodb:DeleteItem` (connections table)

**Stream Processor:**
- `dynamodb:Scan` (connections table - get all active connections)
- `dynamodb:DeleteItem` (connections table - cleanup stale connections)
- `dynamodb:DescribeStream` (metrics table stream)
- `dynamodb:GetRecords` (metrics table stream)
- `dynamodb:GetShardIterator` (metrics table stream)
- `dynamodb:ListStreams` (metrics table stream)
- `execute-api:ManageConnections` - Critical for posting to WebSocket connections

### 5. CloudFormation Outputs

New outputs from ExperienceStack:

- `WebSocketUrl` - WebSocket endpoint URL for client connections
- `WebSocketApiId` - API Gateway WebSocket API ID
- `ConnectionsTableName` - DynamoDB connections table name
- `StreamProcessorFunctionName` - Stream processor Lambda function name

## Architecture Flow

### Connection Flow

```
1. Client connects to WebSocket URL
   ↓
2. API Gateway invokes Connect Handler
   ↓
3. Connection ID stored in DynamoDB connections table
   ↓
4. Client receives connection confirmation
```

### Real-Time Update Flow

```
1. Processing Lambda writes metric to DynamoDB metrics table
   ↓
2. DynamoDB Stream triggers Stream Processor Lambda
   ↓
3. Stream Processor queries all active connections
   ↓
4. Stream Processor unmarshalls DynamoDB record
   ↓
5. Stream Processor posts message to all WebSocket connections
   ↓
6. Connected clients receive real-time update
```

### Disconnection Flow

```
1. Client disconnects (or connection drops)
   ↓
2. API Gateway invokes Disconnect Handler
   ↓
3. Connection ID removed from DynamoDB connections table
```

### Stale Connection Cleanup

```
1. Stream Processor attempts to post to connection
   ↓
2. API Gateway returns GoneException (connection stale)
   ↓
3. Stream Processor removes connection from DynamoDB
```

## Message Format

Clients receive messages in the following JSON format:

```json
{
  "type": "METRICS_UPDATE",
  "updates": [
    {
      "eventType": "INSERT",
      "timestamp": 1699123456789,
      "data": {
        "entity_id": "stream-001",
        "entity_type": "stream",
        "metric_value": 1234,
        "timestamp": "2024-11-04T12:34:56Z"
      }
    }
  ]
}
```

**Event Types:**
- `INSERT` - New record added to DynamoDB
- `MODIFY` - Existing record updated in DynamoDB
- `REMOVE` - Record deleted from DynamoDB

## Performance Characteristics

### Stream Processor

- **Batch Size:** 100 records
- **Batch Window:** 5 seconds
- **Memory:** 512 MB
- **Timeout:** 5 minutes
- **Retry Attempts:** 3
- **Bisect on Error:** Enabled

### Connections Table

- **Billing Mode:** Pay-per-request (scales automatically)
- **TTL:** 24 hours (automatic cleanup)
- **GSI:** ConnectedAtIndex for time-based queries

## Deployment

### Build Lambda Functions

```bash
cd lambda/websocket
npm install
npm run build
```

### Deploy Infrastructure

```bash
cd cdk
npm run build
cdk deploy IOpsDashboard-ExperienceStack
```

Note: CoreStack must be deployed first (or updated if already deployed) to enable DynamoDB Streams.

### Update Existing Stack

If CoreStack is already deployed, update it first to enable streams:

```bash
cdk deploy IOpsDashboard-CoreStack
```

Then deploy the new ExperienceStack:

```bash
cdk deploy IOpsDashboard-ExperienceStack
```

## Testing

### Connect to WebSocket

```javascript
const ws = new WebSocket('wss://<api-id>.execute-api.<region>.amazonaws.com/prod');

ws.onopen = () => console.log('Connected');
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  console.log('Received:', message);
};
```

### Trigger Update

Write a record to DynamoDB metrics table (via Processing Lambda or manually):

```bash
aws dynamodb put-item \
  --table-name iops-dashboard-metrics \
  --item '{
    "entity_id": {"S": "test-stream-001"},
    "entity_type": {"S": "stream"},
    "metric_value": {"N": "1234"},
    "timestamp": {"S": "2024-11-04T12:34:56Z"}
  }'
```

WebSocket clients will receive the update in real-time.

## Monitoring

### Key Metrics

1. **Lambda Invocations**
   - `ConnectFunction` - New connections per minute
   - `DisconnectFunction` - Disconnections per minute
   - `StreamProcessorFunction` - Stream processing invocations

2. **Lambda Errors**
   - `ConnectFunction` - Failed connections
   - `StreamProcessorFunction` - Broadcast failures

3. **DynamoDB**
   - `ConnectionsTable` - Read/write capacity units
   - `MetricsTable` - Stream iterator age

4. **API Gateway**
   - Connection count
   - Message count
   - Integration errors

### CloudWatch Logs

- `/aws/lambda/IOpsDashboard-ExperienceStack-ConnectFunction-*`
- `/aws/lambda/IOpsDashboard-ExperienceStack-DisconnectFunction-*`
- `/aws/lambda/IOpsDashboard-ExperienceStack-StreamProcessorFunction-*`

## Files Created

```
cdk/lib/experience-stack.ts           - CDK stack for WebSocket infrastructure
lambda/websocket/connect.ts            - WebSocket connect handler
lambda/websocket/disconnect.ts         - WebSocket disconnect handler
lambda/websocket/stream-processor.ts   - DynamoDB Stream to WebSocket broadcaster
lambda/websocket/package.json          - Node.js dependencies
lambda/websocket/tsconfig.json         - TypeScript configuration
lambda/websocket/.gitignore            - Git ignore rules
lambda/websocket/README.md             - Lambda documentation
docs/PR-10-IMPLEMENTATION-SUMMARY.md   - This file
```

## Files Modified

```
cdk/bin/cdk.ts                         - Added ExperienceStack instantiation
cdk/lib/cdk-stack.ts                   - Enabled DynamoDB Streams, fixed event sources
```

## Dependencies

### NPM Packages

- `@aws-cdk-lib/aws-apigatewayv2` - WebSocket API Gateway v2
- `@aws-cdk-lib/aws-apigatewayv2-integrations` - WebSocket Lambda integrations
- `@aws-cdk-lib/aws-lambda-event-sources` - DynamoDB Stream event source

### AWS Services

- API Gateway v2 (WebSocket API)
- Lambda (3 functions)
- DynamoDB (2 tables with Streams)
- CloudWatch Logs
- IAM

## Security Considerations

### Current Implementation

- No authentication/authorization on WebSocket connections (to be added in future PR)
- Public WebSocket endpoint
- Connection metadata logged (IP, user agent)
- TTL-based cleanup of stale connections

### Future Enhancements

1. Add authentication via custom authorizer Lambda
2. Implement JWT token validation
3. Add rate limiting per connection
4. Implement selective subscriptions (topic-based)
5. Add message encryption for sensitive data
6. Implement connection heartbeat/ping-pong

## Cost Considerations

- **API Gateway:** $1.00 per million messages + $0.25 per million connection minutes
- **Lambda:** Pay per invocation and duration
- **DynamoDB:** Pay-per-request (no fixed costs, scales automatically)
- **CloudWatch Logs:** Standard log storage and ingestion costs

For development/testing with low traffic: ~$0.50-$2.00 per day

## Success Criteria

✅ WebSocket API Gateway created and deployed
✅ Connect/Disconnect handlers functional
✅ DynamoDB Streams enabled on metrics table
✅ Stream Processor broadcasting updates to all connected clients
✅ Stale connection cleanup implemented
✅ IAM permissions properly configured
✅ CloudFormation outputs for WebSocket URL
✅ TypeScript builds without errors
✅ Documentation complete

## Next Steps (Frontend Integration)

1. Update React frontend to connect to WebSocket URL (PR-09)
2. Implement WebSocket connection management in frontend
3. Handle reconnection logic
4. Display real-time metrics in dashboard UI
5. Add visual indicators for connection status
6. Implement error handling for WebSocket failures

## References

- AWS API Gateway v2 WebSocket APIs: https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-websocket-api.html
- DynamoDB Streams: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Streams.html
- API Gateway Management API: https://docs.aws.amazon.com/apigatewayv2/latest/api-reference/api-apigatewaymanagementapi.html
