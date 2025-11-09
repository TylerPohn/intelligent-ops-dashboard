import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME!;

interface Insight {
  alert_id: string;
  entity_id: string;
  timestamp: string;
  prediction_type: string;
  risk_score: number;
  explanation: string;
  recommendations: string[];
  model_used: string;
  confidence: number;
}

interface InsightsResponse {
  items: Insight[];
  nextToken?: string;
  aggregations?: {
    total: number;
    critical: number;
    avgRisk: number;
    byType: Record<string, number>;
  };
}

/**
 * Get recent insights from DynamoDB
 * Supports:
 * - GET /insights/recent?limit=50&since=ISO_DATE&nextToken=BASE64&aggregations=true
 * - GET /insights/aggregations?since=ISO_DATE
 * - GET /insights/{alertId}
 * - GET /insights/stream (SSE streaming)
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  console.log('Get Insights event:', JSON.stringify(event, null, 2));

  const pathSegments = event.path.split('/').filter(Boolean);
  const isStreamRequest = pathSegments[pathSegments.length - 1] === 'stream';

  // SSE headers for streaming
  const sseHeaders = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  // REST JSON headers
  const jsonHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  const headers = isStreamRequest ? sseHeaders : jsonHeaders;

  // Handle OPTIONS preflight request
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: jsonHeaders,
      body: '',
    };
  }

  try {
    // Handle SSE streaming endpoint
    if (isStreamRequest) {
      console.log('Handling SSE stream request');

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
      const sseData = insights
        .map((insight) => `data: ${JSON.stringify(insight)}\n\n`)
        .join('');

      // Send initial data with retry directive
      const body = `retry: 5000\n\n${sseData}`;

      return {
        statusCode: 200,
        headers: sseHeaders,
        body,
      };
    }

    // Handle REST JSON endpoints
    const isRecentRequest = pathSegments[pathSegments.length - 1] === 'recent';
    const isAggregationsRequest = pathSegments[pathSegments.length - 1] === 'aggregations';

    if (isAggregationsRequest) {
      // GET /insights/aggregations?since=ISO_DATE
      const since = event.queryStringParameters?.since;

      // Build query parameters
      const queryParams: any = {
        TableName: TABLE_NAME,
        IndexName: 'EntityTypeIndex',
        ScanIndexForward: false,
      };

      // Add time filter if provided (use KeyConditionExpression since timestamp is the sort key)
      if (since) {
        queryParams.KeyConditionExpression = 'entity_type = :type AND #ts >= :since';
        queryParams.ExpressionAttributeNames = { '#ts': 'timestamp' };
        queryParams.ExpressionAttributeValues = {
          ':type': 'insight',
          ':since': since,
        };
      } else {
        queryParams.KeyConditionExpression = 'entity_type = :type';
        queryParams.ExpressionAttributeValues = {
          ':type': 'insight',
        };
      }

      // Query all matching insights for aggregation
      const result = await docClient.send(new QueryCommand(queryParams));
      const items = result.Items || [];

      // Calculate aggregations
      const total = items.length;
      const critical = items.filter((item) => (item.risk_score || 0) >= 80).length;
      const avgRisk = total > 0
        ? Math.round(items.reduce((sum, item) => sum + (item.risk_score || 0), 0) / total)
        : 0;

      // Count by prediction type
      const byType: Record<string, number> = {};
      items.forEach((item) => {
        const type = item.prediction_type || 'unknown';
        byType[type] = (byType[type] || 0) + 1;
      });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          total,
          critical,
          avgRisk,
          byType,
        }),
      };
    }

    if (isRecentRequest) {
      // GET /insights/recent?limit=50&since=ISO_DATE&nextToken=BASE64&aggregations=true
      const limit = event.queryStringParameters?.limit
        ? parseInt(event.queryStringParameters.limit, 10)
        : 50;
      const since = event.queryStringParameters?.since;
      const nextToken = event.queryStringParameters?.nextToken;
      const includeAggregations = event.queryStringParameters?.aggregations === 'true';

      // Build query parameters
      const queryParams: any = {
        TableName: TABLE_NAME,
        IndexName: 'EntityTypeIndex',
        ScanIndexForward: false, // Sort descending (newest first)
        Limit: limit,
      };

      // Add time filter if provided (use KeyConditionExpression since timestamp is the sort key)
      if (since) {
        queryParams.KeyConditionExpression = 'entity_type = :type AND #ts >= :since';
        queryParams.ExpressionAttributeNames = { '#ts': 'timestamp' };
        queryParams.ExpressionAttributeValues = {
          ':type': 'insight',
          ':since': since,
        };
      } else {
        queryParams.KeyConditionExpression = 'entity_type = :type';
        queryParams.ExpressionAttributeValues = {
          ':type': 'insight',
        };
      }

      // Add pagination if provided
      if (nextToken) {
        try {
          queryParams.ExclusiveStartKey = JSON.parse(
            Buffer.from(nextToken, 'base64').toString()
          );
        } catch (e) {
          console.error('Invalid nextToken:', e);
        }
      }

      // Query insights
      const result = await docClient.send(new QueryCommand(queryParams));

      const insights: Insight[] = (result.Items || []).map((item) => ({
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

      // Build response
      const response: InsightsResponse = {
        items: insights,
      };

      // Add pagination token if there are more results
      if (result.LastEvaluatedKey) {
        response.nextToken = Buffer.from(
          JSON.stringify(result.LastEvaluatedKey)
        ).toString('base64');
      }

      // Add aggregations if requested
      if (includeAggregations && insights.length > 0) {
        const total = insights.length;
        const critical = insights.filter((i) => i.risk_score >= 80).length;
        const avgRisk = Math.round(
          insights.reduce((sum, i) => sum + i.risk_score, 0) / total
        );

        const byType: Record<string, number> = {};
        insights.forEach((i) => {
          byType[i.prediction_type] = (byType[i.prediction_type] || 0) + 1;
        });

        response.aggregations = {
          total,
          critical,
          avgRisk,
          byType,
        };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(response),
      };
    } else {
      // GET /insights/{alertId}
      const alertId = pathSegments[pathSegments.length - 1];

      const result = await docClient.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: {
            entity_id: alertId,
            entity_type: 'insight',
          },
        })
      );

      if (!result.Item) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Insight not found' }),
        };
      }

      const insight: Insight = {
        alert_id: result.Item.entity_id,
        entity_id: result.Item.related_entity || result.Item.entity_id,
        timestamp: result.Item.timestamp || new Date().toISOString(),
        prediction_type: result.Item.prediction_type || 'unknown',
        risk_score: result.Item.risk_score || 0,
        explanation: result.Item.explanation || '',
        recommendations: result.Item.recommendations || [],
        model_used: result.Item.model_used || 'unknown',
        confidence: result.Item.confidence || 0,
      };

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(insight),
      };
    }
  } catch (error) {
    console.error('Error getting insights:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to get insights',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};
