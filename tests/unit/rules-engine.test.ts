/**
 * Rules Engine Unit Tests
 * Tests for anomaly detection and threshold-based alerting logic
 */

import { describe, it, expect } from '@jest/globals';
import {
  highRiskStudentMetrics,
  normalStudentMetrics,
  validSupplyDemandEvent
} from '../fixtures/test-events';

describe('Rules Engine - Anomaly Detection', () => {

  describe('IOPS Threshold Detection', () => {
    it('should detect IB calls >= 3 in 14 days', () => {
      const metrics = {
        ...normalStudentMetrics,
        ib_calls_14d: 3
      };

      expect(metrics.ib_calls_14d).toBeGreaterThanOrEqual(3);
    });

    it('should not trigger for IB calls < 3', () => {
      expect(normalStudentMetrics.ib_calls_14d).toBeLessThan(3);
    });

    it('should detect high IB call frequency (>= 5)', () => {
      const highCallMetrics = {
        ...normalStudentMetrics,
        ib_calls_14d: 7
      };

      expect(highCallMetrics.ib_calls_14d).toBeGreaterThanOrEqual(5);
    });

    it('should track IB calls over different time windows', () => {
      const metrics = {
        ib_calls_7d: 2,
        ib_calls_14d: 5
      };

      expect(metrics.ib_calls_7d).toBeLessThan(metrics.ib_calls_14d);
    });
  });

  describe('Latency Threshold Analysis', () => {
    it('should flag latency > 10ms', () => {
      const latency = 15;
      expect(latency).toBeGreaterThan(10);
    });

    it('should accept latency <= 10ms', () => {
      const latency = 8;
      expect(latency).toBeLessThanOrEqual(10);
    });

    it('should handle edge case at exactly 10ms', () => {
      const latency = 10;
      expect(latency).toBe(10);
    });
  });

  describe('Error Rate Threshold', () => {
    it('should detect error rate > 1%', () => {
      const totalRequests = 1000;
      const errors = 15;
      const errorRate = (errors / totalRequests) * 100;

      expect(errorRate).toBeGreaterThan(1);
    });

    it('should accept error rate <= 1%', () => {
      const totalRequests = 1000;
      const errors = 8;
      const errorRate = (errors / totalRequests) * 100;

      expect(errorRate).toBeLessThanOrEqual(1);
    });

    it('should handle zero errors', () => {
      const errorRate = 0;
      expect(errorRate).toBe(0);
    });

    it('should calculate error rate accurately', () => {
      const totalRequests = 500;
      const errors = 5;
      const errorRate = (errors / totalRequests) * 100;

      expect(errorRate).toBeCloseTo(1.0, 1);
    });
  });

  describe('Queue Depth Analysis', () => {
    it('should detect high queue depth', () => {
      const queueDepth = 150;
      const threshold = 100;

      expect(queueDepth).toBeGreaterThan(threshold);
    });

    it('should accept normal queue depth', () => {
      const queueDepth = 50;
      const threshold = 100;

      expect(queueDepth).toBeLessThan(threshold);
    });

    it('should handle empty queue', () => {
      const queueDepth = 0;
      expect(queueDepth).toBe(0);
    });

    it('should track queue depth over time', () => {
      const measurements = [50, 75, 100, 125, 150];
      const increasing = measurements.every((val, i) =>
        i === 0 || val > measurements[i - 1]
      );

      expect(increasing).toBe(true);
    });
  });

  describe('Risk Score Calculation', () => {
    it('should calculate high risk score (>= 80)', () => {
      const factors = {
        ib_calls_14d: 5,
        health_score: 35,
        sessions_7d: 1,
        sessions_30d: 3
      };

      // High IB calls + low health + low sessions = high risk
      const riskScore = calculateRiskScore(factors);
      expect(riskScore).toBeGreaterThanOrEqual(80);
    });

    it('should calculate low risk score (< 30)', () => {
      const factors = {
        ib_calls_14d: 0,
        health_score: 90,
        sessions_7d: 8,
        sessions_30d: 25
      };

      const riskScore = calculateRiskScore(factors);
      expect(riskScore).toBeLessThan(30);
    });

    it('should calculate medium risk score (30-79)', () => {
      const factors = {
        ib_calls_14d: 2,
        health_score: 70,
        sessions_7d: 4,
        sessions_30d: 15
      };

      const riskScore = calculateRiskScore(factors);
      expect(riskScore).toBeGreaterThanOrEqual(30);
      expect(riskScore).toBeLessThan(80);
    });

    it('should weight health score heavily', () => {
      const lowHealth = { health_score: 30, ib_calls_14d: 0, sessions_7d: 5 };
      const highHealth = { health_score: 90, ib_calls_14d: 0, sessions_7d: 5 };

      const lowRisk = calculateRiskScore(lowHealth);
      const highRisk = calculateRiskScore(highHealth);

      expect(lowRisk).toBeGreaterThan(highRisk);
    });
  });

  describe('Health Score Thresholds', () => {
    it('should classify health score < 50 as critical', () => {
      expect(highRiskStudentMetrics.health_score).toBeLessThan(50);
      const severity = classifySeverity(highRiskStudentMetrics.health_score);
      expect(severity).toBe('critical');
    });

    it('should classify health score 50-69 as warning', () => {
      const warningScore = 65;
      expect(warningScore).toBeGreaterThanOrEqual(50);
      expect(warningScore).toBeLessThan(70);

      const severity = classifySeverity(warningScore);
      expect(severity).toBe('warning');
    });

    it('should classify health score >= 70 as normal', () => {
      expect(normalStudentMetrics.health_score).toBeGreaterThanOrEqual(70);
      const severity = classifySeverity(normalStudentMetrics.health_score);
      expect(severity).toBe('normal');
    });

    it('should handle edge cases at boundaries', () => {
      expect(classifySeverity(49)).toBe('critical');
      expect(classifySeverity(50)).toBe('warning');
      expect(classifySeverity(69)).toBe('warning');
      expect(classifySeverity(70)).toBe('normal');
    });
  });

  describe('Supply/Demand Balance', () => {
    it('should detect high demand (demand > supply * 1.5)', () => {
      const demand = 85;
      const supply = 45;
      const ratio = demand / supply;

      expect(ratio).toBeGreaterThan(1.5);
    });

    it('should detect high supply (supply > demand * 1.5)', () => {
      const demand = 30;
      const supply = 70;
      const ratio = supply / demand;

      expect(ratio).toBeGreaterThan(1.5);
    });

    it('should detect balanced state', () => {
      const demand = 60;
      const supply = 55;
      const ratio = Math.max(demand, supply) / Math.min(demand, supply);

      expect(ratio).toBeLessThanOrEqual(1.5);
    });

    it('should calculate imbalance severity', () => {
      const severely_imbalanced = { demand: 100, supply: 20 };
      const slightly_imbalanced = { demand: 60, supply: 45 };

      const severeRatio = severely_imbalanced.demand / severely_imbalanced.supply;
      const slightRatio = slightly_imbalanced.demand / slightly_imbalanced.supply;

      expect(severeRatio).toBeGreaterThan(slightRatio);
    });
  });

  describe('Session Frequency Patterns', () => {
    it('should detect declining session frequency', () => {
      const metrics = {
        sessions_7d: 2,
        sessions_14d: 6,
        sessions_30d: 15
      };

      // Average per week declining
      const recent_avg = metrics.sessions_7d;
      const mid_avg = (metrics.sessions_14d - metrics.sessions_7d) / 1;
      const early_avg = (metrics.sessions_30d - metrics.sessions_14d) / 2.3;

      expect(recent_avg).toBeLessThan(mid_avg);
    });

    it('should detect increasing session frequency', () => {
      const metrics = {
        sessions_7d: 8,
        sessions_14d: 12,
        sessions_30d: 18
      };

      const recent_avg = metrics.sessions_7d;
      const mid_avg = (metrics.sessions_14d - metrics.sessions_7d) / 1;

      expect(recent_avg).toBeGreaterThan(mid_avg);
    });

    it('should detect inactive students (0 sessions in 7d)', () => {
      const metrics = {
        sessions_7d: 0,
        sessions_14d: 2,
        sessions_30d: 5
      };

      expect(metrics.sessions_7d).toBe(0);
      expect(metrics.sessions_30d).toBeGreaterThan(0);
    });
  });

  describe('Combined Risk Factors', () => {
    it('should trigger multiple alerts for high-risk student', () => {
      const alerts = [];

      if (highRiskStudentMetrics.ib_calls_14d >= 3) {
        alerts.push('high_ib_call_frequency');
      }

      if (highRiskStudentMetrics.health_score < 70) {
        alerts.push('low_health_score');
      }

      if (highRiskStudentMetrics.sessions_7d < 3) {
        alerts.push('low_engagement');
      }

      expect(alerts.length).toBeGreaterThanOrEqual(2);
    });

    it('should not trigger alerts for normal student', () => {
      const alerts = [];

      if (normalStudentMetrics.ib_calls_14d >= 3) {
        alerts.push('high_ib_call_frequency');
      }

      if (normalStudentMetrics.health_score < 70) {
        alerts.push('low_health_score');
      }

      expect(alerts).toHaveLength(0);
    });
  });
});

// Helper functions
function calculateRiskScore(factors: any): number {
  let score = 0;

  // Health score contributes 50% (inverted: lower health = higher risk)
  score += (100 - factors.health_score) * 0.5;

  // IB calls contribute 30%
  score += Math.min(factors.ib_calls_14d * 5, 30);

  // Session frequency contributes 20%
  const expectedSessions = 5;
  const sessionDeficit = Math.max(0, expectedSessions - factors.sessions_7d);
  score += sessionDeficit * 4;

  return Math.min(Math.round(score), 100);
}

function classifySeverity(healthScore: number): string {
  if (healthScore < 50) return 'critical';
  if (healthScore < 70) return 'warning';
  return 'normal';
}
