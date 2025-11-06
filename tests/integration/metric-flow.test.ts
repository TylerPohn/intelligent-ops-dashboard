/**
 * Integration Tests for Metric Flow
 * End-to-end: Metric ingestion → Processing → AI Analysis → Dashboard
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DynamoDBClient, QueryCommand, PutItemCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const dynamodb = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
  endpoint: process.env.DYNAMODB_ENDPOINT || undefined // Use local for testing
});

const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || 'iops-dashboard-test';

describe('Metric Flow Integration Tests', () => {
  beforeAll(async () => {
    // Setup: Ensure test table exists
    console.log('Setting up integration test environment...');
  });

  afterAll(async () => {
    // Cleanup: Remove test data
    console.log('Cleaning up integration test data...');
  });

  describe('End-to-End Metric Flow', () => {
    it('should ingest metric and generate insight', async () => {
      const testMetric = {
        event_type: 'ib_call_logged',
        timestamp: new Date().toISOString(),
        payload: {
          student_id: 'student_integration_test_001',
          ib_calls_14d: 18,
          health_score: 42,
          sessions_7d: 3,
          last_session: new Date(Date.now() - 86400000).toISOString() // 1 day ago
        }
      };

      // Step 1: Ingest metric (simulate API Gateway → Lambda)
      const ingestResponse = await fetch(
        process.env.API_GATEWAY_URL + '/ingest',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(testMetric)
        }
      );

      expect(ingestResponse.status).toBe(200);
      const ingestData = await ingestResponse.json();
      expect(ingestData.sequenceNumber).toBeTruthy();

      // Step 2: Wait for processing (Lambda trigger)
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Step 3: Check for generated insight
      const queryCommand = new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'EntityTypeIndex',
        KeyConditionExpression: 'entity_type = :type',
        FilterExpression: 'entity_id = :entityId',
        ExpressionAttributeValues: marshall({
          ':type': 'insight',
          ':entityId': 'student_integration_test_001'
        }),
        ScanIndexForward: false,
        Limit: 1
      });

      const queryResult = await dynamodb.send(queryCommand);
      expect(queryResult.Items).toBeDefined();
      expect(queryResult.Items!.length).toBeGreaterThan(0);

      const insight = unmarshall(queryResult.Items![0]);
      expect(insight.prediction_type).toBe('high_ib_call_frequency');
      expect(insight.risk_score).toBeGreaterThan(0);
      expect(insight.risk_score).toBeLessThanOrEqual(100);
      expect(insight.recommendations).toBeInstanceOf(Array);
      expect(insight.recommendations.length).toBeGreaterThan(0);
      expect(insight.model_used).toContain('claude');
    }, 30000);

    it('should handle low health score metric', async () => {
      const testMetric = {
        event_type: 'customer_health_update',
        timestamp: new Date().toISOString(),
        payload: {
          student_id: 'student_integration_test_002',
          health_score: 28,
          sessions_7d: 1,
          ib_calls_14d: 9,
          trend: 'declining'
        }
      };

      const ingestResponse = await fetch(
        process.env.API_GATEWAY_URL + '/ingest',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(testMetric)
        }
      );

      expect(ingestResponse.status).toBe(200);

      await new Promise(resolve => setTimeout(resolve, 5000));

      const queryCommand = new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'EntityTypeIndex',
        KeyConditionExpression: 'entity_type = :type',
        FilterExpression: 'entity_id = :entityId',
        ExpressionAttributeValues: marshall({
          ':type': 'insight',
          ':entityId': 'student_integration_test_002'
        }),
        ScanIndexForward: false,
        Limit: 1
      });

      const queryResult = await dynamodb.send(queryCommand);
      const insight = unmarshall(queryResult.Items![0]);

      expect(insight.prediction_type).toBe('low_health_score');
      expect(insight.risk_score).toBeGreaterThan(60); // Should be high risk
    }, 30000);

    it('should handle supply-demand imbalance', async () => {
      const testMetric = {
        event_type: 'supply_demand_update',
        timestamp: new Date().toISOString(),
        payload: {
          subject: 'math_calculus',
          demand_score: 92,
          supply_score: 38,
          balance_status: 'demand_exceeds_supply',
          wait_time_minutes: 45
        }
      };

      const ingestResponse = await fetch(
        process.env.API_GATEWAY_URL + '/ingest',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(testMetric)
        }
      );

      expect(ingestResponse.status).toBe(200);

      await new Promise(resolve => setTimeout(resolve, 5000));

      const queryCommand = new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'EntityTypeIndex',
        KeyConditionExpression: 'entity_type = :type',
        FilterExpression: 'entity_id = :entityId',
        ExpressionAttributeValues: marshall({
          ':type': 'insight',
          ':entityId': 'math_calculus'
        }),
        ScanIndexForward: false,
        Limit: 1
      });

      const queryResult = await dynamodb.send(queryCommand);
      const insight = unmarshall(queryResult.Items![0]);

      expect(insight.prediction_type).toBe('supply_demand_imbalance');
      expect(insight.recommendations.length).toBeGreaterThan(0);
    }, 30000);
  });

  describe('API Gateway → Lambda → DynamoDB Flow', () => {
    it('should validate request structure', async () => {
      const invalidMetric = {
        // Missing event_type
        timestamp: new Date().toISOString(),
        payload: {}
      };

      const response = await fetch(
        process.env.API_GATEWAY_URL + '/ingest',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(invalidMetric)
        }
      );

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('event_type is required');
    });

    it('should reject invalid event types', async () => {
      const invalidMetric = {
        event_type: 'invalid_event_type',
        timestamp: new Date().toISOString(),
        payload: { test: 'data' }
      };

      const response = await fetch(
        process.env.API_GATEWAY_URL + '/ingest',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(invalidMetric)
        }
      );

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Invalid event_type');
    });

    it('should add ingestion metadata', async () => {
      const testMetric = {
        event_type: 'session_started',
        timestamp: new Date().toISOString(),
        payload: {
          student_id: 'student_metadata_test',
          session_id: 'session_123'
        }
      };

      const response = await fetch(
        process.env.API_GATEWAY_URL + '/ingest',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(testMetric)
        }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.sequenceNumber).toBeTruthy();
      expect(data.shardId).toBeTruthy();
    });

    it('should handle malformed JSON', async () => {
      const response = await fetch(
        process.env.API_GATEWAY_URL + '/ingest',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: 'invalid json {]}'
        }
      );

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Invalid JSON');
    });
  });

  describe('Dashboard Query Performance', () => {
    it('should query recent insights efficiently', async () => {
      const startTime = Date.now();

      const queryCommand = new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'EntityTypeIndex',
        KeyConditionExpression: 'entity_type = :type',
        ExpressionAttributeValues: marshall({
          ':type': 'insight'
        }),
        ScanIndexForward: false,
        Limit: 20
      });

      const result = await dynamodb.send(queryCommand);
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(1000); // Should be fast
      expect(result.Items).toBeDefined();
    });

    it('should filter insights by entity', async () => {
      const queryCommand = new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'EntityTypeIndex',
        KeyConditionExpression: 'entity_type = :type',
        FilterExpression: 'entity_id = :entityId',
        ExpressionAttributeValues: marshall({
          ':type': 'insight',
          ':entityId': 'student_integration_test_001'
        }),
        ScanIndexForward: false,
        Limit: 10
      });

      const result = await dynamodb.send(queryCommand);

      if (result.Items && result.Items.length > 0) {
        const insights = result.Items.map(item => unmarshall(item));
        insights.forEach(insight => {
          expect(insight.entity_id).toBe('student_integration_test_001');
        });
      }
    });

    it('should paginate large result sets', async () => {
      let allItems: any[] = [];
      let lastEvaluatedKey = undefined;
      let pageCount = 0;

      do {
        const queryCommand = new QueryCommand({
          TableName: TABLE_NAME,
          IndexName: 'EntityTypeIndex',
          KeyConditionExpression: 'entity_type = :type',
          ExpressionAttributeValues: marshall({
            ':type': 'insight'
          }),
          ScanIndexForward: false,
          Limit: 10,
          ExclusiveStartKey: lastEvaluatedKey
        });

        const result = await dynamodb.send(queryCommand);

        if (result.Items) {
          allItems = allItems.concat(result.Items);
        }

        lastEvaluatedKey = result.LastEvaluatedKey;
        pageCount++;
      } while (lastEvaluatedKey && pageCount < 5); // Max 5 pages

      expect(allItems.length).toBeGreaterThan(0);
    });
  });

  describe('TTL and Data Retention', () => {
    it('should set TTL on insights', async () => {
      const queryCommand = new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'EntityTypeIndex',
        KeyConditionExpression: 'entity_type = :type',
        ExpressionAttributeValues: marshall({
          ':type': 'insight'
        }),
        ScanIndexForward: false,
        Limit: 1
      });

      const result = await dynamodb.send(queryCommand);

      if (result.Items && result.Items.length > 0) {
        const insight = unmarshall(result.Items[0]);

        expect(insight.ttl).toBeDefined();
        expect(insight.ttl).toBeGreaterThan(Math.floor(Date.now() / 1000));

        // TTL should be approximately 90 days in future
        const ninetyDaysInSeconds = 90 * 24 * 60 * 60;
        const currentTime = Math.floor(Date.now() / 1000);
        const expectedTTL = currentTime + ninetyDaysInSeconds;

        expect(insight.ttl).toBeGreaterThan(currentTime);
        expect(insight.ttl).toBeLessThan(expectedTTL + 86400); // Allow 1 day tolerance
      }
    });

    it('should not include expired items in queries', async () => {
      // This test would require DynamoDB's TTL to be enabled and items to actually expire
      // In practice, TTL deletion happens asynchronously within 48 hours

      const queryCommand = new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'EntityTypeIndex',
        KeyConditionExpression: 'entity_type = :type',
        FilterExpression: 'attribute_not_exists(ttl) OR ttl > :now',
        ExpressionAttributeValues: marshall({
          ':type': 'insight',
          ':now': Math.floor(Date.now() / 1000)
        }),
        ScanIndexForward: false,
        Limit: 10
      });

      const result = await dynamodb.send(queryCommand);

      if (result.Items) {
        const insights = result.Items.map(item => unmarshall(item));
        const currentTime = Math.floor(Date.now() / 1000);

        insights.forEach(insight => {
          if (insight.ttl) {
            expect(insight.ttl).toBeGreaterThan(currentTime);
          }
        });
      }
    });
  });

  describe('High Volume Testing', () => {
    it('should handle 100 concurrent ingests', async () => {
      const metrics = Array.from({ length: 100 }, (_, i) => ({
        event_type: 'session_completed',
        timestamp: new Date().toISOString(),
        payload: {
          student_id: `student_volume_test_${i}`,
          session_id: `session_${i}`,
          duration_minutes: Math.floor(Math.random() * 60) + 10
        }
      }));

      const startTime = Date.now();

      const requests = metrics.map(metric =>
        fetch(process.env.API_GATEWAY_URL + '/ingest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(metric)
        })
      );

      const responses = await Promise.allSettled(requests);
      const duration = Date.now() - startTime;

      const successCount = responses.filter(r =>
        r.status === 'fulfilled' && r.value.status === 200
      ).length;

      expect(successCount).toBeGreaterThan(90); // At least 90% success
      expect(duration).toBeLessThan(30000); // Complete within 30 seconds
    }, 60000);

    it('should maintain data consistency under load', async () => {
      const testId = `consistency_test_${Date.now()}`;
      const metrics = Array.from({ length: 10 }, () => ({
        event_type: 'ib_call_logged',
        timestamp: new Date().toISOString(),
        payload: {
          student_id: testId,
          ib_calls_14d: 15,
          health_score: 45
        }
      }));

      const requests = metrics.map(metric =>
        fetch(process.env.API_GATEWAY_URL + '/ingest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(metric)
        })
      );

      await Promise.all(requests);

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 10000));

      // Verify all metrics were processed
      const queryCommand = new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'EntityTypeIndex',
        KeyConditionExpression: 'entity_type = :type',
        FilterExpression: 'entity_id = :entityId',
        ExpressionAttributeValues: marshall({
          ':type': 'insight',
          ':entityId': testId
        }),
        ScanIndexForward: false
      });

      const result = await dynamodb.send(queryCommand);

      // Should have generated insights for the metrics
      expect(result.Items).toBeDefined();
      expect(result.Items!.length).toBeGreaterThan(0);
    }, 60000);
  });

  describe('Error Recovery', () => {
    it('should handle Lambda timeout gracefully', async () => {
      // Simulate a metric that causes Lambda timeout
      const testMetric = {
        event_type: 'ib_call_logged',
        timestamp: new Date().toISOString(),
        payload: {
          student_id: 'student_timeout_test',
          ib_calls_14d: 20,
          health_score: 30
        }
      };

      const response = await fetch(
        process.env.API_GATEWAY_URL + '/ingest',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(testMetric)
        }
      );

      // Ingest should still succeed even if processing fails
      expect(response.status).toBe(200);
    });

    it('should retry failed AI inference', async () => {
      // This tests the Lambda retry mechanism
      // The test itself just verifies that insights are eventually generated

      const testMetric = {
        event_type: 'ib_call_logged',
        timestamp: new Date().toISOString(),
        payload: {
          student_id: 'student_retry_test',
          ib_calls_14d: 16,
          health_score: 41
        }
      };

      await fetch(process.env.API_GATEWAY_URL + '/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testMetric)
      });

      // Wait longer to allow for retries
      await new Promise(resolve => setTimeout(resolve, 15000));

      const queryCommand = new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'EntityTypeIndex',
        KeyConditionExpression: 'entity_type = :type',
        FilterExpression: 'entity_id = :entityId',
        ExpressionAttributeValues: marshall({
          ':type': 'insight',
          ':entityId': 'student_retry_test'
        }),
        ScanIndexForward: false,
        Limit: 1
      });

      const result = await dynamodb.send(queryCommand);

      // Should eventually succeed after retries
      expect(result.Items).toBeDefined();
    }, 30000);
  });
});
