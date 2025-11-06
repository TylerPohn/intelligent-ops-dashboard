import { DynamoDBStreamHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
  GoneException,
} from '@aws-sdk/client-apigatewaymanagementapi';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { AttributeValue } from '@aws-sdk/client-dynamodb';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const CONNECTIONS_TABLE_NAME = process.env.CONNECTIONS_TABLE_NAME!;
const WEBSOCKET_API_ENDPOINT = process.env.WEBSOCKET_API_ENDPOINT!;

// Initialize API Gateway Management API client
const apiGwClient = new ApiGatewayManagementApiClient({
  endpoint: WEBSOCKET_API_ENDPOINT,
});

interface Connection {
  connectionId: string;
  connectedAt: number;
}

/**
 * Stream Processor Handler
 * Processes DynamoDB Stream events and broadcasts updates to all connected WebSocket clients
 */
export const handler: DynamoDBStreamHandler = async (event) => {
  console.log('Stream event received:', JSON.stringify(event, null, 2));

  // Get all active connections from DynamoDB
  const connections = await getAllConnections();
  console.log(`Found ${connections.length} active connections`);

  if (connections.length === 0) {
    console.log('No active connections to broadcast to');
    return;
  }

  // Process each stream record
  const updates: any[] = [];

  for (const record of event.Records) {
    if (record.eventName === 'INSERT' || record.eventName === 'MODIFY') {
      // Extract the new image (updated data)
      const newImage = record.dynamodb?.NewImage;

      if (newImage) {
        // Unmarshall DynamoDB record to JavaScript object
        const data = unmarshall(newImage as Record<string, AttributeValue>);

        updates.push({
          eventType: record.eventName,
          timestamp: Date.now(),
          data,
        });
      }
    } else if (record.eventName === 'REMOVE') {
      // Handle deletions if needed
      const oldImage = record.dynamodb?.OldImage;

      if (oldImage) {
        const data = unmarshall(oldImage as Record<string, AttributeValue>);

        updates.push({
          eventType: 'REMOVE',
          timestamp: Date.now(),
          data,
        });
      }
    }
  }

  if (updates.length === 0) {
    console.log('No updates to broadcast');
    return;
  }

  console.log(`Broadcasting ${updates.length} updates to ${connections.length} connections`);

  // Broadcast updates to all connections
  const broadcastPromises = connections.map(async (connection) => {
    try {
      await apiGwClient.send(new PostToConnectionCommand({
        ConnectionId: connection.connectionId,
        Data: Buffer.from(JSON.stringify({
          type: 'METRICS_UPDATE',
          updates,
        })),
      }));

      console.log(`Successfully sent update to connection: ${connection.connectionId}`);
    } catch (error) {
      if (error instanceof GoneException) {
        // Connection is stale, remove from database
        console.log(`Connection ${connection.connectionId} is stale, removing from database`);
        await removeStaleConnection(connection.connectionId);
      } else {
        console.error(`Error sending to connection ${connection.connectionId}:`, error);
      }
    }
  });

  // Wait for all broadcasts to complete
  await Promise.allSettled(broadcastPromises);

  console.log('Broadcast complete');
};

/**
 * Get all active connections from DynamoDB
 */
async function getAllConnections(): Promise<Connection[]> {
  try {
    const result = await docClient.send(new ScanCommand({
      TableName: CONNECTIONS_TABLE_NAME,
      ProjectionExpression: 'connectionId, connectedAt',
    }));

    return (result.Items || []) as Connection[];
  } catch (error) {
    console.error('Error scanning connections table:', error);
    return [];
  }
}

/**
 * Remove a stale connection from DynamoDB
 */
async function removeStaleConnection(connectionId: string): Promise<void> {
  try {
    await docClient.send(new DeleteCommand({
      TableName: CONNECTIONS_TABLE_NAME,
      Key: { connectionId },
    }));

    console.log(`Removed stale connection: ${connectionId}`);
  } catch (error) {
    console.error(`Error removing stale connection ${connectionId}:`, error);
  }
}
