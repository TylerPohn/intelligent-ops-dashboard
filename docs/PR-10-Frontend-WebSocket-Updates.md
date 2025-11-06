# PR-10: Frontend WebSocket Updates

## Overview
Add API Gateway WebSocket support and DynamoDB Streams integration for real-time dashboard updates.

## Dependencies
- PR-08: DynamoDB Schema (tables with streams enabled)
- PR-09: Frontend UI

## Objectives
- Create API Gateway WebSocket API
- Build Lambda to push DynamoDB Stream events to WebSocket clients
- Add WebSocket client to React frontend
- Implement real-time metric updates

## Step-by-Step Instructions

### 1. Create WebSocket API in CDK
**File:** `cdk/lib/experience-stack.ts` (new)

```typescript
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';

export interface ExperienceStackProps extends cdk.StackProps {
  metricsTable: dynamodb.Table;
  lambdaExecutionRole: iam.Role;
}

export class ExperienceStack extends cdk.Stack {
  public readonly webSocketApi: apigatewayv2.WebSocketApi;

  constructor(scope: Construct, id: string, props: ExperienceStackProps) {
    super(scope, id, props);

    // WebSocket handler Lambdas
    const connectHandler = new lambda.Function(this, 'WSConnect', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'connect.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/websocket/dist')),
      role: props.lambdaExecutionRole,
    });

    const disconnectHandler = new lambda.Function(this, 'WSDisconnect', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'disconnect.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/websocket/dist')),
      role: props.lambdaExecutionRole,
    });

    // Create WebSocket API
    this.webSocketApi = new apigatewayv2.WebSocketApi(this, 'WebSocketAPI', {
      apiName: 'iops-dashboard-websocket',
      connectRouteOptions: {
        integration: new integrations.WebSocketLambdaIntegration('ConnectIntegration', connectHandler),
      },
      disconnectRouteOptions: {
        integration: new integrations.WebSocketLambdaIntegration('DisconnectIntegration', disconnectHandler),
      },
    });

    const stage = new apigatewayv2.WebSocketStage(this, 'ProductionStage', {
      webSocketApi: this.webSocketApi,
      stageName: 'prod',
      autoDeploy: true,
    });

    // Stream processor Lambda
    const streamProcessor = new lambda.Function(this, 'StreamProcessor', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'stream-processor.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/websocket/dist')),
      role: props.lambdaExecutionRole,
      environment: {
        WEBSOCKET_API_ENDPOINT: stage.url,
      },
    });

    // Grant permissions to post to WebSocket connections
    streamProcessor.addToRolePolicy(new iam.PolicyStatement({
      actions: ['execute-api:ManageConnections'],
      resources: [`arn:aws:execute-api:${this.region}:${this.account}:${this.webSocketApi.apiId}/*`],
    }));

    // Add DynamoDB stream as event source
    props.metricsTable.grantStreamRead(streamProcessor);

    new cdk.CfnOutput(this, 'WebSocketURL', {
      value: stage.url,
      description: 'WebSocket API URL',
      exportName: 'IOpsDashboard-WebSocketURL',
    });
  }
}
```

### 2. Create WebSocket Lambda Handlers
**File:** `lambda/websocket/connect.ts`

```typescript
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const connectionId = event.requestContext.connectionId!;

  await dynamoClient.send(new PutCommand({
    TableName: 'iops-dashboard-connections',
    Item: {
      connectionId,
      connectedAt: new Date().toISOString(),
    },
  }));

  return { statusCode: 200, body: 'Connected' };
};
```

**File:** `lambda/websocket/disconnect.ts`

```typescript
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand } from '@aws-sdk/lib-dynamodb';

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const connectionId = event.requestContext.connectionId!;

  await dynamoClient.send(new DeleteCommand({
    TableName: 'iops-dashboard-connections',
    Key: { connectionId },
  }));

  return { statusCode: 200, body: 'Disconnected' };
};
```

**File:** `lambda/websocket/stream-processor.ts`

```typescript
import { DynamoDBStreamEvent } from 'aws-lambda';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';

const apiGatewayClient = new ApiGatewayManagementApiClient({
  endpoint: process.env.WEBSOCKET_API_ENDPOINT,
});

const dynamoClient = new DynamoDBClient({});

async function getConnections(): Promise<string[]> {
  const result = await dynamoClient.send(new ScanCommand({
    TableName: 'iops-dashboard-connections',
  }));

  return result.Items?.map(item => item.connectionId.S!) || [];
}

export const handler = async (event: DynamoDBStreamEvent): Promise<void> => {
  const connections = await getConnections();

  for (const record of event.Records) {
    if (record.eventName === 'MODIFY' || record.eventName === 'INSERT') {
      const newImage = record.dynamodb?.NewImage;

      const message = JSON.stringify({
        type: 'METRIC_UPDATE',
        data: newImage,
        timestamp: new Date().toISOString(),
      });

      // Send to all connected clients
      await Promise.all(
        connections.map(async (connectionId) => {
          try {
            await apiGatewayClient.send(new PostToConnectionCommand({
              ConnectionId: connectionId,
              Data: Buffer.from(message),
            }));
          } catch (error) {
            console.error(`Failed to send to ${connectionId}:`, error);
          }
        })
      );
    }
  }
};
```

### 3. Add WebSocket Hook to React
**File:** `frontend/src/hooks/useWebSocket.ts`

```typescript
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export function useWebSocket(url: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('WebSocket connected');
      setIsConnected(true);
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);

      if (message.type === 'METRIC_UPDATE') {
        // Invalidate queries to refetch data
        queryClient.invalidateQueries({ queryKey: ['metrics'] });
        queryClient.invalidateQueries({ queryKey: ['insights'] });
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
      setIsConnected(false);
    };

    return () => {
      ws.close();
    };
  }, [url, queryClient]);

  return { isConnected };
}
```

### 4. Use WebSocket in Dashboard with MUI
**File:** `frontend/src/components/Dashboard.tsx` (update)

```typescript
import { Box, Chip } from '@mui/material';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import { useWebSocket } from '../hooks/useWebSocket';

export default function Dashboard() {
  const wsUrl = import.meta.env.VITE_WEBSOCKET_URL;
  const { isConnected } = useWebSocket(wsUrl);

  // ... rest of component

  return (
    <Box>
      <Box display="flex" justifyContent="flex-end" mb={2}>
        <Chip
          icon={<FiberManualRecordIcon />}
          label={isConnected ? 'Live' : 'Disconnected'}
          color={isConnected ? 'success' : 'error'}
          size="small"
          variant="outlined"
        />
      </Box>
      {/* ... rest of JSX */}
    </Box>
  );
}
```

## Deployment & Testing

```bash
cdk deploy IOpsDashboard-ExperienceStack
```

Get WebSocket URL and add to frontend `.env`:
```bash
VITE_WEBSOCKET_URL=wss://xxx.execute-api.us-east-1.amazonaws.com/prod
```

## Estimated Time: 60 minutes
