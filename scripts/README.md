# IOPS Dashboard - Test Event Generator Scripts

## Overview

Scripts to generate high-volume test data for showcasing the IOPS Dashboard's ability to handle 50+ concurrent InfiniBand data streams with real-time monitoring.

## Scripts

### `generate-test-events.sh`

High-volume test event generator that creates realistic InfiniBand monitoring insights.

**Features:**
- Simulates multiple concurrent data streams
- Generates realistic InfiniBand scenarios (performance degradation, anomalies, saturation, etc.)
- Uses DynamoDB BatchWriteItem for efficient bulk inserts
- Progress tracking and statistics
- Configurable volume and stream count

**Usage via npm scripts (recommended):**

```bash
# Default: 60 streams × 10 events = 600 total insights
npm run generate:test-data

# Demo/showcase: 60 streams × 10 events = 600 insights
npm run generate:demo

# Quick test: 10 streams × 5 events = 50 insights
npm run generate:quick

# Large volume: 100 streams × 20 events = 2000 insights
npm run generate:large

# Maximum showcase: 200 streams × 50 events = 10,000 insights
npm run generate:showcase
```

**Direct script usage:**

```bash
# Default: 60 streams × 10 events = 600 total insights
./scripts/generate-test-events.sh

# Custom: 100 streams × 20 events = 2000 total insights
./scripts/generate-test-events.sh 100 20

# Quick demo: 10 streams × 5 events = 50 total insights
./scripts/generate-test-events.sh 10 5

# Large showcase: 200 streams × 50 events = 10,000 total insights
./scripts/generate-test-events.sh 200 50
```

**Parameters:**
1. **NUM_STREAMS** (default: 60) - Number of concurrent InfiniBand data streams
2. **EVENTS_PER_STREAM** (default: 10) - Events per stream

**Output Example:**

```
🚀 IOPS Dashboard - High Volume Test Event Generator
==================================================
Target: 60 concurrent data streams
Events per stream: 10
Total events: 600
Region: us-east-2
Table: iops-dashboard-metrics

📝 Generating 600 test insights...

⏳ Progress: 600/600 events (100%)...

✅ Generation Complete!
======================
✓ Generated: 600 insights
✓ Streams: 60 concurrent
✓ Duration: 8s
✓ Rate: 75 events/sec

📊 Sample Insights (latest 5):
==============================
[Table showing recent insights]

🎯 Dashboard Polling:
====================
Your dashboard will automatically pick up these insights
within 5 seconds via HTTP polling.

🔗 API Endpoint:
https://dp41u4qn19.execute-api.us-east-2.amazonaws.com/prod/insights/recent?limit=100

🌐 Dashboard URL:
http://localhost:3002
```

## Generated Data Types

### Prediction Types (10 scenarios)

1. **performance_degradation** - Latency increases, network congestion
2. **anomaly_detected** - Unusual RDMA operation patterns
3. **resource_saturation** - HCA port utilization critical
4. **connection_instability** - Connection resets detected
5. **packet_loss_detected** - Link quality degraded
6. **latency_spike** - P99 latency increased significantly
7. **bandwidth_throttling** - Throughput reduction detected
8. **qp_error_rate_high** - Queue Pair errors elevated
9. **memory_registration_failure** - Memory registration issues
10. **rdma_timeout** - RDMA operations timing out

### Risk Scores

- **Critical (80-100)**: Resource saturation, RDMA timeouts
- **High (70-90)**: Performance degradation, connection instability
- **Medium (60-80)**: Latency spikes, QP errors
- **Low (50-70)**: Packet loss, bandwidth throttling
- **Info (40-70)**: Other anomalies

### Data Fields

Each insight includes:
- **alert_id**: Unique alert identifier
- **entity_id**: Related InfiniBand stream ID
- **timestamp**: Event timestamp (spread over last 5 minutes)
- **prediction_type**: Type of issue detected
- **risk_score**: Severity (0-100)
- **explanation**: Detailed description of the issue
- **recommendations**: Array of actionable recommendations
- **model_used**: AI model (claude-3-5-haiku)
- **confidence**: Confidence score (0.70-0.99)

## Use Cases

### Demo/Showcase
```bash
# Show 50+ concurrent streams
./scripts/generate-test-events.sh 60 10
```

### Load Testing
```bash
# Stress test with 10,000 insights
./scripts/generate-test-events.sh 200 50
```

### Quick Test
```bash
# Fast verification
./scripts/generate-test-events.sh 5 3
```

### Continuous Demo
```bash
# Generate fresh data every minute
while true; do
  ./scripts/generate-test-events.sh 20 5
  sleep 60
done
```

## Performance

### Batch Writing
- Uses DynamoDB `batch-write-item` (25 items per batch)
- Typical rate: 60-100 events/second
- 600 events: ~8-10 seconds
- 6,000 events: ~80-100 seconds

### Cost Estimate

**DynamoDB Write Units:**
- 600 events = 600 WCUs (one-time)
- At $1.25 per million WCUs = $0.00075
- Even 10,000 events = $0.0125

**Lambda Polling:**
- Dashboard polls `/insights/recent` every 5 seconds
- Minimal cost (~$0.10/day for 24/7 monitoring)

## Dashboard Integration

### Automatic Updates

The dashboard will automatically display generated insights via HTTP polling:

1. **Poll Interval**: Every 5 seconds
2. **Endpoint**: `GET /insights/recent?limit=100`
3. **Latency**: 0-5 seconds from generation to display
4. **UI Updates**: Automatic (no refresh needed)

### What You'll See

- **Alerts Feed**: Real-time list of insights
- **Risk Indicators**: Color-coded by severity
- **Recommendations**: Expandable action items
- **Stream ID**: Which InfiniBand stream affected
- **Timestamps**: When each event occurred

## Requirements

- **AWS CLI**: Configured with credentials
- **Region**: us-east-2 (Ohio)
- **Table**: iops-dashboard-metrics
- **Python 3**: For timestamp generation
- **Bash**: 4.0+ recommended

## Troubleshooting

### Script Not Executable
```bash
chmod +x scripts/generate-test-events.sh
```

### AWS Permission Errors
Ensure your AWS credentials have:
- `dynamodb:BatchWriteItem`
- `dynamodb:Query`
- Access to `iops-dashboard-metrics` table

### Rate Limiting
If you see throttling errors:
```bash
# Reduce concurrent streams
./scripts/generate-test-events.sh 30 10

# Or spread out over time
for i in {1..5}; do
  ./scripts/generate-test-events.sh 20 5
  sleep 30
done
```

### Python DateTime Warning
The deprecation warnings are harmless. To suppress:
```bash
./scripts/generate-test-events.sh 2>/dev/null
```

## Examples

### Realistic Production Simulation
```bash
# 50 streams, each with 15-20 events
./scripts/generate-test-events.sh 50 $((RANDOM % 6 + 15))
```

### Varying Severity Mix
```bash
# Multiple runs create diverse risk scores
./scripts/generate-test-events.sh 20 5
./scripts/generate-test-events.sh 20 5
./scripts/generate-test-events.sh 20 5
```

### Time-Spread Simulation
```bash
# Generate data over 10 minutes
for i in {1..10}; do
  ./scripts/generate-test-events.sh 10 3
  echo "Batch $i/10 complete, waiting..."
  sleep 60
done
```

## Script Features

### Realistic Data
- Random but logical risk scores per prediction type
- Contextual explanations mentioning specific metrics
- Relevant recommendations per issue type
- Timestamps spread over recent 5 minutes
- Stream IDs (ib_stream_1, ib_stream_2, etc.)

### Performance
- Batch writes (25 items at a time)
- Progress indicator with percentage
- Rate calculation (events/second)
- Minimal throttling with small delays

### Output
- Summary statistics
- Sample of latest insights
- Dashboard polling info
- API endpoint URL
- Usage examples for different volumes

## Architecture

### Data Flow
```
Script → DynamoDB → API Gateway → Lambda → Dashboard
         (write)    (poll)         (query)   (display)
```

### Batch Process
```
600 events → 24 batches (25 each) → ~8 seconds
          ↓
    DynamoDB BatchWriteItem
          ↓
    EntityTypeIndex (GSI)
          ↓
    Available for polling
```

---

**Last Updated**: November 5, 2025
**Region**: us-east-2 (Ohio)
**Table**: iops-dashboard-metrics
