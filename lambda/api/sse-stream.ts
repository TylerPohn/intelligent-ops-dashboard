import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME!;

/**
 * SSE (Server-Sent Events) endpoint for streaming real-time updates
 * Much simpler than WebSocket - just HTTP with streaming response
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  console.log('SSE Stream request:', JSON.stringify(event, null, 2));

  const headers = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  try {
    // Query recent insights
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'EntityTypeIndex',
        KeyConditionExpression: 'entity_type = :type',
        ExpressionAttributeValues: {
          ':type': 'insight',
        },
        ScanIndexForward: false,
        Limit: 10,
      })
    );

    const insights = (result.Items || []).map((item) => ({
      alert_id: item.entity_id,
      entity_id: item.related_entity || item.entity_id,
      timestamp: item.timestamp || new Date().toISOString(),
      prediction_type: item.prediction_type || 'unknown',
      risk_score: item.risk_score || 0,
      explanation: item.explanation || '',
      recommendations: item.recommendations || [],
      model_used: item.model_used || 'unknown',
      confidence: item.confidence || 0,
    }));

    // SSE format: "data: {json}\n\n"
    const sseData = insights.map(insight =>
      `data: ${JSON.stringify(insight)}\n\n`
    ).join('');

    // Send initial data
    const body = `retry: 5000\n\n${sseData}`;

    return {
      statusCode: 200,
      headers,
      body,
    };
  } catch (error) {
    console.error('Error in SSE stream:', error);

    const errorEvent = `data: ${JSON.stringify({
      error: 'Failed to get insights',
      message: error instanceof Error ? error.message : 'Unknown error',
    })}\n\n`;

    return {
      statusCode: 500,
      headers,
      body: errorEvent,
    };
  }
};
