import { APIGatewayProxyWebsocketHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand } from '@aws-sdk/lib-dynamodb';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const CONNECTIONS_TABLE_NAME = process.env.CONNECTIONS_TABLE_NAME!;

/**
 * WebSocket Disconnect Handler
 * Removes connection ID from DynamoDB when a client disconnects
 */
export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  console.log('Disconnect event:', JSON.stringify(event, null, 2));

  const connectionId = event.requestContext.connectionId;

  try {
    // Remove connection from DynamoDB
    await docClient.send(new DeleteCommand({
      TableName: CONNECTIONS_TABLE_NAME,
      Key: {
        connectionId,
      },
    }));

    console.log(`Connection removed: ${connectionId}`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Disconnected successfully',
      }),
    };
  } catch (error) {
    console.error('Error removing connection:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Failed to disconnect',
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};
