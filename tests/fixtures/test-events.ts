/**
 * Test Event Fixtures
 * Sample events for testing different scenarios
 */

export const validSessionStartedEvent = {
  event_type: 'session_started',
  timestamp: '2024-11-05T10:00:00.000Z',
  payload: {
    student_id: 'student-001',
    tutor_id: 'tutor-001',
    subject: 'mathematics',
    session_id: 'session-123'
  }
};

export const validSessionCompletedEvent = {
  event_type: 'session_completed',
  timestamp: '2024-11-05T11:00:00.000Z',
  payload: {
    student_id: 'student-001',
    tutor_id: 'tutor-001',
    subject: 'mathematics',
    session_id: 'session-123',
    duration_minutes: 60,
    tutor_rating: 5
  }
};

export const validIBCallEvent = {
  event_type: 'ib_call_logged',
  timestamp: '2024-11-05T12:00:00.000Z',
  payload: {
    student_id: 'student-001',
    call_reason: 'technical_issue',
    duration_seconds: 180
  }
};

export const validHealthUpdateEvent = {
  event_type: 'customer_health_update',
  timestamp: '2024-11-05T13:00:00.000Z',
  payload: {
    student_id: 'student-001',
    health_score: 65,
    sessions_last_7_days: 3,
    sessions_last_30_days: 15,
    ib_calls_last_14_days: 4
  }
};

export const validSupplyDemandEvent = {
  event_type: 'supply_demand_update',
  timestamp: '2024-11-05T14:00:00.000Z',
  payload: {
    subject: 'physics',
    region: 'us-east',
    available_tutors: 10,
    active_students: 50,
    demand_score: 85,
    supply_score: 45,
    balance_status: 'high_demand'
  }
};

export const highRiskStudentMetrics = {
  entity_id: 'student-high-risk',
  entity_type: 'student',
  sessions_7d: 1,
  sessions_14d: 2,
  sessions_30d: 4,
  ib_calls_7d: 2,
  ib_calls_14d: 5,
  avg_rating: 0,
  health_score: 35,
  last_updated: '2024-11-05T10:00:00.000Z'
};

export const normalStudentMetrics = {
  entity_id: 'student-normal',
  entity_type: 'student',
  sessions_7d: 5,
  sessions_14d: 10,
  sessions_30d: 20,
  ib_calls_7d: 0,
  ib_calls_14d: 1,
  avg_rating: 0,
  health_score: 85,
  last_updated: '2024-11-05T10:00:00.000Z'
};

export const highPerformanceTutorMetrics = {
  entity_id: 'tutor-excellent',
  entity_type: 'tutor',
  sessions_7d: 15,
  sessions_14d: 30,
  sessions_30d: 60,
  avg_rating: 4.8,
  last_updated: '2024-11-05T10:00:00.000Z'
};

// API Gateway event template
export const createAPIGatewayEvent = (body: any) => ({
  body: JSON.stringify(body),
  headers: {
    'Content-Type': 'application/json'
  },
  requestContext: {
    requestId: 'test-request-id',
    identity: {
      sourceIp: '192.168.1.1'
    }
  },
  httpMethod: 'POST',
  path: '/ingest',
  isBase64Encoded: false
});

// Kinesis record template
export const createKinesisRecord = (data: any) => ({
  kinesis: {
    data: Buffer.from(JSON.stringify(data)).toString('base64'),
    sequenceNumber: '12345',
    partitionKey: data.event_type || 'test',
    approximateArrivalTimestamp: Date.now() / 1000
  },
  eventID: 'shardId-000000000000:12345',
  eventName: 'aws:kinesis:record',
  eventVersion: '1.0',
  eventSource: 'aws:kinesis',
  awsRegion: 'us-east-1'
});

// EventBridge event template
export const createEventBridgeEvent = (detail: any, detailType: string) => ({
  version: '0',
  id: 'test-event-id',
  'detail-type': detailType,
  source: 'iops-dashboard.processor',
  account: '123456789012',
  time: new Date().toISOString(),
  region: 'us-east-1',
  resources: [],
  detail: detail
});

// Generate 600 diverse test insights as specified in requirements
export const generateDiverseTestInsights = (count: number = 600) => {
  const insights = [];
  const eventTypes = [
    'session_started',
    'session_completed',
    'ib_call_logged',
    'customer_health_update',
    'supply_demand_update'
  ];

  const subjects = ['mathematics', 'physics', 'chemistry', 'biology', 'english', 'history'];
  const regions = ['us-east', 'us-west', 'eu-central', 'asia-pacific'];

  for (let i = 0; i < count; i++) {
    const eventType = eventTypes[i % eventTypes.length];
    const timestamp = new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString();

    let payload;
    switch (eventType) {
      case 'session_started':
      case 'session_completed':
        payload = {
          student_id: `student-${Math.floor(i / 3)}`,
          tutor_id: `tutor-${Math.floor(i / 5)}`,
          subject: subjects[i % subjects.length],
          session_id: `session-${i}`,
          ...(eventType === 'session_completed' && {
            duration_minutes: 30 + Math.floor(Math.random() * 90),
            tutor_rating: 3 + Math.floor(Math.random() * 3)
          })
        };
        break;
      case 'ib_call_logged':
        payload = {
          student_id: `student-${Math.floor(i / 10)}`,
          call_reason: ['technical_issue', 'billing', 'scheduling'][i % 3],
          duration_seconds: 60 + Math.floor(Math.random() * 600)
        };
        break;
      case 'customer_health_update':
        payload = {
          student_id: `student-${Math.floor(i / 5)}`,
          health_score: 30 + Math.floor(Math.random() * 70),
          sessions_last_7_days: Math.floor(Math.random() * 10),
          sessions_last_30_days: Math.floor(Math.random() * 40),
          ib_calls_last_14_days: Math.floor(Math.random() * 6)
        };
        break;
      case 'supply_demand_update':
        payload = {
          subject: subjects[i % subjects.length],
          region: regions[i % regions.length],
          available_tutors: 5 + Math.floor(Math.random() * 50),
          active_students: 10 + Math.floor(Math.random() * 100),
          demand_score: 40 + Math.floor(Math.random() * 60),
          supply_score: 30 + Math.floor(Math.random() * 70),
          balance_status: ['balanced', 'high_demand', 'high_supply'][i % 3]
        };
        break;
    }

    insights.push({
      event_type: eventType,
      timestamp,
      payload,
      ingested_at: timestamp
    });
  }

  return insights;
};
