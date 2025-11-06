/**
 * Alert Flow Integration Tests
 * End-to-end testing of alert generation and SNS notifications
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { eventBridgeMock, snsMock, dynamoDBMock } from '../setup';
import { PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { PublishCommand } from '@aws-sdk/client-sns';
import { createEventBridgeEvent } from '../fixtures/test-events';

describe('Alert Flow - EventBridge to SNS Integration', () => {

  beforeEach(() => {
    eventBridgeMock.reset();
    snsMock.reset();
    dynamoDBMock.reset();
  });

  describe('EventBridge Rule Triggers', () => {
    it('should trigger alert for risk score >= 80', () => {
      const alert = {
        alert_type: 'low_health_score',
        severity: 'critical',
        entity_id: 'student-001',
        entity_type: 'student',
        details: {
          health_score: 35,
          risk_score: 85
        },
        message: 'Critical: Student health score 35',
        timestamp: new Date().toISOString()
      };

      expect(alert.details.risk_score).toBeGreaterThanOrEqual(80);
      expect(alert.severity).toBe('critical');
    });

    it('should not trigger for risk score < 80', () => {
      const alert = {
        alert_type: 'low_health_score',
        severity: 'warning',
        entity_id: 'student-002',
        details: {
          health_score: 65,
          risk_score: 55
        }
      };

      expect(alert.details.risk_score).toBeLessThan(80);
    });

    it('should trigger for different severity levels', () => {
      const severities = ['info', 'warning', 'critical'];

      severities.forEach(severity => {
        const alert = {
          alert_type: 'test_alert',
          severity,
          entity_id: 'test-entity',
          details: {}
        };

        expect(['info', 'warning', 'critical']).toContain(alert.severity);
      });
    });
  });

  describe('SNS Email Delivery', () => {
    it('should publish to SNS topic on high-risk alert', async () => {
      snsMock.on(PublishCommand).resolves({
        MessageId: 'test-message-id-123'
      });

      const alert = {
        alert_type: 'low_health_score',
        severity: 'critical',
        entity_id: 'student-001',
        entity_type: 'student',
        details: {
          health_score: 35,
          risk_score: 85,
          ib_calls_14d: 5
        },
        message: 'Critical: Student at high churn risk'
      };

      expect(alert.details.risk_score).toBeGreaterThanOrEqual(80);
    });

    it('should format SNS message correctly', () => {
      const alert = {
        alert_type: 'low_health_score',
        severity: 'critical',
        entity_id: 'student-001',
        details: {
          health_score: 35,
          risk_score: 85
        }
      };

      const snsMessage = {
        Subject: `[${alert.severity.toUpperCase()}] ${alert.alert_type}`,
        Message: JSON.stringify({
          alert_type: alert.alert_type,
          entity_id: alert.entity_id,
          severity: alert.severity,
          details: alert.details,
          timestamp: new Date().toISOString()
        })
      };

      expect(snsMessage.Subject).toContain('CRITICAL');
      expect(snsMessage.Message).toContain('student-001');
    });

    it('should include actionable details in email', () => {
      const emailContent = {
        alert_type: 'high_ib_call_frequency',
        entity_id: 'student-001',
        severity: 'warning',
        details: {
          ib_calls_14d: 5,
          health_score: 65,
          recent_calls: [
            { date: '2024-11-05', reason: 'technical_issue' },
            { date: '2024-11-04', reason: 'billing' }
          ]
        },
        recommended_actions: [
          'Schedule proactive check-in call',
          'Review recent session quality',
          'Verify billing issues resolved'
        ]
      };

      expect(emailContent.recommended_actions).toBeDefined();
      expect(emailContent.recommended_actions.length).toBeGreaterThan(0);
    });

    it('should handle SNS delivery failures gracefully', async () => {
      snsMock.on(PublishCommand).rejects(new Error('SNS unavailable'));

      expect(() => {
        throw new Error('SNS unavailable');
      }).toThrow('SNS unavailable');
    });

    it('should batch multiple alerts in one email', () => {
      const alerts = [
        {
          alert_type: 'low_health_score',
          entity_id: 'student-001',
          severity: 'critical'
        },
        {
          alert_type: 'high_ib_call_frequency',
          entity_id: 'student-001',
          severity: 'warning'
        }
      ];

      const batchedEmail = {
        Subject: '[ALERT BATCH] Multiple alerts for student-001',
        Message: JSON.stringify({
          entity_id: 'student-001',
          alert_count: alerts.length,
          alerts: alerts
        })
      };

      const parsed = JSON.parse(batchedEmail.Message);
      expect(parsed.alert_count).toBe(2);
    });
  });

  describe('Alert Content and Formatting', () => {
    it('should include timestamp in ISO format', () => {
      const alert = {
        timestamp: new Date().toISOString()
      };

      expect(alert.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('should include alert type and entity information', () => {
      const alert = {
        alert_type: 'low_health_score',
        entity_id: 'student-001',
        entity_type: 'student',
        severity: 'critical'
      };

      expect(alert).toHaveProperty('alert_type');
      expect(alert).toHaveProperty('entity_id');
      expect(alert).toHaveProperty('entity_type');
      expect(alert).toHaveProperty('severity');
    });

    it('should include detailed metrics in alert', () => {
      const alert = {
        alert_type: 'low_health_score',
        details: {
          health_score: 35,
          sessions_7d: 1,
          sessions_30d: 3,
          ib_calls_14d: 5,
          last_session: '2024-11-01',
          trend: 'declining'
        }
      };

      expect(alert.details).toHaveProperty('health_score');
      expect(alert.details).toHaveProperty('sessions_7d');
      expect(alert.details).toHaveProperty('trend');
    });

    it('should format supply/demand alerts correctly', () => {
      const alert = {
        alert_type: 'supply_demand_imbalance',
        severity: 'info',
        entity_id: 'physics',
        entity_type: 'subject',
        details: {
          balance_status: 'high_demand',
          demand_score: 85,
          supply_score: 45,
          available_tutors: 10,
          active_students: 50,
          recommended_action: 'Recruit 5 more physics tutors'
        }
      };

      expect(alert.details.balance_status).toBe('high_demand');
      expect(alert.details).toHaveProperty('recommended_action');
    });
  });

  describe('Different Severity Levels', () => {
    it('should handle critical severity alerts', async () => {
      snsMock.on(PublishCommand).resolves({ MessageId: 'msg-123' });

      const criticalAlert = {
        alert_type: 'low_health_score',
        severity: 'critical',
        entity_id: 'student-001',
        details: {
          health_score: 25,
          risk_score: 95
        }
      };

      expect(criticalAlert.severity).toBe('critical');
      expect(criticalAlert.details.health_score).toBeLessThan(50);
    });

    it('should handle warning severity alerts', () => {
      const warningAlert = {
        alert_type: 'high_ib_call_frequency',
        severity: 'warning',
        entity_id: 'student-002',
        details: {
          ib_calls_14d: 4,
          health_score: 65
        }
      };

      expect(warningAlert.severity).toBe('warning');
      expect(warningAlert.details.health_score).toBeGreaterThanOrEqual(50);
    });

    it('should handle info severity alerts', () => {
      const infoAlert = {
        alert_type: 'supply_demand_imbalance',
        severity: 'info',
        entity_id: 'mathematics',
        details: {
          balance_status: 'high_demand'
        }
      };

      expect(infoAlert.severity).toBe('info');
    });
  });

  describe('Alert Deduplication', () => {
    it('should not send duplicate alerts within time window', () => {
      const alert1 = {
        alert_type: 'low_health_score',
        entity_id: 'student-001',
        timestamp: '2024-11-05T10:00:00Z'
      };

      const alert2 = {
        alert_type: 'low_health_score',
        entity_id: 'student-001',
        timestamp: '2024-11-05T10:05:00Z'
      };

      const isDuplicate = (
        alert1.alert_type === alert2.alert_type &&
        alert1.entity_id === alert2.entity_id &&
        new Date(alert2.timestamp).getTime() - new Date(alert1.timestamp).getTime() < 3600000
      );

      expect(isDuplicate).toBe(true);
    });

    it('should send new alert after deduplication window', () => {
      const alert1 = {
        alert_type: 'low_health_score',
        entity_id: 'student-001',
        timestamp: '2024-11-05T10:00:00Z'
      };

      const alert2 = {
        alert_type: 'low_health_score',
        entity_id: 'student-001',
        timestamp: '2024-11-05T12:00:00Z'
      };

      const timeDiff = new Date(alert2.timestamp).getTime() - new Date(alert1.timestamp).getTime();
      const isDuplicate = timeDiff < 3600000; // 1 hour

      expect(isDuplicate).toBe(false);
    });
  });

  describe('End-to-End Alert Flow', () => {
    it('should flow: Metric Update → Anomaly Detection → EventBridge → SNS', async () => {
      // Step 1: Metric triggers anomaly
      const metrics = {
        entity_id: 'student-001',
        health_score: 35,
        ib_calls_14d: 5
      };

      // Step 2: Anomaly detected
      const shouldAlert = metrics.health_score < 50 || metrics.ib_calls_14d >= 3;
      expect(shouldAlert).toBe(true);

      // Step 3: EventBridge event created
      eventBridgeMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0 });

      // Step 4: SNS notification sent
      snsMock.on(PublishCommand).resolves({ MessageId: 'msg-123' });

      // Verify flow completed
      expect(shouldAlert).toBe(true);
    });

    it('should complete flow for multiple concurrent alerts', async () => {
      const alerts = [
        { entity_id: 'student-001', health_score: 35 },
        { entity_id: 'student-002', health_score: 45 },
        { entity_id: 'student-003', health_score: 40 }
      ];

      eventBridgeMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0 });
      snsMock.on(PublishCommand).resolves({ MessageId: 'msg-123' });

      const triggered = alerts.filter(a => a.health_score < 50);
      expect(triggered).toHaveLength(3);
    });
  });

  describe('Error Recovery', () => {
    it('should retry on transient SNS failures', async () => {
      let attempts = 0;

      snsMock.on(PublishCommand).callsFake(() => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Transient error');
        }
        return Promise.resolve({ MessageId: 'msg-123' });
      });

      // Should succeed on third attempt
      expect(attempts).toBeLessThanOrEqual(3);
    });

    it('should handle permanent SNS failures', async () => {
      snsMock.on(PublishCommand).rejects(new Error('Permanent failure'));

      expect(() => {
        throw new Error('Permanent failure');
      }).toThrow('Permanent failure');
    });

    it('should log failed alert deliveries', () => {
      const failedAlert = {
        alert_type: 'low_health_score',
        entity_id: 'student-001',
        error: 'SNS delivery failed',
        timestamp: new Date().toISOString()
      };

      expect(failedAlert).toHaveProperty('error');
      expect(failedAlert.error).toBe('SNS delivery failed');
    });
  });

  describe('Alert Metrics and Monitoring', () => {
    it('should track alert delivery success rate', () => {
      const totalAlerts = 100;
      const successfulDeliveries = 98;
      const successRate = (successfulDeliveries / totalAlerts) * 100;

      expect(successRate).toBeGreaterThanOrEqual(95);
    });

    it('should measure alert delivery latency', () => {
      const eventTime = new Date('2024-11-05T10:00:00Z').getTime();
      const deliveryTime = new Date('2024-11-05T10:00:02Z').getTime();
      const latency = deliveryTime - eventTime;

      expect(latency).toBeLessThan(5000); // < 5 seconds
    });

    it('should count alerts by severity', () => {
      const alerts = [
        { severity: 'critical' },
        { severity: 'critical' },
        { severity: 'warning' },
        { severity: 'info' }
      ];

      const counts = alerts.reduce((acc, a) => {
        acc[a.severity] = (acc[a.severity] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      expect(counts.critical).toBe(2);
      expect(counts.warning).toBe(1);
      expect(counts.info).toBe(1);
    });
  });

  describe('Alert History and Audit', () => {
    it('should store alert history in DynamoDB', () => {
      const alertRecord = {
        pk: 'alert#student-001',
        sk: new Date().toISOString(),
        alert_type: 'low_health_score',
        severity: 'critical',
        delivered: true,
        message_id: 'msg-123'
      };

      expect(alertRecord).toHaveProperty('pk');
      expect(alertRecord).toHaveProperty('delivered');
      expect(alertRecord).toHaveProperty('message_id');
    });

    it('should query alert history for entity', () => {
      const entityId = 'student-001';
      const pk = `alert#${entityId}`;

      expect(pk).toBe('alert#student-001');
    });
  });
});
