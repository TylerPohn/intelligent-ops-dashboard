# WebSocket Lambda Handlers for Real-Time Dashboard Updates

This directory contains the WebSocket Lambda handlers that enable real-time updates for the IOps Dashboard.

## Architecture Overview

The WebSocket implementation consists of three main Lambda functions:

1. **Connect Handler** (`connect.ts`) - Handles WebSocket connection events
2. **Disconnect Handler** (`disconnect.ts`) - Handles WebSocket disconnection events
3. **Stream Processor** (`stream-processor.ts`) - Processes DynamoDB Streams and broadcasts to WebSocket clients

## How It Works

### Connection Flow

1. Client connects to WebSocket API endpoint
2. **Connect Handler** is invoked:
   - Stores connection ID in DynamoDB connections table
   - Records connection metadata (timestamp, source IP, user agent)
   - Sets TTL for automatic cleanup of stale connections (24 hours)

3. Client disconnects (or connection drops)
4. **Disconnect Handler** is invoked:
   - Removes connection ID from DynamoDB connections table

### Real-Time Update Flow

1. Processing Lambda writes/updates metrics in DynamoDB metrics table
2. DynamoDB Stream triggers **Stream Processor** Lambda
3. Stream Processor:
   - Queries all active connections from connections table
   - Unmarshalls DynamoDB Stream records into JavaScript objects
   - Broadcasts updates to all connected WebSocket clients
   - Handles stale connections (removes from DB if GoneException)
   - Uses `execute-api:ManageConnections` to post messages

## Database Schema

### Connections Table (`iops-dashboard-websocket-connections`)

```
connectionId (String, Primary Key) - WebSocket connection ID
connected (String, GSI Partition Key) - Always "true" for active connections
connectedAt (Number, GSI Sort Key) - Unix timestamp of connection
sourceIp (String) - Client IP address
userAgent (String) - Client user agent
ttl (Number) - Time-to-live for automatic cleanup (24 hours)
```

### Metrics Table Streams

The metrics table has DynamoDB Streams enabled with `NEW_AND_OLD_IMAGES` view type, allowing the Stream Processor to see both the before and after state of each record change.

## WebSocket Message Format

Clients receive messages in the following JSON format:

```json
{
  "type": "METRICS_UPDATE",
  "updates": [
    {
      "eventType": "INSERT|MODIFY|REMOVE",
      "timestamp": 1699123456789,
      "data": {
        "entity_id": "stream-001",
        "entity_type": "stream",
        "metric_value": 1234,
        "timestamp": "2024-11-04T12:34:56Z",
        ...
      }
    }
  ]
}
```

## Building and Deploying

### Build

```bash
npm install
npm run build
```

This compiles TypeScript to JavaScript in the `dist/` directory.

### Deploy

The Lambda functions are automatically deployed by CDK when you run:

```bash
cd ../../cdk
cdk deploy IOpsDashboard-ExperienceStack
```

## Environment Variables

### Connect Handler
- `CONNECTIONS_TABLE_NAME` - DynamoDB table for tracking connections

### Disconnect Handler
- `CONNECTIONS_TABLE_NAME` - DynamoDB table for tracking connections

### Stream Processor
- `CONNECTIONS_TABLE_NAME` - DynamoDB table for tracking connections
- `WEBSOCKET_API_ENDPOINT` - WebSocket API callback URL (e.g., `https://abc123.execute-api.us-east-1.amazonaws.com/prod`)

## IAM Permissions

The Lambda functions require the following permissions:

1. **DynamoDB Permissions** (all handlers):
   - `dynamodb:PutItem` (connect)
   - `dynamodb:DeleteItem` (disconnect, stream-processor for cleanup)
   - `dynamodb:Scan` (stream-processor)

2. **DynamoDB Streams** (stream-processor only):
   - `dynamodb:DescribeStream`
   - `dynamodb:GetRecords`
   - `dynamodb:GetShardIterator`
   - `dynamodb:ListStreams`

3. **API Gateway Management** (stream-processor only):
   - `execute-api:ManageConnections` - Post messages to WebSocket connections

## Error Handling

- **Stale Connections**: When posting to a connection fails with `GoneException`, the connection is automatically removed from the connections table
- **Stream Processing**: Uses bisect batch on error and 3 retry attempts
- **Batch Window**: Batches stream records for up to 5 seconds to reduce Lambda invocations

## Testing Locally

You can test the handlers locally using AWS SAM or by mocking the event structures:

```typescript
// Mock connect event
const connectEvent = {
  requestContext: {
    connectionId: 'test-connection-123',
    // ... other context fields
  }
};

// Mock stream event
const streamEvent = {
  Records: [
    {
      eventName: 'INSERT',
      dynamodb: {
        NewImage: {
          entity_id: { S: 'stream-001' },
          // ... marshalled DynamoDB record
        }
      }
    }
  ]
};
```

## WebSocket Client Example

```javascript
const ws = new WebSocket('wss://abc123.execute-api.us-east-1.amazonaws.com/prod');

ws.onopen = () => {
  console.log('Connected to WebSocket');
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  console.log('Received update:', message);

  if (message.type === 'METRICS_UPDATE') {
    message.updates.forEach(update => {
      // Handle metric updates in your UI
      console.log(`${update.eventType}:`, update.data);
    });
  }
};

ws.onerror = (error) => {
  console.error('WebSocket error:', error);
};

ws.onclose = () => {
  console.log('Disconnected from WebSocket');
};
```

## Performance Considerations

- **Connection Scanning**: Uses DynamoDB Scan to get all connections. For large-scale deployments (>1000 connections), consider using GSI with pagination
- **Batch Processing**: Stream processor batches up to 100 records and waits up to 5 seconds before processing
- **Memory**: Stream processor uses 512MB memory to handle large batches
- **Timeout**: Stream processor has 5-minute timeout for processing large batches

## Monitoring

Key metrics to monitor:

1. **Lambda Invocations**:
   - Connect/Disconnect handler invocation count
   - Stream processor invocation count

2. **DynamoDB Metrics**:
   - Connections table read/write capacity
   - Stream processor iterator age

3. **API Gateway Metrics**:
   - WebSocket connection count
   - Message count
   - Integration errors

## Future Enhancements

- Add authentication/authorization for WebSocket connections
- Implement selective subscriptions (clients specify which metrics they want)
- Add message compression for large payloads
- Implement connection heartbeat/ping-pong
- Add CloudWatch alarms for stale iterator age
