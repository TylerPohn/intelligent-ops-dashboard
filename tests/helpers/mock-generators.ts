/**
 * Mock Data Generators
 * Utility functions for generating realistic test data
 */

export class MockDataGenerator {
  private static studentIdCounter = 0;
  private static tutorIdCounter = 0;
  private static sessionIdCounter = 0;

  /**
   * Generate a unique student ID
   */
  static generateStudentId(): string {
    return `student-${String(this.studentIdCounter++).padStart(6, '0')}`;
  }

  /**
   * Generate a unique tutor ID
   */
  static generateTutorId(): string {
    return `tutor-${String(this.tutorIdCounter++).padStart(6, '0')}`;
  }

  /**
   * Generate a unique session ID
   */
  static generateSessionId(): string {
    return `session-${String(this.sessionIdCounter++).padStart(8, '0')}`;
  }

  /**
   * Generate realistic student metrics
   */
  static generateStudentMetrics(options: {
    healthScore?: number;
    ibCalls?: number;
    sessions?: number;
    risk?: 'low' | 'medium' | 'high';
  } = {}) {
    const { risk = 'medium' } = options;

    let healthScore = options.healthScore;
    let ibCalls = options.ibCalls;
    let sessions = options.sessions;

    // Generate based on risk level if not specified
    if (healthScore === undefined) {
      healthScore = risk === 'high' ? 30 + Math.random() * 20 :
                    risk === 'low' ? 80 + Math.random() * 20 :
                    50 + Math.random() * 30;
    }

    if (ibCalls === undefined) {
      ibCalls = risk === 'high' ? 4 + Math.floor(Math.random() * 4) :
                risk === 'low' ? 0 + Math.floor(Math.random() * 2) :
                2 + Math.floor(Math.random() * 2);
    }

    if (sessions === undefined) {
      sessions = risk === 'high' ? 1 + Math.floor(Math.random() * 3) :
                 risk === 'low' ? 5 + Math.floor(Math.random() * 5) :
                 3 + Math.floor(Math.random() * 3);
    }

    return {
      entity_id: this.generateStudentId(),
      entity_type: 'student',
      sessions_7d: sessions,
      sessions_14d: sessions * 2,
      sessions_30d: sessions * 4,
      ib_calls_7d: Math.floor(ibCalls / 2),
      ib_calls_14d: ibCalls,
      avg_rating: 0,
      health_score: Math.round(healthScore),
      last_updated: new Date().toISOString()
    };
  }

  /**
   * Generate realistic tutor metrics
   */
  static generateTutorMetrics(options: {
    rating?: number;
    sessions?: number;
  } = {}) {
    const rating = options.rating ?? 3.5 + Math.random() * 1.5;
    const sessions = options.sessions ?? 10 + Math.floor(Math.random() * 20);

    return {
      entity_id: this.generateTutorId(),
      entity_type: 'tutor',
      sessions_7d: Math.floor(sessions / 4),
      sessions_14d: Math.floor(sessions / 2),
      sessions_30d: sessions,
      avg_rating: Math.round(rating * 10) / 10,
      last_updated: new Date().toISOString()
    };
  }

  /**
   * Generate session event
   */
  static generateSessionEvent(type: 'started' | 'completed' = 'started') {
    const studentId = this.generateStudentId();
    const tutorId = this.generateTutorId();
    const sessionId = this.generateSessionId();

    const baseEvent = {
      event_type: `session_${type}`,
      timestamp: new Date().toISOString(),
      payload: {
        student_id: studentId,
        tutor_id: tutorId,
        session_id: sessionId,
        subject: this.randomSubject()
      }
    };

    if (type === 'completed') {
      return {
        ...baseEvent,
        payload: {
          ...baseEvent.payload,
          duration_minutes: 30 + Math.floor(Math.random() * 90),
          tutor_rating: 3 + Math.floor(Math.random() * 3)
        }
      };
    }

    return baseEvent;
  }

  /**
   * Generate IB call event
   */
  static generateIBCallEvent(studentId?: string) {
    return {
      event_type: 'ib_call_logged',
      timestamp: new Date().toISOString(),
      payload: {
        student_id: studentId || this.generateStudentId(),
        call_reason: this.randomCallReason(),
        duration_seconds: 60 + Math.floor(Math.random() * 600)
      }
    };
  }

  /**
   * Generate health update event
   */
  static generateHealthUpdateEvent(studentId?: string, risk: 'low' | 'medium' | 'high' = 'medium') {
    const healthScore = risk === 'high' ? 30 + Math.random() * 20 :
                        risk === 'low' ? 80 + Math.random() * 20 :
                        50 + Math.random() * 30;

    return {
      event_type: 'customer_health_update',
      timestamp: new Date().toISOString(),
      payload: {
        student_id: studentId || this.generateStudentId(),
        health_score: Math.round(healthScore),
        sessions_last_7_days: 2 + Math.floor(Math.random() * 6),
        sessions_last_30_days: 10 + Math.floor(Math.random() * 20),
        ib_calls_last_14_days: Math.floor(Math.random() * 5)
      }
    };
  }

  /**
   * Generate supply/demand event
   */
  static generateSupplyDemandEvent(balanceStatus: 'balanced' | 'high_demand' | 'high_supply' = 'balanced') {
    let demandScore, supplyScore;

    if (balanceStatus === 'high_demand') {
      demandScore = 70 + Math.floor(Math.random() * 30);
      supplyScore = 30 + Math.floor(Math.random() * 30);
    } else if (balanceStatus === 'high_supply') {
      demandScore = 30 + Math.floor(Math.random() * 30);
      supplyScore = 70 + Math.floor(Math.random() * 30);
    } else {
      demandScore = 50 + Math.floor(Math.random() * 20);
      supplyScore = 50 + Math.floor(Math.random() * 20);
    }

    return {
      event_type: 'supply_demand_update',
      timestamp: new Date().toISOString(),
      payload: {
        subject: this.randomSubject(),
        region: this.randomRegion(),
        available_tutors: 5 + Math.floor(Math.random() * 50),
        active_students: 10 + Math.floor(Math.random() * 100),
        demand_score: demandScore,
        supply_score: supplyScore,
        balance_status: balanceStatus
      }
    };
  }

  /**
   * Generate a batch of diverse events
   */
  static generateEventBatch(count: number) {
    const events = [];
    const eventTypes = ['session', 'ib_call', 'health', 'supply_demand'];

    for (let i = 0; i < count; i++) {
      const type = eventTypes[i % eventTypes.length];

      switch (type) {
        case 'session':
          events.push(this.generateSessionEvent(i % 2 === 0 ? 'started' : 'completed'));
          break;
        case 'ib_call':
          events.push(this.generateIBCallEvent());
          break;
        case 'health':
          events.push(this.generateHealthUpdateEvent());
          break;
        case 'supply_demand':
          events.push(this.generateSupplyDemandEvent());
          break;
      }
    }

    return events;
  }

  /**
   * Generate time series data
   */
  static generateTimeSeries(
    eventGenerator: () => any,
    count: number,
    startTime: Date = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  ) {
    const events = [];
    const timeIncrement = (Date.now() - startTime.getTime()) / count;

    for (let i = 0; i < count; i++) {
      const event = eventGenerator();
      event.timestamp = new Date(startTime.getTime() + i * timeIncrement).toISOString();
      events.push(event);
    }

    return events;
  }

  /**
   * Helper: Random subject
   */
  private static randomSubject(): string {
    const subjects = ['mathematics', 'physics', 'chemistry', 'biology', 'english', 'history', 'computer_science'];
    return subjects[Math.floor(Math.random() * subjects.length)];
  }

  /**
   * Helper: Random region
   */
  private static randomRegion(): string {
    const regions = ['us-east', 'us-west', 'eu-central', 'asia-pacific'];
    return regions[Math.floor(Math.random() * regions.length)];
  }

  /**
   * Helper: Random call reason
   */
  private static randomCallReason(): string {
    const reasons = ['technical_issue', 'billing', 'scheduling', 'general_inquiry', 'complaint'];
    return reasons[Math.floor(Math.random() * reasons.length)];
  }

  /**
   * Reset counters (useful for test isolation)
   */
  static reset() {
    this.studentIdCounter = 0;
    this.tutorIdCounter = 0;
    this.sessionIdCounter = 0;
  }
}

/**
 * Performance measurement utility
 */
export class PerformanceTracker {
  private measurements: Map<string, number[]> = new Map();

  /**
   * Start timing an operation
   */
  start(operationName: string): () => void {
    const startTime = performance.now();

    return () => {
      const duration = performance.now() - startTime;
      this.record(operationName, duration);
    };
  }

  /**
   * Record a measurement
   */
  record(operationName: string, duration: number) {
    if (!this.measurements.has(operationName)) {
      this.measurements.set(operationName, []);
    }
    this.measurements.get(operationName)!.push(duration);
  }

  /**
   * Get statistics for an operation
   */
  getStats(operationName: string) {
    const measurements = this.measurements.get(operationName) || [];

    if (measurements.length === 0) {
      return null;
    }

    const sorted = [...measurements].sort((a, b) => a - b);
    const sum = measurements.reduce((a, b) => a + b, 0);

    return {
      count: measurements.length,
      min: Math.min(...measurements),
      max: Math.max(...measurements),
      avg: sum / measurements.length,
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)]
    };
  }

  /**
   * Print all stats
   */
  printStats() {
    console.log('\n=== PERFORMANCE STATS ===');
    for (const [operation, _] of this.measurements) {
      const stats = this.getStats(operation);
      if (stats) {
        console.log(`\n${operation}:`);
        console.log(`  Count: ${stats.count}`);
        console.log(`  Avg: ${stats.avg.toFixed(2)}ms`);
        console.log(`  P50: ${stats.p50.toFixed(2)}ms`);
        console.log(`  P95: ${stats.p95.toFixed(2)}ms`);
        console.log(`  P99: ${stats.p99.toFixed(2)}ms`);
        console.log(`  Min: ${stats.min.toFixed(2)}ms`);
        console.log(`  Max: ${stats.max.toFixed(2)}ms`);
      }
    }
    console.log('========================\n');
  }

  /**
   * Clear all measurements
   */
  clear() {
    this.measurements.clear();
  }
}
