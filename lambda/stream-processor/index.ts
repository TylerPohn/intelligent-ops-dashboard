import { KinesisStreamEvent, KinesisStreamRecord } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createGzip } from 'zlib';
import { promisify } from 'util';

const gzipAsync = promisify(createGzip().end.bind(createGzip()));

// Environment configuration
const DYNAMODB_TABLE_NAME = process.env.DYNAMODB_TABLE_NAME!;
const MALFORMED_DATA_TOPIC_ARN = process.env.MALFORMED_DATA_TOPIC_ARN!;
const ARCHIVE_BUCKET_NAME = process.env.ARCHIVE_BUCKET_NAME!;
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

// Initialize AWS clients
const dynamoClient = new DynamoDBClient({ region: AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const snsClient = new SNSClient({ region: AWS_REGION });
const s3Client = new S3Client({ region: AWS_REGION });

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
  entity_id?: string;
  entity_type?: string;
  metrics?: Record<string, any>;
  metadata?: Record<string, any>;
}

interface ValidationError {
  field: string;
  message: string;
  severity: 'warning' | 'error' | 'critical';
}

interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  event: IncomingEvent;
}

/**
 * Validate incoming event structure and business rules
 */
function validateEvent(event: IncomingEvent): ValidationResult {
  const errors: ValidationError[] = [];

  // Required field validation
  if (!event.event_type) {
    errors.push({
      field: 'event_type',
      message: 'Missing required field: event_type',
      severity: 'critical',
    });
  } else if (!VALID_EVENT_TYPES.includes(event.event_type)) {
    errors.push({
      field: 'event_type',
      message: `Invalid event_type: ${event.event_type}. Must be one of: ${VALID_EVENT_TYPES.join(', ')}`,
      severity: 'error',
    });
  }

  if (!event.payload || typeof event.payload !== 'object') {
    errors.push({
      field: 'payload',
      message: 'Missing or invalid payload field',
      severity: 'critical',
    });
  }

  // Business rule validation for metrics
  if (event.metrics) {
    if (typeof event.metrics !== 'object') {
      errors.push({
        field: 'metrics',
        message: 'Metrics must be an object',
        severity: 'error',
      });
    } else {
      // Validate numeric metrics
      if (event.metrics.iops !== undefined && (typeof event.metrics.iops !== 'number' || event.metrics.iops < 0)) {
        errors.push({
          field: 'metrics.iops',
          message: 'IOPS must be a non-negative number',
          severity: 'error',
        });
      }

      if (event.metrics.latency !== undefined && (typeof event.metrics.latency !== 'number' || event.metrics.latency < 0)) {
        errors.push({
          field: 'metrics.latency',
          message: 'Latency must be a non-negative number',
          severity: 'error',
        });
      }

      if (event.metrics.errorRate !== undefined && (typeof event.metrics.errorRate !== 'number' || event.metrics.errorRate < 0 || event.metrics.errorRate > 100)) {
        errors.push({
          field: 'metrics.errorRate',
          message: 'Error rate must be between 0 and 100',
          severity: 'error',
        });
      }
    }
  }

  // Timestamp validation
  if (event.timestamp) {
    const timestamp = new Date(event.timestamp);
    if (isNaN(timestamp.getTime())) {
      errors.push({
        field: 'timestamp',
        message: 'Invalid timestamp format',
        severity: 'warning',
      });
    }
  }

  return {
    isValid: errors.filter(e => e.severity === 'critical' || e.severity === 'error').length === 0,
    errors,
    event,
  };
}

/**
 * Transform event to DynamoDB item format
 */
function transformToDynamoDBItem(event: IncomingEvent): Record<string, any> {
  const timestamp = event.timestamp || new Date().toISOString();
  const entity_id = event.entity_id || `${event.event_type}-${Date.now()}`;
  const entity_type = event.entity_type || 'event';

  return {
    entity_id,
    entity_type,
    timestamp,
    event_type: event.event_type,
    payload: event.payload,
    metrics: event.metrics || {},
    metadata: event.metadata || {},
    ttl: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60), // 30 days
  };
}

/**
 * Send malformed data notification to SNS
 */
async function notifyMalformedData(
  validationResult: ValidationResult,
  rawData: string
): Promise<void> {
  const criticalErrors = validationResult.errors.filter(e => e.severity === 'critical');
  const regularErrors = validationResult.errors.filter(e => e.severity === 'error');
  const warnings = validationResult.errors.filter(e => e.severity === 'warning');

  const severity = criticalErrors.length > 0 ? 'critical' : regularErrors.length > 0 ? 'error' : 'warning';

  const message = {
    timestamp: new Date().toISOString(),
    severity,
    event_type: validationResult.event.event_type || 'unknown',
    errors: validationResult.errors,
    summary: `Found ${criticalErrors.length} critical, ${regularErrors.length} errors, ${warnings.length} warnings`,
    raw_event: JSON.parse(rawData),
  };

  try {
    await snsClient.send(new PublishCommand({
      TopicArn: MALFORMED_DATA_TOPIC_ARN,
      Subject: `[${severity.toUpperCase()}] Malformed Event Detected: ${validationResult.event.event_type}`,
      Message: JSON.stringify(message, null, 2),
    }));

    console.log('Malformed data notification sent:', {
      severity,
      event_type: validationResult.event.event_type,
      error_count: validationResult.errors.length,
    });
  } catch (error) {
    console.error('Failed to send malformed data notification:', error);
    // Don't throw - notification failure shouldn't block processing
  }
}

/**
 * Batch write items to DynamoDB with retry logic
 */
async function batchWriteToDynamoDB(items: Record<string, any>[]): Promise<void> {
  // DynamoDB BatchWriteItem supports max 25 items per request
  const BATCH_SIZE = 25;
  const batches: Record<string, any>[][] = [];

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    batches.push(items.slice(i, i + BATCH_SIZE));
  }

  for (const batch of batches) {
    const putRequests = batch.map(item => ({
      PutRequest: {
        Item: item,
      },
    }));

    try {
      const result = await docClient.send(new BatchWriteCommand({
        RequestItems: {
          [DYNAMODB_TABLE_NAME]: putRequests,
        },
      }));

      // Handle unprocessed items
      if (result.UnprocessedItems && result.UnprocessedItems[DYNAMODB_TABLE_NAME]) {
        const unprocessedCount = result.UnprocessedItems[DYNAMODB_TABLE_NAME].length;
        console.warn(`${unprocessedCount} items were not processed, will be retried by Lambda`);

        // Throw error to trigger Lambda retry mechanism
        throw new Error(`Failed to process ${unprocessedCount} items in batch`);
      }

      console.log(`Successfully wrote ${batch.length} items to DynamoDB`);
    } catch (error) {
      console.error('Batch write failed:', error);
      throw error; // Let Lambda retry the entire batch
    }
  }
}

/**
 * Archive raw events to S3 for long-term storage
 * Uses GZIP compression and partitioned by timestamp
 */
async function archiveToS3(rawDataArray: string[]): Promise<void> {
  if (rawDataArray.length === 0) return;

  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const hour = String(now.getUTCHours()).padStart(2, '0');
  const timestamp = now.getTime();

  // Create S3 key with Hive-style partitioning (same as Firehose would use)
  const key = `events/year=${year}/month=${month}/day=${day}/hour=${hour}/batch-${timestamp}.json.gz`;

  // Join all raw events into newline-delimited JSON
  const content = rawDataArray.join('\n');

  // Compress with GZIP
  const compressed = await new Promise<Buffer>((resolve, reject) => {
    const gzip = createGzip();
    const chunks: Buffer[] = [];

    gzip.on('data', (chunk) => chunks.push(chunk));
    gzip.on('end', () => resolve(Buffer.concat(chunks)));
    gzip.on('error', reject);

    gzip.write(content);
    gzip.end();
  });

  // Upload to S3
  await s3Client.send(new PutObjectCommand({
    Bucket: ARCHIVE_BUCKET_NAME,
    Key: key,
    Body: compressed,
    ContentType: 'application/json',
    ContentEncoding: 'gzip',
    Metadata: {
      'record-count': String(rawDataArray.length),
      'batch-timestamp': timestamp.toString(),
    },
  }));

  console.log(`Archived ${rawDataArray.length} events to s3://${ARCHIVE_BUCKET_NAME}/${key}`);
}

/**
 * Lambda handler for processing Kinesis stream records
 */
export async function handler(event: KinesisStreamEvent): Promise<void> {
  console.log(`Processing ${event.Records.length} Kinesis records`);

  const validItems: Record<string, any>[] = [];
  const malformedRecords: { validation: ValidationResult; rawData: string }[] = [];
  const allRawData: string[] = []; // Collect all raw data for S3 archival

  // Process each Kinesis record
  for (const record of event.Records) {
    try {
      // Decode Kinesis data
      const rawData = Buffer.from(record.kinesis.data, 'base64').toString('utf-8');
      allRawData.push(rawData); // Collect for S3 archival
      const incomingEvent: IncomingEvent = JSON.parse(rawData);

      // Validate event
      const validationResult = validateEvent(incomingEvent);

      if (validationResult.isValid) {
        // Transform to DynamoDB format
        const item = transformToDynamoDBItem(incomingEvent);
        validItems.push(item);
      } else {
        // Track malformed data
        malformedRecords.push({ validation: validationResult, rawData });
        console.warn('Validation failed for event:', {
          event_type: incomingEvent.event_type,
          errors: validationResult.errors,
        });
      }
    } catch (error) {
      console.error('Failed to process Kinesis record:', error);
      malformedRecords.push({
        validation: {
          isValid: false,
          errors: [{
            field: 'raw_data',
            message: `Parse error: ${error instanceof Error ? error.message : 'Unknown error'}`,
            severity: 'critical',
          }],
          event: {} as IncomingEvent,
        },
        rawData: Buffer.from(record.kinesis.data, 'base64').toString('utf-8'),
      });
    }
  }

  // Send notifications for malformed data
  if (malformedRecords.length > 0) {
    console.log(`Found ${malformedRecords.length} malformed records out of ${event.Records.length}`);

    // Send notifications (don't await to avoid blocking)
    for (const { validation, rawData } of malformedRecords) {
      notifyMalformedData(validation, rawData).catch(err => {
        console.error('Failed to notify malformed data:', err);
      });
    }
  }

  // Batch write valid items to DynamoDB
  if (validItems.length > 0) {
    try {
      await batchWriteToDynamoDB(validItems);
      console.log(`Successfully processed ${validItems.length} valid events`);
    } catch (error) {
      console.error('Failed to write to DynamoDB:', error);
      throw error; // Trigger Lambda retry for the entire batch
    }
  }

  // Archive all raw events to S3 (async, don't block on this)
  if (allRawData.length > 0) {
    archiveToS3(allRawData).catch(err => {
      console.error('Failed to archive to S3 (non-blocking):', err);
      // Don't throw - S3 archival failure shouldn't fail the entire batch
    });
  }

  // Log summary
  console.log('Processing summary:', {
    total_records: event.Records.length,
    valid_items: validItems.length,
    malformed_records: malformedRecords.length,
    success_rate: `${((validItems.length / event.Records.length) * 100).toFixed(2)}%`,
  });
}
