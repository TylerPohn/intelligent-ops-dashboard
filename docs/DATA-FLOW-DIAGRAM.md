# IOPS Dashboard - Data Flow Architecture

## Complete Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         DATA FLOW ARCHITECTURE                               │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│  DATA SOURCES                                                                 │
└──────────────────────────────────────────────────────────────────────────────┘

    ┌─────────────────┐         ┌──────────────────┐
    │   Test Script   │         │  Real IB Events  │
    │                 │         │   (Production)   │
    │  npm run        │         │                  │
    │  generate:demo  │         │  ib_stream_1..N  │
    └────────┬────────┘         └────────┬─────────┘
             │                           │
             │  BatchWriteItem (25/batch)│  PutRecord
             │                           │
             ▼                           ▼
    ┌────────────────────────────────────────────────┐
    │                                                 │
    │          Amazon DynamoDB                        │
    │      iops-dashboard-metrics                     │
    │                                                 │
    │  ┌─────────────────────────────────────────┐  │
    │  │  entity_id (PK)  │  entity_type (SK)    │  │
    │  │──────────────────┼──────────────────────│  │
    │  │  alert_001       │  insight             │  │
    │  │  alert_002       │  insight             │  │
    │  │  ib_stream_42    │  metric              │  │
    │  │  ...             │  ...                 │  │
    │  └─────────────────────────────────────────┘  │
    │                                                 │
    │  GSI: EntityTypeIndex                          │
    │  ┌─────────────────────────────────────────┐  │
    │  │  entity_type (PK) │  timestamp (SK)     │  │
    │  │──────────────────┼──────────────────────│  │
    │  │  insight         │  2025-11-05T17:36:00 │  │
    │  │  insight         │  2025-11-05T17:37:00 │  │
    │  │  insight         │  2025-11-05T17:38:00 │  │
    │  └─────────────────────────────────────────┘  │
    │                                                 │
    └────────────────┬───────────────────────────────┘
                     │
                     │  Query (entity_type = 'insight')
                     │  ScanIndexForward: false (newest first)
                     │  Limit: 10-100
                     │
                     ▼
    ┌────────────────────────────────────────────────┐
    │                                                 │
    │          AWS Lambda (Node.js)                   │
    │       IOpsDashboard-InsightsFunction            │
    │                                                 │
    │  ┌─────────────────────────────────────────┐  │
    │  │  Handler: get-insights.ts               │  │
    │  │                                         │  │
    │  │  1. Parse request path                  │  │
    │  │     /insights/recent?limit=10           │  │
    │  │                                         │  │
    │  │  2. Query DynamoDB GSI                  │  │
    │  │     - entity_type = 'insight'           │  │
    │  │     - Sort by timestamp DESC            │  │
    │  │                                         │  │
    │  │  3. Transform data                      │  │
    │  │     - Map entity_id → alert_id          │  │
    │  │     - Extract recommendations           │  │
    │  │     - Format timestamps                 │  │
    │  │                                         │  │
    │  │  4. Return JSON array                   │  │
    │  └─────────────────────────────────────────┘  │
    │                                                 │
    │  Response: 200-400ms                            │
    └────────────────┬───────────────────────────────┘
                     │
                     │  HTTP/2 Response
                     │  Content-Type: application/json
                     │  CORS: Access-Control-Allow-Origin: *
                     │
                     ▼
    ┌────────────────────────────────────────────────┐
    │                                                 │
    │        Amazon API Gateway (REST)                │
    │      https://dp41u4qn19.execute-api...          │
    │                                                 │
    │  Routes:                                        │
    │  ┌─────────────────────────────────────────┐  │
    │  │  GET /insights/recent?limit=N           │  │
    │  │  GET /insights/{id}                     │  │
    │  │  OPTIONS /* (CORS preflight)            │  │
    │  └─────────────────────────────────────────┘  │
    │                                                 │
    │  Features:                                      │
    │  • Lambda Proxy Integration                     │
    │  • CORS enabled                                 │
    │  • CloudFront CDN                               │
    │  • Request throttling                           │
    └────────────────┬───────────────────────────────┘
                     │
                     │  HTTPS GET Request
                     │  Every 5 seconds
                     │
                     ▼
    ┌────────────────────────────────────────────────┐
    │                                                 │
    │          React Frontend (Vite)                  │
    │         http://localhost:3002                   │
    │                                                 │
    │  ┌─────────────────────────────────────────┐  │
    │  │  usePolling Hook                        │  │
    │  │                                         │  │
    │  │  useEffect(() => {                      │  │
    │  │    setInterval(() => {                  │  │
    │  │      fetch(API_URL)                     │  │
    │  │        .then(data => {                  │  │
    │  │          setLastData(data)              │  │
    │  │          invalidateQueries(['insights'])│  │
    │  │        })                               │  │
    │  │    }, 5000)  // Poll every 5 seconds    │  │
    │  │  }, [])                                 │  │
    │  └─────────────────────────────────────────┘  │
    │                                                 │
    │  Components:                                    │
    │  ┌─────────────────────────────────────────┐  │
    │  │  <Dashboard>                            │  │
    │  │    ├─ <WebSocketStatus>                 │  │
    │  │    │    └─ Shows: "connected"           │  │
    │  │    ├─ <AlertsFeed>                      │  │
    │  │    │    ├─ Risk indicators              │  │
    │  │    │    ├─ Explanations                 │  │
    │  │    │    └─ Recommendations              │  │
    │  │    └─ <AlertNotification>               │  │
    │  │         └─ Toast for new alerts         │  │
    │  └─────────────────────────────────────────┘  │
    │                                                 │
    │  State Management: TanStack Query               │
    │  • Automatic cache invalidation                 │
    │  • Optimistic updates                           │
    │  • Background refetching                        │
    └────────────────┬───────────────────────────────┘
                     │
                     │  Display to User
                     │
                     ▼
            ┌────────────────┐
            │                │
            │   User sees    │
            │   real-time    │
            │   insights!    │
            │                │
            └────────────────┘


═══════════════════════════════════════════════════════════════════════════════
```

## Alternative Data Flow (Legacy Production Pipeline)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  PRODUCTION EVENT PIPELINE (Not used in current demo)                         │
└──────────────────────────────────────────────────────────────────────────────┘

    ┌─────────────────┐
    │  Simulator      │
    │  Lambda         │
    │  (EventBridge)  │
    └────────┬────────┘
             │
             │  PutRecords
             │
             ▼
    ┌────────────────────────┐
    │  Kinesis Data Stream   │
    │  iops-dashboard-events │
    └────────┬───────────────┘
             │
             │  Event Source Mapping
             │  Batch Size: 100
             │
             ▼
    ┌─────────────────────────┐
    │  Process Lambda (Python)│
    │  ├─ Parse events        │
    │  ├─ Aggregate metrics   │
    │  └─ Write to DynamoDB   │
    └────────┬────────────────┘
             │
             │  Trigger on patterns
             │  (anomalies, thresholds)
             │
             ▼
    ┌─────────────────────────┐
    │  AI Lambda (Python)     │
    │  ├─ Bedrock API call    │
    │  ├─ Claude 3.5 Haiku    │
    │  ├─ Generate insight    │
    │  └─ Write to DynamoDB   │
    └────────┬────────────────┘
             │
             │  PutEvents
             │
             ▼
    ┌─────────────────────────┐
    │  EventBridge            │
    │  iops-dashboard-alerts  │
    └────────┬────────────────┘
             │
             │  Rule: risk_score >= 80
             │
             ▼
    ┌─────────────────────────┐
    │  SNS Topic              │
    │  Critical Alerts        │
    │  └─ Email notifications │
    └─────────────────────────┘
```

## Simplified Flow Diagram

```
┌───────────┐
│   Test    │
│  Script   │
└─────┬─────┘
      │ BatchWrite
      ▼
┌───────────┐
│ DynamoDB  │◄────────┐
│  + GSI    │         │
└─────┬─────┘         │
      │ Query         │
      ▼               │
┌───────────┐         │
│  Lambda   │         │
│  (Query)  │         │
└─────┬─────┘         │
      │ JSON          │
      ▼               │
┌───────────┐         │
│    API    │         │
│  Gateway  │         │
└─────┬─────┘         │
      │ HTTPS         │
      ▼               │
┌───────────┐         │
│  React    │         │
│  Polling  │─────────┘
│  (5s)     │  Poll every 5s
└─────┬─────┘
      │
      ▼
┌───────────┐
│ Dashboard │
│    UI     │
└───────────┘
```

## Timing Diagram

```
Time (seconds)  Script      DynamoDB    Lambda    API GW     Frontend    User
──────────────────────────────────────────────────────────────────────────────

T = 0           START
                  │
T = 0.1         Write ──────►
                  │
T = 0.2         Write ──────►
                  │
T = 0.3         Write ──────►
                  │
                ...
                  │
T = 39          DONE
                              │
T = 40                        │
T = 41                        │
T = 42                        │
T = 43                        │
T = 44                        │
T = 45                        │         Poll ────►
                              │                     │
T = 45.1                      │                     │
                              │                   Query ──►
                              │                     │
T = 45.3                      │                     │         ◄── 200 OK
                              │                     │                 │
T = 45.4                      │                     │         JSON ───►
                              │                     │                 │
T = 45.5                      │                     │               Update ──►
                              │                     │                 │
T = 45.6                      │                     │               Display ──►
                              │                     │
T = 50                        │                   Poll ────►
T = 55                        │                   Poll ────►
T = 60                        │                   Poll ────►
                              │                     │
                             ...                   ...
```

## Data Transformation Flow

```
┌───────────────────────────────────────────────────────────────────┐
│  DATA TRANSFORMATION PIPELINE                                      │
└───────────────────────────────────────────────────────────────────┘

Input (Script):
┌─────────────────────────────────────────────────────────────┐
│ {                                                            │
│   entity_id: "alert_stream_42_event_5_12345"                │
│   entity_type: "insight"                                    │
│   related_entity: "ib_stream_42"                            │
│   timestamp: "2025-11-05T17:36:00Z"                         │
│   prediction_type: "performance_degradation"                │
│   risk_score: 85                                            │
│   explanation: "Stream 42: InfiniBand latency +45%..."      │
│   recommendations: ["Check switch", "Review topology"]      │
│   model_used: "claude-3-5-haiku"                            │
│   confidence: 0.92                                          │
│ }                                                            │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   │  BatchWriteItem
                   │
                   ▼
DynamoDB Storage:
┌─────────────────────────────────────────────────────────────┐
│ Primary Table:                                               │
│   PK: alert_stream_42_event_5_12345                         │
│   SK: insight                                               │
│   ...attributes...                                          │
│                                                              │
│ GSI (EntityTypeIndex):                                       │
│   PK: insight                                               │
│   SK: 2025-11-05T17:36:00Z                                  │
│   ...all attributes projected...                            │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   │  Query (GSI)
                   │
                   ▼
Lambda Transform:
┌─────────────────────────────────────────────────────────────┐
│ const insights = items.map(item => ({                       │
│   alert_id: item.entity_id,           // Rename            │
│   entity_id: item.related_entity,     // Use related       │
│   timestamp: item.timestamp,                               │
│   prediction_type: item.prediction_type,                   │
│   risk_score: item.risk_score,                             │
│   explanation: item.explanation,                           │
│   recommendations: item.recommendations,                   │
│   model_used: item.model_used,                             │
│   confidence: item.confidence                              │
│ }));                                                        │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   │  JSON Response
                   │
                   ▼
API Output:
┌─────────────────────────────────────────────────────────────┐
│ [                                                            │
│   {                                                          │
│     "alert_id": "alert_stream_42_event_5_12345",            │
│     "entity_id": "ib_stream_42",                            │
│     "timestamp": "2025-11-05T17:36:00Z",                    │
│     "prediction_type": "performance_degradation",           │
│     "risk_score": 85,                                       │
│     "explanation": "Stream 42: InfiniBand latency +45%...", │
│     "recommendations": [                                    │
│       "Check switch port utilization",                      │
│       "Review recent network topology changes"              │
│     ],                                                       │
│     "model_used": "claude-3-5-haiku",                       │
│     "confidence": 0.92                                      │
│   }                                                          │
│ ]                                                            │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   │  Frontend Parse
                   │
                   ▼
React State:
┌─────────────────────────────────────────────────────────────┐
│ const [lastData, setLastData] = useState<Insight[]>([])     │
│                                                              │
│ // TanStack Query cache                                     │
│ queryClient.setQueryData(['insights'], newData)             │
│                                                              │
│ // Trigger re-render                                        │
│ <AlertsFeed insights={lastData} />                          │
└─────────────────────────────────────────────────────────────┘
```

## Error Flow

```
┌───────────────────────────────────────────────────────────────────┐
│  ERROR HANDLING & RETRY FLOW                                       │
└───────────────────────────────────────────────────────────────────┘

Normal Flow:
  Frontend Poll ──► API Gateway ──► Lambda ──► DynamoDB ──► 200 OK
                                                                │
                                                                ▼
                                                            Display


Error Scenario 1 (Network):
  Frontend Poll ──X Network Error
       │
       │  usePolling catches error
       │  errorCount++
       │
       ▼
  Continue Polling (5s)
       │
       ▼
  Frontend Poll ──► API Gateway ──► ... ──► 200 OK
       │
       │  errorCount = 0
       ▼
  status = 'connected'


Error Scenario 2 (Lambda):
  Frontend Poll ──► API Gateway ──► Lambda ──X DynamoDB Error
                                       │
                                       │  Try/Catch
                                       │
                                       ▼
                                    500 Error
                                       │
                                       ▼
                              Frontend receives 500
                                       │
                                       │  errorCount++
                                       │  status = 'error' (after 3 failures)
                                       │
                                       ▼
                              Continue Polling (5s)
                                       │
                                       ▼
                              Auto-recovery when fixed


Error Scenario 3 (Throttling):
  Script BatchWrite ──► DynamoDB ──X ProvisionedThroughputExceeded
       │
       │  Script continues
       │  Small delay (100ms)
       │
       ▼
  Script BatchWrite ──► DynamoDB ──► Success
```

---

**Key Metrics:**
- **Script → DynamoDB**: 0.1s per batch (25 items)
- **DynamoDB Query**: 50-100ms
- **Lambda Execution**: 200-400ms
- **API Gateway**: 10-50ms overhead
- **Frontend Poll**: 5000ms interval
- **Total Latency**: 0-5 seconds (depends on poll timing)

**Last Updated**: November 5, 2025
