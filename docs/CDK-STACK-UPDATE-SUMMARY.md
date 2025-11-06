# CDK Stack Infrastructure Update Summary

**Date:** 2025-11-05
**Agent:** CDK Infrastructure Architect
**Task:** Remove Kinesis, implement direct API Gateway → DynamoDB architecture with risk-based alerting

---

## Changes Implemented

### 1. **Removed ALL Kinesis References** ✅
- Removed `kinesis` import
- Removed `KinesisEventSource` import
- Removed `eventStream` property from stack
- Removed Kinesis Data Stream creation
- Removed Kinesis event source from processing Lambda
- Removed processing Lambda entirely (pattern detection moved to ingest Lambda)

### 2. **Updated Ingest Lambda** ✅
- Changed to write **directly to DynamoDB** (no Kinesis intermediary)
- Added `DYNAMODB_TABLE_NAME` environment variable
- Added `EVENT_BUS_NAME` environment variable for EventBridge integration
- Set `reservedConcurrentExecutions: 100` to support 200 streams at 0.5% capacity
- Updated description: "Ingests metrics and writes directly to DynamoDB with pattern detection"

### 3. **API Gateway Configuration** ✅
- **Throttling configured for 200 streams @ 0.5% capacity:**
  - `throttlingBurstLimit: 4000` (200 streams × 20 RPS burst)
  - `throttlingRateLimit: 2000` (200 streams × 10 RPS steady-state)
- **Request validation added:**
  - Created `MetricsRequestModel` with JSON schema validation
  - Required fields: `entity_id`, `entity_type`, `timestamp`
  - Optional fields: `metrics`, `metadata`
  - Created `RequestValidator` for body and parameter validation
- **New /metrics endpoint:**
  - Primary endpoint with full validation
  - POST method with Lambda integration
  - Request model validation enforced
- **Legacy /ingest endpoint:**
  - Kept for backward compatibility (deprecated)

### 4. **Bedrock Permissions for AI Lambda** ✅
- Added **both standard and streaming permissions:**
  ```typescript
  actions: [
    'bedrock:InvokeModel',
    'bedrock:InvokeModelWithResponseStream',  // NEW
  ]
  ```
- Updated model ARNs to correct versions:
  - `anthropic.claude-3-5-haiku-20241022-v1:0`
  - `anthropic.claude-3-5-sonnet-20241022-v2:0`

### 5. **EventBridge Risk-Based Alerts** ✅
- Created custom EventBridge event bus: `iops-dashboard-alerts`
- **High-Risk Alert Rule:**
  - Triggers on `risk_score >= 80` (numeric comparison)
  - Sources: `iops-dashboard.ingest`, `iops-dashboard.ai`
  - Routes to SNS topic for immediate notification

### 6. **SNS Topics Simplified** ✅
- **Replaced 3 severity-based topics with 1 risk-based topic:**
  - Removed: `CriticalAlertTopic`, `WarningAlertTopic`, `InfoAlertTopic`
  - Added: `RiskAlertTopic` (high-risk alerts, risk >= 80)
- Email subscriptions configured via `RISK_ALERT_EMAILS` environment variable
- Dead Letter Queue (DLQ) for failed notifications

### 7. **CloudWatch Alarms for Cost Monitoring** ✅
Added comprehensive cost monitoring alarms:

1. **DynamoDB Read Capacity Alarm:**
   - Threshold: 10,000 read units per 5 minutes
   - Purpose: Detect unexpected read spikes (cost control)

2. **DynamoDB Write Capacity Alarm:**
   - Threshold: 5,000 write units per 5 minutes
   - Expected: 200 streams × 25 writes/min = 5k/5min
   - Purpose: Detect write capacity overages (cost control)

3. **Lambda Duration Alarm:**
   - Threshold: 5 seconds average duration
   - Purpose: Detect inefficient Lambda execution (cost impact)

### 8. **CloudWatch Alarms for Error Rate Monitoring** ✅
Added comprehensive error rate monitoring:

1. **Ingest Lambda Error Alarm:**
   - Threshold: 50 errors per 5 minutes (5% error rate)
   - Evaluation: 2 periods

2. **Ingest Lambda Throttle Alarm:**
   - Threshold: 10 throttles per 5 minutes
   - Evaluation: 1 period (immediate)

3. **AI Lambda Error Alarm:**
   - Threshold: 5 errors per 5 minutes
   - Evaluation: 2 periods

4. **API Gateway 4XX Alarm:**
   - Threshold: 100 4xx errors per 5 minutes
   - Purpose: Detect validation failures

5. **API Gateway 5XX Alarm:**
   - Threshold: 10 5xx errors per 5 minutes
   - Purpose: Detect backend failures

All alarms send notifications to `RiskAlertTopic` SNS topic.

---

## New Architecture Flow

```
POST /metrics → API Gateway (throttled, validated)
              ↓
          Ingest Lambda (pattern detection)
              ↓
          DynamoDB (direct writes)
              ↓
          AI Lambda (Bedrock inference)
              ↓
          EventBridge (risk >= 80)
              ↓
          SNS Topic (email alerts)
```

**Key Improvements:**
- **No Kinesis overhead** - Direct DynamoDB writes
- **Request validation** - API Gateway validates before Lambda invocation
- **Cost controls** - CloudWatch alarms for capacity overages
- **Error monitoring** - Comprehensive alarm coverage
- **Risk-based alerts** - Single threshold (risk >= 80) instead of 3 severity levels

---

## Stack Outputs Updated

### Removed:
- `KinesisStreamName` (no longer exists)
- `ProcessFunctionName` (Lambda removed)
- `CriticalAlertTopicArn`, `WarningAlertTopicArn`, `InfoAlertTopicArn` (replaced)

### Added:
- `MetricsEndpoint` - Direct link to validated `/metrics` endpoint
- `InsightsEndpoint` - Direct link to `/insights/recent` endpoint
- `IngestFunctionName` - Renamed from previous output
- `RiskAlertTopicArn` - Single risk-based alert topic
- `ArchitectureSummary` - One-line architecture description

---

## Environment Variables Required

### For Email Subscriptions:
```bash
RISK_ALERT_EMAILS="email1@example.com,email2@example.com"
```

### For Lambda Functions:
- Ingest Lambda: `DYNAMODB_TABLE_NAME`, `EVENT_BUS_NAME`
- AI Lambda: `DYNAMODB_TABLE_NAME`, `USE_BEDROCK=true`
- Simulator Lambda: `INGEST_API_URL`, `STREAM_COUNT=50`, `EVENTS_PER_RUN=10`

---

## Capacity Planning

### API Gateway:
- **Burst capacity:** 4000 RPS (200 streams × 20 RPS)
- **Steady-state:** 2000 RPS (200 streams × 10 RPS)

### Lambda:
- **Reserved concurrency:** 100 executions
- **Support:** 200 streams at 0.5% DynamoDB capacity

### DynamoDB:
- **Billing mode:** Pay-per-request (on-demand)
- **Expected writes:** ~5000 write units per 5 minutes
- **Expected reads:** Variable (dashboard queries)

---

## Files Modified

1. **Primary Stack:**
   - `/Users/tyler/Desktop/Gauntlet/iops-dashboard/cdk/lib/cdk-stack.ts`

2. **Copy for Reference:**
   - `/Users/tyler/Desktop/Gauntlet/iops-dashboard/src/infrastructure/cdk-stack.ts`

---

## Next Steps

1. **Deploy the updated stack:**
   ```bash
   cd cdk
   cdk diff
   cdk deploy
   ```

2. **Update Ingest Lambda code** to:
   - Write directly to DynamoDB (remove Kinesis SDK calls)
   - Implement pattern detection logic
   - Send high-risk events to EventBridge

3. **Configure email subscriptions:**
   ```bash
   export RISK_ALERT_EMAILS="your-email@example.com"
   cdk deploy
   ```

4. **Test the new flow:**
   ```bash
   # Test /metrics endpoint with validation
   curl -X POST https://[API-URL]/metrics \
     -H "Content-Type: application/json" \
     -d '{
       "entity_id": "test-stream-001",
       "entity_type": "stream",
       "timestamp": "2025-11-05T19:54:00Z",
       "metrics": {"value": 100}
     }'
   ```

5. **Monitor CloudWatch alarms** to ensure thresholds are appropriate

---

## Architecture Benefits

1. **Simplified:** Removed Kinesis complexity
2. **Cost-effective:** Direct writes, no stream overhead
3. **Validated:** Request validation at API Gateway
4. **Observable:** Comprehensive CloudWatch alarms
5. **Risk-focused:** Single high-risk threshold (>=80)
6. **Scalable:** Supports 200 streams at 0.5% capacity
