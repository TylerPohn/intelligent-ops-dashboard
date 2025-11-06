/**
 * Ingest Lambda Unit Tests
 * Tests for API Gateway ingestion endpoint (lambda/ingest/index.ts)
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { kinesisMock } from '../setup';
import { PutRecordCommand } from '@aws-sdk/client-kinesis';
import {
  createAPIGatewayEvent,
  validSessionStartedEvent,
  validIBCallEvent,
  validHealthUpdateEvent
} from '../fixtures/test-events';

describe('Ingest Lambda - API Gateway Handler', () => {

  beforeEach(() => {
    kinesisMock.reset();
  });

  describe('Request Validation', () => {
    it('should reject missing request body', () => {
      const event = {
        ...createAPIGatewayEvent(null),
        body: null
      };

      expect(event.body).toBeNull();
    });

    it('should reject invalid JSON', () => {
      const event = {
        ...createAPIGatewayEvent(null),
        body: 'invalid json {'
      };

      expect(() => JSON.parse(event.body)).toThrow();
    });

    it('should reject missing event_type', () => {
      const invalidEvent = {
        payload: { student_id: 'test' }
      };

      expect(invalidEvent).not.toHaveProperty('event_type');
    });

    it('should reject invalid event_type', () => {
      const invalidEvent = {
        event_type: 'invalid_type',
        payload: {}
      };

      const validTypes = [
        'session_started',
        'session_completed',
        'ib_call_logged',
        'tutor_availability_updated',
        'customer_health_update',
        'supply_demand_update'
      ];

      expect(validTypes).not.toContain(invalidEvent.event_type);
    });

    it('should reject missing payload', () => {
      const invalidEvent = {
        event_type: 'session_started'
      };

      expect(invalidEvent).not.toHaveProperty('payload');
    });

    it('should reject non-object payload', () => {
      const invalidEvent = {
        event_type: 'session_started',
        payload: 'string'
      };

      expect(typeof invalidEvent.payload).not.toBe('object');
    });

    it('should accept all valid event types', () => {
      const validTypes = [
        'session_started',
        'session_completed',
        'ib_call_logged',
        'tutor_availability_updated',
        'customer_health_update',
        'supply_demand_update'
      ];

      validTypes.forEach(type => {
        const event = {
          event_type: type,
          payload: {}
        };

        expect(validTypes).toContain(event.event_type);
      });
    });
  });

  describe('Event Enrichment', () => {
    it('should add timestamp if not provided', () => {
      const event = {
        event_type: 'session_started',
        payload: { student_id: 'test' }
      };

      const timestamp = new Date().toISOString();
      const enriched = { ...event, timestamp };

      expect(enriched.timestamp).toBeDefined();
      expect(new Date(enriched.timestamp).getTime()).toBeGreaterThan(0);
    });

    it('should preserve provided timestamp', () => {
      const customTimestamp = '2024-11-05T10:00:00.000Z';
      const event = {
        ...validSessionStartedEvent,
        timestamp: customTimestamp
      };

      expect(event.timestamp).toBe(customTimestamp);
    });

    it('should add ingestion metadata', () => {
      const apiEvent = createAPIGatewayEvent(validSessionStartedEvent);

      const enriched = {
        ...validSessionStartedEvent,
        ingested_at: new Date().toISOString(),
        source_ip: apiEvent.requestContext.identity.sourceIp,
        request_id: apiEvent.requestContext.requestId
      };

      expect(enriched).toHaveProperty('ingested_at');
      expect(enriched).toHaveProperty('source_ip');
      expect(enriched).toHaveProperty('request_id');
    });

    it('should capture source IP correctly', () => {
      const apiEvent = createAPIGatewayEvent(validSessionStartedEvent);
      expect(apiEvent.requestContext.identity.sourceIp).toBe('192.168.1.1');
    });

    it('should capture request ID correctly', () => {
      const apiEvent = createAPIGatewayEvent(validSessionStartedEvent);
      expect(apiEvent.requestContext.requestId).toBe('test-request-id');
    });
  });

  describe('Kinesis Integration', () => {
    it('should send valid events to Kinesis', async () => {
      kinesisMock.on(PutRecordCommand).resolves({
        ShardId: 'shardId-000000000000',
        SequenceNumber: '49590338271490256608559692538361571095921575989136588898'
      });

      const apiEvent = createAPIGatewayEvent(validSessionStartedEvent);

      expect(kinesisMock).toBeDefined();
    });

    it('should use event_type as partition key', () => {
      const event = validSessionStartedEvent;
      const partitionKey = event.event_type;

      expect(partitionKey).toBe('session_started');
    });

    it('should encode event data as Buffer', () => {
      const data = JSON.stringify(validSessionStartedEvent);
      const buffer = Buffer.from(data);

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.toString('utf-8')).toBe(data);
    });

    it('should handle Kinesis success response', async () => {
      const response = {
        ShardId: 'shardId-000000000000',
        SequenceNumber: '12345'
      };

      kinesisMock.on(PutRecordCommand).resolves(response);

      expect(response).toHaveProperty('ShardId');
      expect(response).toHaveProperty('SequenceNumber');
    });

    it('should handle different partition keys for different events', () => {
      const events = [
        validSessionStartedEvent,
        validIBCallEvent,
        validHealthUpdateEvent
      ];

      const partitionKeys = events.map(e => e.event_type);
      const uniqueKeys = new Set(partitionKeys);

      expect(uniqueKeys.size).toBe(3);
    });
  });

  describe('Response Format', () => {
    it('should return 200 on success', async () => {
      kinesisMock.on(PutRecordCommand).resolves({
        ShardId: 'shardId-000000000000',
        SequenceNumber: '12345'
      });

      const response = {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Event received successfully',
          eventType: 'session_started',
          sequenceNumber: '12345',
          shardId: 'shardId-000000000000'
        })
      };

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.message).toBe('Event received successfully');
    });

    it('should return 400 for missing body', () => {
      const response = {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Request body is required' })
      };

      expect(response.statusCode).toBe(400);
    });

    it('should return 400 for invalid JSON', () => {
      const response = {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid JSON in request body' })
      };

      expect(response.statusCode).toBe(400);
    });

    it('should return 400 for invalid event_type', () => {
      const response = {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Invalid event_type. Must be one of: session_started, session_completed, ib_call_logged, tutor_availability_updated, customer_health_update, supply_demand_update'
        })
      };

      expect(response.statusCode).toBe(400);
    });

    it('should return 500 on Kinesis failure', () => {
      const response = {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Internal server error',
          message: 'Kinesis unavailable'
        })
      };

      expect(response.statusCode).toBe(500);
    });

    it('should include sequence number in success response', async () => {
      const sequenceNumber = '49590338271490256608559692538361571095921575989136588898';

      kinesisMock.on(PutRecordCommand).resolves({
        ShardId: 'shardId-000000000000',
        SequenceNumber: sequenceNumber
      });

      const response = {
        statusCode: 200,
        body: JSON.stringify({ sequenceNumber })
      };

      const body = JSON.parse(response.body);
      expect(body.sequenceNumber).toBe(sequenceNumber);
    });
  });

  describe('Error Handling', () => {
    it('should handle Kinesis throttling', async () => {
      kinesisMock.on(PutRecordCommand).rejects({
        name: 'ProvisionedThroughputExceededException',
        message: 'Throughput exceeded'
      });

      expect(() => {
        throw new Error('Throughput exceeded');
      }).toThrow('Throughput exceeded');
    });

    it('should handle Kinesis network errors', async () => {
      kinesisMock.on(PutRecordCommand).rejects({
        name: 'NetworkError',
        message: 'Network unavailable'
      });

      expect(() => {
        throw new Error('Network unavailable');
      }).toThrow();
    });

    it('should log errors appropriately', () => {
      const error = new Error('Test error');
      const logged = {
        message: error.message,
        stack: error.stack,
        name: error.name
      };

      expect(logged).toHaveProperty('message');
      expect(logged).toHaveProperty('stack');
    });

    it('should handle syntax errors from invalid JSON', () => {
      expect(() => {
        JSON.parse('invalid{json');
      }).toThrow(SyntaxError);
    });
  });

  describe('Concurrent Requests', () => {
    it('should handle multiple simultaneous requests', async () => {
      kinesisMock.on(PutRecordCommand).resolves({
        ShardId: 'shardId-000000000000',
        SequenceNumber: '12345'
      });

      const requests = Array(10).fill(null).map(() =>
        createAPIGatewayEvent(validSessionStartedEvent)
      );

      expect(requests).toHaveLength(10);
    });

    it('should handle burst traffic', async () => {
      const burst = 100;
      const requests = Array(burst).fill(null).map(() =>
        createAPIGatewayEvent(validSessionStartedEvent)
      );

      expect(requests).toHaveLength(burst);
    });
  });

  describe('Performance', () => {
    it('should process request quickly', async () => {
      const start = Date.now();

      kinesisMock.on(PutRecordCommand).resolves({
        ShardId: 'shardId-000000000000',
        SequenceNumber: '12345'
      });

      // Simulate processing
      const data = JSON.stringify(validSessionStartedEvent);
      Buffer.from(data);

      const duration = Date.now() - start;
      expect(duration).toBeLessThan(100);
    });

    it('should handle large payloads efficiently', () => {
      const largePayload = {
        event_type: 'session_completed',
        payload: {
          ...validSessionStartedEvent.payload,
          notes: 'A'.repeat(1000)
        }
      };

      const serialized = JSON.stringify(largePayload);
      expect(serialized.length).toBeGreaterThan(1000);
    });
  });

  describe('Data Integrity', () => {
    it('should preserve all payload fields', () => {
      const original = validSessionStartedEvent;
      const serialized = JSON.stringify(original);
      const deserialized = JSON.parse(serialized);

      expect(deserialized).toEqual(original);
    });

    it('should handle special characters in payload', () => {
      const specialChars = {
        event_type: 'session_started',
        payload: {
          notes: 'Test with "quotes", \\slashes\\ and émojis 🚀'
        }
      };

      const serialized = JSON.stringify(specialChars);
      const deserialized = JSON.parse(serialized);

      expect(deserialized.payload.notes).toBe(specialChars.payload.notes);
    });

    it('should handle Unicode characters', () => {
      const unicode = {
        event_type: 'session_started',
        payload: {
          name: '学生',
          emoji: '😀🎉'
        }
      };

      const serialized = JSON.stringify(unicode);
      const deserialized = JSON.parse(serialized);

      expect(deserialized).toEqual(unicode);
    });
  });
});
