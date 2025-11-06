# What's Actually Deployed - IOPS Dashboard

**TL;DR**: Your backend infrastructure is fully deployed and running **24/7 on AWS**. The frontend is built but **NOT deployed** - it runs locally when you do `npm run dev`.

---

## 🌩️ **AWS Services - LIVE and Running** (us-east-2)

### **✅ CloudFormation Stacks (2)**
1. `IOpsDashboard-CoreStack` - Main infrastructure
2. `IOpsDashboard-ExperienceStack` - WebSocket API

### **✅ Lambda Functions (7 deployed, running 24/7)**

| Function | Runtime | Purpose | Size | Status |
|----------|---------|---------|------|--------|
| **IngestFunction** | Node.js 20.x | Receives HTTP POST, validates events, publishes to Kinesis | 2.9 KB | ✅ LIVE |
| **SimulatorFunction** | Python 3.12 | Generates synthetic test data (50 streams) | 6 MB | ✅ LIVE (disabled by default) |
| **ProcessFunction** | Python 3.12 | Reads Kinesis, aggregates metrics, detects anomalies | 64 MB | ✅ LIVE |
| **AIFunction** | Python 3.12 | Bedrock Claude 4.5 Haiku for churn predictions | 15 MB | ✅ LIVE |
| **ConnectFunction** | Node.js 20.x | WebSocket connect handler | 7.8 KB | ✅ LIVE |
| **DisconnectFunction** | Node.js 20.x | WebSocket disconnect handler | 7.8 KB | ✅ LIVE |
| **StreamProcessor** | Node.js 20.x | Broadcasts DynamoDB updates via WebSocket | 7.8 KB | ✅ LIVE |

**Current Status**:
- All Lambdas are deployed and ready to receive requests
- Simulator is **DISABLED** (not generating data automatically)
- Other Lambdas trigger on-demand when data arrives

### **✅ API Gateway (2 APIs)**

#### 1. REST API (for HTTP ingestion)
- **URL**: `https://dp41u4qn19.execute-api.us-east-2.amazonaws.com/prod/`
- **Endpoint**: `POST /ingest`
- **Status**: ✅ LIVE (accessible now)
- **Purpose**: Accept event data via HTTP POST

#### 2. WebSocket API (for real-time updates)
- **URL**: `wss://il7omaw929.execute-api.us-east-2.amazonaws.com/prod`
- **Status**: ✅ LIVE (connectable now)
- **Purpose**: Push real-time metric updates to frontend

### **✅ DynamoDB Tables (2)**

1. **iops-dashboard-metrics**
   - **Purpose**: Stores aggregated metrics (sessions, health scores, IB calls)
   - **Streams**: ✅ Enabled (triggers WebSocket updates)
   - **Billing**: On-demand (pay per request)

2. **iops-dashboard-websocket-connections**
   - **Purpose**: Tracks active WebSocket connections
   - **TTL**: 24 hours auto-cleanup

### **✅ Kinesis Stream (1)**

- **Name**: `iops-dashboard-events`
- **Shards**: 1 (can handle ~1,000 records/sec)
- **Retention**: 24 hours
- **Status**: ✅ LIVE (waiting for data)

### **✅ SNS Topics (3)**

1. `iops-dashboard-critical-alerts` - Health score < 50
2. `iops-dashboard-warning-alerts` - Health score 50-70
3. `iops-dashboard-info-alerts` - Supply/demand updates

**Status**: ✅ LIVE (awaiting email subscription confirmations)

### **✅ EventBridge**

- **Custom Bus**: `iops-dashboard-alerts`
- **Rules**: 3 (route alerts by severity to SNS)
- **Status**: ✅ LIVE

### **✅ SQS Dead Letter Queue**

- **Name**: `iops-dashboard-alert-dlq`
- **Retention**: 14 days
- **Purpose**: Catch failed SNS notifications

---

## 💻 **Frontend - NOT Deployed (Local Only)**

### **Current State**:
- ✅ **Built**: All React components created
- ✅ **Configured**: `.env` file points to AWS APIs
- ❌ **NOT on Vercel**: You need to deploy manually
- ❌ **NOT on CloudFront**: You need to set up S3 bucket
- ✅ **Works locally**: Run `npm run dev` to test

### **To Run Locally**:
```bash
cd frontend
npm install
npm run dev
# Visit http://localhost:5173
```

### **To Deploy to Vercel** (Optional):
```bash
cd frontend
npm install -g vercel
vercel login
vercel --prod
```

### **To Deploy to AWS S3 + CloudFront** (Optional):
```bash
cd frontend
npm run build  # Creates dist/ folder
aws s3 sync dist/ s3://your-bucket-name
# Then create CloudFront distribution pointing to S3
```

---

## 🐳 **Docker - NOT Running (Not Needed)**

### **Why No Docker Containers?**

Docker was **ONLY used during deployment** for:
1. Building Python Lambda packages (boto3, pandas, numpy, faker)
2. CDK bundling process
3. All done via temporary containers that auto-deleted

### **Current Docker Status**:
- ✅ Build complete (used temporary containers)
- ✅ Lambdas packaged and uploaded to AWS
- ❌ No persistent containers running
- ❌ No containers needed for operation

**The Lambdas run on AWS infrastructure, not Docker on your machine.**

---

## 💰 **What's Costing Money Right Now?**

| Service | Cost | Notes |
|---------|------|-------|
| **Lambda (idle)** | $0 | Only charged when invoked |
| **API Gateway** | $0 | Only charged per request |
| **DynamoDB** | ~$0.01/day | Minimal storage, no data yet |
| **Kinesis Stream** | ~$0.67/day | 1 shard, 24h retention ⚠️ |
| **SNS/SQS** | $0 | Only charged per message |
| **EventBridge** | $0 | Free tier covers usage |
| **CloudWatch Logs** | ~$0.02/day | Lambda execution logs |
| **TOTAL** | **~$0.70/day** | **$21/month** (without simulator) |

**Note**: The Kinesis stream is the main cost right now. If you're not using it, you can delete it to save $20/month.

---

## 🔄 **What's Actually Running?**

### **Active (Waiting for Requests)**:
1. ✅ API Gateway endpoints (REST + WebSocket)
2. ✅ Lambda functions (on-demand, cold start ready)
3. ✅ EventBridge rules (listening for alerts)
4. ✅ Kinesis stream (waiting for events)
5. ✅ DynamoDB tables (empty, ready for data)

### **Inactive (Need Manual Trigger)**:
1. ⏸️ Simulator Lambda (EventBridge rule disabled)
2. ⏸️ Frontend (not deployed, runs locally)
3. ⏸️ CI/CD pipeline (triggers on git push)

---

## 🧪 **How to Actually Use What's Deployed**

### **Option 1: Test with Simulator** (Generate Fake Data)
```bash
# Manually invoke once
aws lambda invoke \
  --function-name IOpsDashboard-CoreStack-SimulatorFunctionD42EF994-cd8453lSxE5r \
  --payload '{}' \
  response.json

# This will:
# 1. Generate 500 events (50 streams × 10 events)
# 2. POST them to API Gateway
# 3. Trigger the entire pipeline
# 4. Populate DynamoDB with metrics
```

### **Option 2: Send Real Data** (HTTP POST)
```bash
curl -X POST \
  https://dp41u4qn19.execute-api.us-east-2.amazonaws.com/prod/ingest \
  -H 'Content-Type: application/json' \
  -d '{
    "event_type": "session_completed",
    "student_id": "stu_123",
    "tutor_id": "tut_456",
    "session_id": "ses_789",
    "timestamp": "2025-11-04T21:00:00Z",
    "duration_minutes": 60,
    "subject": "Mathematics",
    "rating": 5
  }'
```

### **Option 3: Enable Auto-Generation** (500 events/min)
```bash
# Enable EventBridge rule to run simulator every minute
aws events enable-rule \
  --name IOpsDashboard-CoreStack-SimulatorSchedule288280E4-84dlBbwVVZbI

# Disable when done testing
aws events disable-rule \
  --name IOpsDashboard-CoreStack-SimulatorSchedule288280E4-84dlBbwVVZbI
```

---

## 📊 **How to Monitor What's Deployed**

### **Check if Data is Flowing**:
```bash
# Check Kinesis for events
aws kinesis get-records --shard-iterator $(aws kinesis get-shard-iterator --stream-name iops-dashboard-events --shard-id shardId-000000000000 --shard-iterator-type LATEST --query 'ShardIterator' --output text)

# Check DynamoDB for metrics
aws dynamodb scan --table-name iops-dashboard-metrics --max-items 5

# Check Lambda invocations
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Invocations \
  --dimensions Name=FunctionName,Value=IOpsDashboard-CoreStack-IngestFunction4B2F2EB2-brf37WGXJzgS \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum
```

---

## 🧹 **How to Delete Everything** (Stop Costs)

```bash
cd cdk
cdk destroy --all
```

This will delete:
- All Lambda functions
- All API Gateways
- All DynamoDB tables
- Kinesis stream
- SNS topics
- EventBridge rules
- CloudWatch logs (after retention period)

**Cost after deletion**: $0/month

---

## 📱 **Summary for Non-Technical Explanation**

**What's deployed:**
- Backend infrastructure on AWS (think of it as a server farm running 24/7)
- 7 serverless functions that wake up when needed
- 2 databases (one for metrics, one for WebSocket connections)
- 1 data stream (like a pipeline for events)
- 3 email notification channels
- 2 API endpoints (one for sending data, one for real-time updates)

**What's NOT deployed:**
- The frontend website (the visual dashboard)
- The simulator is off (not generating test data)
- No Docker containers on your computer

**Think of it like this:**
- You built a car factory (AWS infrastructure) ✅
- The assembly line is ready (Lambda functions) ✅
- But no cars are being built yet (no data flowing) ⏸️
- And the showroom isn't open (frontend not deployed) ❌

**To actually see it work:**
1. Send some test data (run the simulator)
2. Start the frontend locally (`npm run dev`)
3. Watch the dashboard update in real-time

---

**Current Monthly Cost**: ~$21 (mostly Kinesis stream sitting idle)
**Cost if you delete Kinesis**: ~$1 (just CloudWatch logs)
**Cost if you delete everything**: $0
