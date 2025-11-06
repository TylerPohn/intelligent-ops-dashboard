/**
 * Test Setup Configuration
 * Global test setup for AWS SDK mocks, fixtures, and test utilities
 */

import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { KinesisClient, PutRecordCommand } from '@aws-sdk/client-kinesis';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { SageMakerRuntimeClient, InvokeEndpointCommand } from '@aws-sdk/client-sagemaker-runtime';

// Create mock clients
export const dynamoDBMock = mockClient(DynamoDBDocumentClient);
export const bedrockMock = mockClient(BedrockRuntimeClient);
export const eventBridgeMock = mockClient(EventBridgeClient);
export const kinesisMock = mockClient(KinesisClient);
export const snsMock = mockClient(SNSClient);
export const sageMakerMock = mockClient(SageMakerRuntimeClient);

// Setup environment variables for testing
process.env.AWS_REGION = 'us-east-1';
process.env.DYNAMODB_TABLE_NAME = 'test-iops-table';
process.env.KINESIS_STREAM_NAME = 'test-stream';
process.env.EVENT_BUS_NAME = 'test-event-bus';
process.env.SNS_TOPIC_ARN = 'arn:aws:sns:us-east-1:123456789012:test-topic';
process.env.USE_BEDROCK = 'true';
process.env.USE_SAGEMAKER = 'false';
process.env.SAGEMAKER_ENDPOINT = 'test-endpoint';

// Reset all mocks before each test
beforeEach(() => {
  dynamoDBMock.reset();
  bedrockMock.reset();
  eventBridgeMock.reset();
  kinesisMock.reset();
  snsMock.reset();
  sageMakerMock.reset();
});

// Test utilities
export const generateTestTimestamp = (): string => {
  return new Date().toISOString();
};

export const wait = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

// Default mock responses
export const mockBedrockResponse = (riskScore: number, recommendations: string[]) => {
  return {
    body: Buffer.from(JSON.stringify({
      content: [{
        text: JSON.stringify({
          risk_score: riskScore,
          explanation: 'Test explanation',
          recommendations: recommendations
        })
      }]
    }))
  };
};

export const mockDynamoDBItem = (entityId: string, entityType: string) => {
  return {
    Item: {
      entity_id: entityId,
      entity_type: entityType,
      sessions_7d: 5,
      sessions_14d: 10,
      sessions_30d: 20,
      ib_calls_7d: 1,
      ib_calls_14d: 2,
      avg_rating: 4.5,
      health_score: 85,
      last_updated: generateTestTimestamp()
    }
  };
};
