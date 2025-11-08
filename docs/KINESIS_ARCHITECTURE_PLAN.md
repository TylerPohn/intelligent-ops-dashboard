# Kinesis Event-Driven Architecture Plan

## Executive Summary

This document outlines a comprehensive plan to integrate AWS Kinesis into the IOPs Dashboard for event-driven architecture, burst handling, and improved data quality monitoring through malformed data detection.

## Current Architecture Analysis

### Existing Flow
```
API Gateway → Ingest Lambda → DynamoDB → AI Lambda → EventBridge → SNS
                                  ↓
                           DynamoDB Streams → WebSocket Stream Processor → WebSocket API
```

### Pain Points Addressed
1. **Burst Handling**: Current Lambda has 100 reserved concurrency, can't scale well for spikes
2. **No Stream Buffer**: Direct API → Lambda → DynamoDB has no buffering for traffic bursts
3. **Limited Data Validation**: No centralized validation before DynamoDB writes
4. **No Malformed Data Tracking**: Invalid data errors are lost in logs

## Proposed Kinesis Architecture

### High-Level Flow
```
API Gateway → Ingest Lambda → Kinesis Data Stream → Stream Processor Lambda → DynamoDB
                                      ↓                          ↓
                                   Firehose                  Validation
                                      ↓                          ↓
                                 S3 Archive            Malformed Data SNS
```

### Component Breakdown

#### 1. Kinesis Data Stream Configuration

**Stream Name**: `iops-dashboard-events-stream`

**Sharding Strategy**:
- **Initial Shards**: 2 shards (2 MB/s write, 4 MB/s read)
- **Partition Key**: `event_type` (distributes load across event types)
- **Scaling Policy**:
  - Auto-scale up when incoming write throughput > 80%
  - Auto-scale down when < 30% for 15+ minutes
  - Max shards: 10 (10 MB/s write capacity)

**Retention**: 24 hours (allows replay for debugging)

**Enhanced Fan-Out**: Enabled for dedicated 2 MB/s per consumer

#### 2. Data Flow Architecture

##### Ingestion Path
1. **API Gateway** receives event
2. **Ingest Lambda v2** (new version):
   - Basic validation (JSON structure, required fields)
   - Enrichment (timestamps, metadata)
   - Write to Kinesis stream
   - Return 202 Accepted immediately
   - **Benefits**: Fast response, no DynamoDB bottleneck

3. **Kinesis Stream** buffers events:
   - Handles burst traffic (1000s RPS → smoothed to Lambda capacity)
   - Provides replay capability
   - Enables multiple consumers

##### Processing Path (Consumer 1: Main Processing)

**Stream Processor Lambda**:
- **Trigger**: Kinesis stream with batch size 100, 5-second batching window
- **Function**:
  1. Validate event schema (JSON Schema validation)
  2. Apply business rules validation
  3. Transform data for DynamoDB format
  4. Batch write to DynamoDB (up to 25 items per BatchWriteItem)
  5. Handle partial batch failures with retry logic

- **Error Handling**:
  - Malformed events → Dead Letter Queue → SNS notification
  - Validation failures → Malformed Data SNS Topic
  - Transient errors → Automatic retry with exponential backoff
  - Permanent failures → Dead Letter Queue

##### Archival Path (Consumer 2: Data Lake)

**Kinesis Firehose**:
- **Source**: Kinesis Data Stream
- **Destination**: S3 bucket (`iops-dashboard-archive`)
- **Buffering**: 5 MB or 300 seconds
- **Format**: Parquet (compressed, columnar)
- **Partitioning**: `year/month/day/hour/`
- **Use Case**: Long-term analytics, compliance, audit trail

##### Malformed Data Detection

**Validation Lambda** (inline in Stream Processor):
```typescript
interface ValidationResult {
  isValid: boolean;
  errors: string[];
  severity: 'warning' | 'error' | 'critical';
}

function validateEvent(event: any): ValidationResult {
  const errors: string[] = [];

  // Schema validation
  if (!event.event_type || !VALID_EVENT_TYPES.includes(event.event_type)) {
    errors.push(`Invalid event_type: ${event.event_type}`);
  }

  // Required fields
  if (!event.timestamp) errors.push('Missing timestamp');
  if (!event.payload) errors.push('Missing payload');

  // Business rules
  if (event.metrics?.iops < 0) {
    errors.push('Negative IOPS value');
  }

  return {
    isValid: errors.length === 0,
    errors,
    severity: errors.length > 3 ? 'critical' : 'error'
  };
}
```

**SNS Topic for Malformed Data**: `iops-dashboard-malformed-events`
- Email subscription: `tylerpohn@gmail.com`
- Message format:
```json
{
  "timestamp": "2024-11-06T12:34:56Z",
  "event_type": "invalid_event",
  "errors": ["Missing required field: payload", "Invalid event_type"],
  "raw_event": "{ ... }",
  "severity": "error"
}
```

#### 3. Burst Handling Strategy

**How Kinesis Solves Burst Traffic**:

1. **Buffering**: Stream acts as shock absorber
   - API can handle 2000 RPS burst (API Gateway throttle limit)
   - Kinesis buffers up to 2 MB/s per shard
   - Lambda consumers process at sustainable rate (100-200 RPS)

2. **Auto-Scaling**:
   - Kinesis shards scale based on throughput
   - Lambda concurrency scales based on batch size and processing time
   - No more 503 errors during spikes

3. **Cost-Efficiency**:
   - Only pay for data throughput, not request count
   - Batch processing reduces Lambda invocations
   - Example: 10,000 events → 100 Lambda invocations (batch size 100)

**Capacity Planning**:
```
Scenario: 200 streams @ 20 RPS burst = 4000 RPS peak

Current Architecture:
- API Gateway: 2000 RPS limit (needs throttling)
- Lambda: 100 concurrency → ~500 RPS max → OVERLOAD

Kinesis Architecture:
- API Gateway: 4000 RPS (scale up throttle limit)
- Kinesis: 2 shards → 2 MB/s write (supports 4000 RPS for 512-byte events)
- Stream Processor Lambda: 50 concurrent executions
  - Each processes 100 events/batch
  - 2-second avg duration
  - Throughput: 50 * (100/2) = 2500 RPS sustained → SUCCESS

Auto-scale to 4 shards if sustained > 80% throughput
```

#### 4. DynamoDB Integration

**Stream Processor writes to DynamoDB**:
- Uses `BatchWriteItem` for efficiency (up to 25 items)
- Handles partial failures with retry logic
- Maintains DynamoDB Streams for WebSocket updates (unchanged)

**Table Structure** (unchanged):
- Partition Key: `entity_id`
- Sort Key: `entity_type`
- GSI: `EntityTypeIndex` for queries by type + timestamp

#### 5. Monitoring & Alerting

**CloudWatch Metrics**:
- `Kinesis.IncomingRecords` - Events/second ingestion rate
- `Kinesis.IncomingBytes` - Throughput monitoring
- `Kinesis.WriteProvisionedThroughputExceeded` - Scaling alerts
- `Kinesis.GetRecords.IteratorAgeMilliseconds` - Processing lag

**CloudWatch Alarms**:
1. **Stream Lag Alarm**: Iterator age > 60 seconds (consumer falling behind)
2. **Throughput Exceeded Alarm**: Write throughput > 80% for 5 minutes
3. **Malformed Data Rate Alarm**: > 5% of events malformed
4. **DLQ Alarm**: > 10 messages in Dead Letter Queue

**Dashboard Additions**:
- Kinesis throughput graphs
- Validation error rate chart
- Processing lag metrics
- Cost breakdown (Kinesis + Lambda + DynamoDB)

## Implementation Phases

### Phase 1: Kinesis Stream Setup (Week 1)
- [ ] Create Kinesis Data Stream with 2 shards
- [ ] Configure auto-scaling policies
- [ ] Set up Kinesis Firehose to S3
- [ ] Create S3 bucket with lifecycle policies

### Phase 2: Ingest Lambda v2 (Week 1-2)
- [ ] Modify Ingest Lambda to write to Kinesis
- [ ] Add basic validation layer
- [ ] Update API Gateway integration
- [ ] Deploy with feature flag (gradual rollout)

### Phase 3: Stream Processor Lambda (Week 2)
- [ ] Implement validation logic with JSON Schema
- [ ] Build batch DynamoDB write handler
- [ ] Add error handling and DLQ integration
- [ ] Create malformed data SNS topic

### Phase 4: Monitoring & Alerting (Week 3)
- [ ] Create CloudWatch alarms for Kinesis metrics
- [ ] Set up SNS subscriptions for malformed data
- [ ] Build CloudWatch dashboard
- [ ] Configure log aggregation

### Phase 5: Load Testing & Optimization (Week 3-4)
- [ ] Simulate burst traffic scenarios
- [ ] Tune batch sizes and concurrency
- [ ] Validate auto-scaling behavior
- [ ] Optimize costs based on actual usage

## Cost Analysis

**Current Architecture** (200 streams @ 10 RPS steady):
- API Gateway: $3.50/million requests → ~$5/month
- Lambda (Ingest): 500M invocations → ~$100/month
- DynamoDB: Pay-per-request → ~$50/month
- **Total**: ~$155/month

**Kinesis Architecture** (200 streams @ 10 RPS steady, 20 RPS burst):
- API Gateway: Same → ~$5/month
- Kinesis (2 shards): 2 * $0.015/hour * 730 hours → ~$22/month
- Kinesis PUT: 26M records * $0.014/million → ~$0.36/month
- Lambda (Ingest v2): 500M invocations → ~$100/month
- Lambda (Stream Processor): 5M invocations (batched) → ~$10/month
- Firehose: 26M records * $0.029/10k → ~$75/month
- S3 Storage: 100 GB * $0.023 → ~$2.30/month
- DynamoDB: Same → ~$50/month
- **Total**: ~$264.66/month

**Cost Increase**: ~$110/month (~70% increase)

**Benefits for Cost**:
- Handles 2x burst traffic without errors
- S3 archive for compliance/analytics
- 24-hour replay capability for debugging
- Malformed data tracking prevents bad data in DynamoDB
- Reduced Lambda invocations (batching)

**Cost Optimization Options**:
1. Use 1 shard initially ($11/month savings)
2. Reduce Firehose retention (compression, lifecycle policies)
3. Use S3 Intelligent-Tiering for archive
4. Implement reserved capacity for predictable traffic

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Kinesis shard hot partitioning | Medium | Use hash of entity_id + event_type for partition key |
| Increased latency | Low | Latency increase is ~500ms (acceptable for async ingestion) |
| Cost overrun | Medium | Set CloudWatch billing alarms at $300/month threshold |
| Data loss during migration | High | Run dual-write during migration, compare results |
| Stream processor errors | Medium | Implement DLQ, retry logic, and monitoring alerts |

## Migration Strategy

### Option 1: Gradual Rollout (Recommended)
1. Deploy Kinesis infrastructure alongside existing architecture
2. Add feature flag to Ingest Lambda
3. Route 10% of traffic to Kinesis path
4. Monitor metrics for 1 week
5. Increase to 50%, then 100%
6. Deprecate old path after 2 weeks

### Option 2: Big Bang
1. Deploy all Kinesis components
2. Update Ingest Lambda in single deployment
3. Monitor closely for 48 hours
4. **Risk**: Higher chance of issues impacting all traffic

**Recommendation**: Option 1 with dual-write validation

## Success Metrics

1. **Burst Handling**: Successfully handle 4000 RPS peak without errors
2. **Data Quality**: < 1% malformed data rate in production
3. **Latency**: 95th percentile end-to-end latency < 3 seconds
4. **Cost Efficiency**: < $300/month total infrastructure cost
5. **Reliability**: 99.9% uptime for ingestion pipeline

## Rollback Plan

1. Flip feature flag to route traffic back to direct DynamoDB path
2. Keep Kinesis stream running for 24 hours (replay if needed)
3. Analyze issues and fix before retry
4. Total rollback time: < 5 minutes

## Next Steps

1. **Approve Architecture**: Review and sign off on this plan
2. **Allocate Resources**: Assign engineers and timeline
3. **Create CDK Stack**: Implement Phase 1 infrastructure code
4. **Development Sprint**: Execute Phases 1-3
5. **Testing & Validation**: Load testing in staging environment
6. **Production Rollout**: Gradual migration with monitoring

## References

- [AWS Kinesis Best Practices](https://docs.aws.amazon.com/streams/latest/dev/best-practices.html)
- [Lambda + Kinesis Batch Processing](https://docs.aws.amazon.com/lambda/latest/dg/with-kinesis.html)
- [Kinesis Data Streams Auto Scaling](https://docs.aws.amazon.com/streams/latest/dev/scaling-kinesis-data-streams.html)
- [DynamoDB Batch Operations](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/WorkingWithItems.html#WorkingWithItems.BatchOperations)

---

**Document Version**: 1.0
**Last Updated**: 2024-11-06
**Author**: Claude Code + Tyler Pohn
**Status**: Pending Approval
