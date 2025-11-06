import { APIGatewayProxyWebsocketHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const CONNECTIONS_TABLE_NAME = process.env.CONNECTIONS_TABLE_NAME!;

/**
 * WebSocket Connect Handler
 * Stores connection ID and metadata in DynamoDB when a client connects
 */
export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  console.log('Connect event:', JSON.stringify(event, null, 2));

  const connectionId = event.requestContext.connectionId;
  const sourceIp = (event as any).headers?.['x-forwarded-for'] || 'unknown';
  const userAgent = (event as any).headers?.['user-agent'] || 'unknown';
  const connectedAt = Date.now();

  // TTL set to 24 hours from now (for cleanup of stale connections)
  const ttl = Math.floor(connectedAt / 1000) + (24 * 60 * 60);

  try {
    // Store connection in DynamoDB
    await docClient.send(new PutCommand({
      TableName: CONNECTIONS_TABLE_NAME,
      Item: {
        connectionId,
        connected: 'true', // For GSI queries
        connectedAt,
        sourceIp,
        userAgent,
        ttl,
      },
    }));

    console.log(`Connection stored: ${connectionId}`);

    // Return 200 OK with empty body
    // WebSocket $connect route handlers should not return a body
    // Messages must be sent via API Gateway Management API after connection is established
    return {
      statusCode: 200,
    };
  } catch (error) {
    console.error('Error storing connection:', error);
    return {
      statusCode: 500,
    };
  }
};
