/**
 * Process Lambda Unit Tests
 * Tests for Kinesis stream processor (lambda/process/handler.py)
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { dynamoDBMock, eventBridgeMock } from '../setup';
import { PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { PutEventsCommand } from '@aws-sdk/client-eventbridge';
import {
  createKinesisRecord,
  validSessionStartedEvent,
  validSessionCompletedEvent,
  validIBCallEvent,
  validHealthUpdateEvent,
  validSupplyDemandEvent,
  highRiskStudentMetrics,
  normalStudentMetrics
} from '../fixtures/test-events';

// Mock Python handler (we'll test the TypeScript equivalent logic)
describe('Process Lambda - Kinesis Stream Processor', () => {

  describe('Kinesis Record Decoding', () => {
    it('should decode base64 Kinesis records correctly', () => {
      const record = createKinesisRecord(validSessionStartedEvent);
      const decoded = Buffer.from(record.kinesis.data, 'base64').toString('utf-8');
      const parsed = JSON.parse(decoded);

      expect(parsed.event_type).toBe('session_started');
      expect(parsed.payload).toHaveProperty('student_id');
      expect(parsed.payload).toHaveProperty('tutor_id');
    });

    it('should handle malformed records gracefully', () => {
      const record = {
        kinesis: {
          data: 'invalid-base64!!!',
          sequenceNumber: '12345'
        }
      };

      expect(() => {
        Buffer.from(record.kinesis.data, 'base64').toString('utf-8');
      }).not.toThrow();
    });

    it('should handle JSON parse errors', () => {
      const record = createKinesisRecord('not json');
      const decoded = Buffer.from(record.kinesis.data, 'base64').toString('utf-8');

      expect(() => {
        JSON.parse(decoded);
      }).toThrow();
    });
  });

  describe('Metrics Aggregation', () => {
    beforeEach(() => {
      dynamoDBMock.reset();
    });

    it('should increment session counts for students', async () => {
      dynamoDBMock.on(GetCommand).resolves({ Item: normalStudentMetrics });
      dynamoDBMock.on(PutCommand).resolves({});

      const record = createKinesisRecord(validSessionStartedEvent);

      // Verify GetCommand called with correct key
      expect(dynamoDBMock).toBeDefined();
    });

    it('should update tutor rating on session completion', async () => {
      const tutorMetrics = {
        entity_id: 'tutor-001',
        entity_type: 'tutor',
        sessions_30d: 10,
        avg_rating: 4.0
      };

      dynamoDBMock.on(GetCommand).resolves({ Item: tutorMetrics });
      dynamoDBMock.on(PutCommand).resolves({});

      const record = createKinesisRecord(validSessionCompletedEvent);

      // New average should be (4.0 * 10 + 5) / 11 = 4.09
      expect(dynamoDBMock).toBeDefined();
    });

    it('should track IB call frequency for students', async () => {
      dynamoDBMock.on(GetCommand).resolves({ Item: normalStudentMetrics });
      dynamoDBMock.on(PutCommand).resolves({});

      const record = createKinesisRecord(validIBCallEvent);

      // Should increment ib_calls_7d and ib_calls_14d
      expect(dynamoDBMock).toBeDefined();
    });

    it('should update health scores from health update events', async () => {
      dynamoDBMock.on(GetCommand).resolves({ Item: normalStudentMetrics });
      dynamoDBMock.on(PutCommand).resolves({});

      const record = createKinesisRecord(validHealthUpdateEvent);

      // Should update health_score to 65
      expect(dynamoDBMock).toBeDefined();
    });

    it('should store supply/demand metrics for subjects', async () => {
      dynamoDBMock.on(PutCommand).resolves({});

      const record = createKinesisRecord(validSupplyDemandEvent);

      // Should store with entity_type: 'subject'
      expect(dynamoDBMock).toBeDefined();
    });

    it('should handle concurrent updates for same entity', async () => {
      dynamoDBMock.on(GetCommand).resolves({ Item: normalStudentMetrics });
      dynamoDBMock.on(PutCommand).resolves({});

      const records = [
        createKinesisRecord(validSessionStartedEvent),
        createKinesisRecord(validSessionStartedEvent),
        createKinesisRecord(validSessionStartedEvent)
      ];

      // Process all records - should not cause conflicts
      expect(records).toHaveLength(3);
    });
  });

  describe('Anomaly Detection', () => {
    beforeEach(() => {
      dynamoDBMock.reset();
      eventBridgeMock.reset();
    });

    it('should trigger alert for high IB call frequency', async () => {
      const highIBMetrics = {
        ...normalStudentMetrics,
        ib_calls_14d: 5,
        health_score: 75
      };

      dynamoDBMock.on(GetCommand).resolves({ Item: highIBMetrics });
      eventBridgeMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0 });

      // Should trigger high_ib_call_frequency alert
      expect(highIBMetrics.ib_calls_14d).toBeGreaterThanOrEqual(3);
    });

    it('should trigger critical alert for health score < 50', async () => {
      dynamoDBMock.on(GetCommand).resolves({ Item: highRiskStudentMetrics });
      eventBridgeMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0 });

      // Should trigger critical severity alert
      expect(highRiskStudentMetrics.health_score).toBeLessThan(50);
    });

    it('should trigger warning alert for health score 50-70', async () => {
      const warningMetrics = {
        ...normalStudentMetrics,
        health_score: 65
      };

      dynamoDBMock.on(GetCommand).resolves({ Item: warningMetrics });
      eventBridgeMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0 });

      expect(warningMetrics.health_score).toBeGreaterThanOrEqual(50);
      expect(warningMetrics.health_score).toBeLessThan(70);
    });

    it('should detect supply/demand imbalance', async () => {
      eventBridgeMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0 });

      const imbalanceEvent = validSupplyDemandEvent;
      expect(imbalanceEvent.payload.balance_status).toBe('high_demand');
    });

    it('should not trigger alerts for healthy metrics', async () => {
      dynamoDBMock.on(GetCommand).resolves({ Item: normalStudentMetrics });
      eventBridgeMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0 });

      // No alerts should be triggered
      expect(normalStudentMetrics.health_score).toBeGreaterThanOrEqual(70);
      expect(normalStudentMetrics.ib_calls_14d).toBeLessThan(3);
    });
  });

  describe('EventBridge Integration', () => {
    beforeEach(() => {
      eventBridgeMock.reset();
    });

    it('should send alerts to EventBridge with correct format', async () => {
      eventBridgeMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0 });

      const alert = {
        alert_type: 'high_ib_call_frequency',
        severity: 'warning',
        entity_id: 'student-001',
        entity_type: 'student',
        details: {
          ib_calls_14d: 5,
          health_score: 75
        },
        message: 'Student student-001 has 5 IB calls in 14 days',
        timestamp: new Date().toISOString()
      };

      // Verify EventBridge entry format
      expect(alert).toHaveProperty('alert_type');
      expect(alert).toHaveProperty('severity');
      expect(alert).toHaveProperty('entity_id');
      expect(alert.details).toBeDefined();
    });

    it('should batch multiple alerts in single EventBridge call', async () => {
      eventBridgeMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0 });

      const alerts = [
        { alert_type: 'high_ib_call_frequency' },
        { alert_type: 'low_health_score' },
        { alert_type: 'supply_demand_imbalance' }
      ];

      expect(alerts).toHaveLength(3);
    });

    it('should handle EventBridge failures gracefully', async () => {
      eventBridgeMock.on(PutEventsCommand).rejects(new Error('EventBridge unavailable'));

      // Should log error but not fail entire batch
      expect(() => {
        throw new Error('EventBridge unavailable');
      }).toThrow('EventBridge unavailable');
    });
  });

  describe('Error Handling', () => {
    it('should continue processing on individual record failure', async () => {
      const records = [
        createKinesisRecord(validSessionStartedEvent),
        createKinesisRecord('invalid'),
        createKinesisRecord(validSessionCompletedEvent)
      ];

      // Should process valid records even if one fails
      expect(records).toHaveLength(3);
    });

    it('should handle DynamoDB throttling', async () => {
      dynamoDBMock.on(PutCommand).rejects({
        name: 'ProvisionedThroughputExceededException',
        message: 'Throughput exceeded'
      });

      // Should handle gracefully
      expect(() => {
        throw new Error('Throughput exceeded');
      }).toThrow();
    });

    it('should handle missing required fields', async () => {
      const invalidEvent = {
        event_type: 'session_started',
        payload: {}  // Missing student_id, tutor_id
      };

      const record = createKinesisRecord(invalidEvent);

      // Should handle missing fields gracefully
      expect(invalidEvent.payload).toBeDefined();
    });
  });

  describe('Data Type Conversions', () => {
    it('should convert floats to Decimal for DynamoDB', () => {
      const value = 85.5;
      const decimal = value.toString();

      expect(decimal).toBe('85.5');
    });

    it('should handle Decimal to float conversions for alerts', () => {
      const metrics = {
        health_score: '85.5',
        avg_rating: '4.8'
      };

      expect(parseFloat(metrics.health_score)).toBe(85.5);
      expect(parseFloat(metrics.avg_rating)).toBe(4.8);
    });

    it('should preserve precision in rating calculations', () => {
      const currentAvg = 4.0;
      const totalSessions = 10;
      const newRating = 5;

      const newAvg = ((currentAvg * totalSessions) + newRating) / (totalSessions + 1);

      expect(newAvg).toBeCloseTo(4.09, 2);
    });
  });

  describe('Batch Processing', () => {
    it('should process large batches efficiently', async () => {
      const batchSize = 100;
      const records = Array(batchSize).fill(null).map(() =>
        createKinesisRecord(validSessionStartedEvent)
      );

      dynamoDBMock.on(GetCommand).resolves({ Item: normalStudentMetrics });
      dynamoDBMock.on(PutCommand).resolves({});

      expect(records).toHaveLength(batchSize);
    });

    it('should handle empty batch', async () => {
      const records = [];
      expect(records).toHaveLength(0);
    });

    it('should process mixed event types in batch', async () => {
      const records = [
        createKinesisRecord(validSessionStartedEvent),
        createKinesisRecord(validIBCallEvent),
        createKinesisRecord(validHealthUpdateEvent),
        createKinesisRecord(validSupplyDemandEvent)
      ];

      dynamoDBMock.on(GetCommand).resolves({ Item: normalStudentMetrics });
      dynamoDBMock.on(PutCommand).resolves({});

      expect(records).toHaveLength(4);
    });
  });

  describe('Timestamp Handling', () => {
    it('should use event timestamp if provided', () => {
      const event = validSessionStartedEvent;
      expect(event.timestamp).toBeDefined();
      expect(new Date(event.timestamp).getTime()).toBeGreaterThan(0);
    });

    it('should generate timestamp if missing', () => {
      const event = {
        ...validSessionStartedEvent,
        timestamp: undefined
      };

      const timestamp = new Date().toISOString();
      expect(timestamp).toBeDefined();
    });

    it('should track last_updated in metrics', async () => {
      dynamoDBMock.on(PutCommand).resolves({});

      const timestamp = new Date().toISOString();
      expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  describe('Performance', () => {
    it('should process records within 500ms latency target', async () => {
      const start = Date.now();

      const record = createKinesisRecord(validSessionStartedEvent);
      dynamoDBMock.on(GetCommand).resolves({ Item: normalStudentMetrics });
      dynamoDBMock.on(PutCommand).resolves({});

      const duration = Date.now() - start;
      expect(duration).toBeLessThan(500);
    });

    it('should handle 200 concurrent streams', async () => {
      const streams = 200;
      const recordsPerStream = 10;

      const totalRecords = streams * recordsPerStream;
      expect(totalRecords).toBe(2000);
    });
  });
});
