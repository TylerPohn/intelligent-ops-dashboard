import { APIGatewayProxyWebsocketHandlerV2 } from 'aws-lambda';

/**
 * WebSocket Default Message Handler
 * Handles any WebSocket messages that don't match specific routes
 */
export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  console.log('Default handler received:', JSON.stringify(event, null, 2));

  const connectionId = event.requestContext.connectionId;
  const messageType = (event.body && JSON.parse(event.body || '{}').type) || 'unknown';

  try {
    console.log(`Message from ${connectionId}: ${messageType}`);

    // For WebSocket routes, we should not return a body in the response
    // Messages to clients must be sent via API Gateway Management API

    // Handle ping messages
    if (messageType === 'ping') {
      console.log(`Ping received from ${connectionId}`);
      // TODO: Send pong response via API Gateway Management API if needed
    }

    return {
      statusCode: 200,
    };
  } catch (error) {
    console.error('Error processing message:', error);
    return {
      statusCode: 500,
    };
  }
};
