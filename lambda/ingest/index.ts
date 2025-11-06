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

    if (!VALID_EVENT_TYPES.includes(incomingEvent.event_type)) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: `Invalid event_type. Must be one of: ${VALID_EVENT_TYPES.join(', ')}`,
        }),
      };
    }

    if (!incomingEvent.payload || typeof incomingEvent.payload !== 'object') {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'payload is required and must be an object' }),
      };
    }

    // Add timestamp if not provided
    if (!incomingEvent.timestamp) {
      incomingEvent.timestamp = new Date().toISOString();
    }

    // Add ingestion metadata
    const enrichedEvent = {
      ...incomingEvent,
      ingested_at: new Date().toISOString(),
      source_ip: event.requestContext.identity.sourceIp,
      request_id: event.requestContext.requestId,
    };

    // Send to Kinesis
    const command = new PutRecordCommand({
      StreamName: STREAM_NAME,
      Data: Buffer.from(JSON.stringify(enrichedEvent)),
      PartitionKey: incomingEvent.event_type, // Use event type for partitioning
    });

    const response = await kinesis.send(command);

    console.log('Successfully sent to Kinesis:', {
      eventType: incomingEvent.event_type,
      shardId: response.ShardId,
      sequenceNumber: response.SequenceNumber,
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Event received successfully',
        eventType: incomingEvent.event_type,
        sequenceNumber: response.SequenceNumber,
        shardId: response.ShardId,
      }),
    };
  } catch (error) {
    console.error('Error processing event:', error);

    // Handle JSON parse errors
    if (error instanceof SyntaxError) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid JSON in request body' }),
      };
    }

    // Generic error response
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
