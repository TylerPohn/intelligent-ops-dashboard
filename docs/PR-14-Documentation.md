# PR-14: Documentation (Cost, Architecture, Prompts)

## Overview
Comprehensive documentation for architecture, cost analysis, and AI prompts.

## Files to Create

### 1. Architecture Diagram

**File:** `docs/architecture.md`

```markdown
# System Architecture

## Overview
```
┌─────────────┐
│   Varsity   │
│   Tutors    │──┐
│  Platform   │  │
└─────────────┘  │
                 │ POST /ingest
                 ▼
         ┌──────────────┐
         │ API Gateway  │
         └──────┬───────┘
                │
                ▼
         ┌──────────────┐
         │   Ingest     │
         │   Lambda     │
         └──────┬───────┘
                │
                ▼
         ┌──────────────┐
         │   Kinesis    │
         │   Stream     │
         └──────┬───────┘
                │
                ▼
         ┌──────────────┐
         │  Processing  │
         │   Lambda     │
         └──────┬───────┘
                │
       ┌────────┴────────┐
       ▼                 ▼
┌─────────────┐   ┌──────────────┐
│  DynamoDB   │   │ EventBridge  │
│  Metrics    │   │     Bus      │
└─────────────┘   └──────┬───────┘
                         │
                    ┌────┴─────┐
                    ▼          ▼
              ┌─────────┐  ┌─────────┐
              │   AI    │  │   SNS   │
              │ Lambda  │  │ Alerts  │
              └─────────┘  └─────────┘
                    │
                    ▼
              ┌─────────────┐
              │  DynamoDB   │
              │  Insights   │
              └─────────────┘
```

## Data Flow
1. External events → API Gateway
2. Validation → Kinesis
3. Aggregation → DynamoDB
4. Anomaly detection → EventBridge
5. AI analysis → Bedrock
6. Notifications → SNS → Email
7. Real-time updates → WebSocket → Dashboard
```

### 2. Cost Analysis

**File:** `docs/cost-analysis.md`

```markdown
# Cost Analysis

## Monthly Cost Breakdown (Estimated)

### Compute
- **Lambda (Ingest)**: 10M invocations × $0.20/1M = $2.00
- **Lambda (Processing)**: 5M invocations × $0.20/1M = $1.00
- **Lambda (AI)**: 100K invocations × $0.20/1M = $0.02
- **Lambda Compute**: ~$5.00

**Subtotal: ~$8.00/month**

### Storage
- **DynamoDB**: Pay-per-request, ~1M writes = $1.25
- **Kinesis**: 2 shards × $0.015/hour = $21.60

**Subtotal: ~$23/month**

### AI
- **Bedrock (Claude 3.5 Haiku)**: 100K requests × 300 tokens avg × $0.25/1M input = $7.50

**Subtotal: ~$8/month**

### Networking
- **API Gateway**: 10M requests × $1/1M = $10
- **SNS**: 1K emails × $2/100K = $0.02

**Subtotal: ~$10/month**

## Total Estimated Cost: ~$50/month

### Cost Optimization Strategies
1. Use on-demand DynamoDB (only pay for usage)
2. Reduce Kinesis shard count for lower volume
3. Batch AI requests
4. Use CloudWatch Insights to identify unused resources
```

### 3. AI Prompts Documentation

**File:** `docs/ai-prompts.md`

```markdown
# AI Prompt Templates

## Churn Risk Prediction

```
Analyze this student's behavior and predict churn risk:

Student ID: {student_id}
IB Calls (14 days): {ib_calls_14d}
Health Score: {health_score}
Sessions (7 days): {sessions_7d}

Provide a JSON response with:
1. "risk_score": A number between 0-100
2. "explanation": Clear explanation of risk factors
3. "recommendations": Array of 2-3 specific actions
```

## Response Format
```json
{
  "risk_score": 85,
  "explanation": "Student shows declining engagement...",
  "recommendations": [
    "Schedule immediate check-in call",
    "Review recent session feedback"
  ]
}
```
```

## Estimated Time: 30 minutes
