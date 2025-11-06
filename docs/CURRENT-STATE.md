# Current Project State - iOps Dashboard

**Last Updated:** 2025-11-04 14:25 PST

## ✅ Completed Components

### Infrastructure (CDK)
- **Core Stack** (`cdk/lib/cdk-stack.ts`)
  - ✅ Kinesis Data Stream for event ingestion
  - ✅ DynamoDB table for metrics storage
  - ✅ Lambda execution role with proper permissions
  - ✅ API Gateway for HTTP ingestion endpoint
  - ✅ EventBridge integration for alerts

### Lambda Functions

#### 1. Data Ingestion (`lambda/ingest/`)
- **Status:** ✅ Complete
- **Runtime:** Node.js 20.x (TypeScript)
- **Function:** Receives events via API Gateway, validates schema, publishes to Kinesis
- **Files:** `index.ts`, `package.json`, `tsconfig.json`, `dist/` (compiled)
- **Dependencies:** `@aws-sdk/client-kinesis` (89 packages installed)
- **Validation:** 6 event types, schema validation, error handling
- **Built:** TypeScript compiled to JavaScript in `dist/` directory

#### 2. Synthetic Data Simulator (`lambda/simulator/`)
- **Status:** ✅ Complete
- **Runtime:** Python 3.12
- **Function:** Generates realistic test data for 6 event types
- **Files:** `handler.py`, `requirements.txt`
- **Dependencies:** CDK auto-bundled (requests, faker)
- **Schedule:** EventBridge (disabled by default)

#### 3. Processing Lambda (`lambda/process/`)
- **Status:** ✅ Complete
- **Runtime:** Python 3.12
- **Function:** Processes Kinesis stream, aggregates metrics, detects anomalies
- **Files:** `handler.py`, `requirements.txt`
- **Dependencies:** CDK auto-bundled (boto3, pandas, numpy)
- **Trigger:** Kinesis stream (batch size: 100)

#### 4. AI Inference Lambda (`lambda/ai/`)
- **Status:** ✅ Complete
- **Runtime:** Python 3.12
- **Function:** AWS Bedrock Claude 4.5 Haiku for churn prediction and insights
- **Files:** `handler.py`, `requirements.txt`
- **Dependencies:** CDK auto-bundled (boto3, requests)
- **Bedrock Model:** `anthropic.claude-3-5-haiku-20241022:0`
- **Fallback:** OpenAI GPT-4 (optional)

### Lambda Dependency Management
- ✅ **CDK Auto-Bundling Configured:** All Python Lambdas use Docker-based bundling
- ✅ **Lambda Directories Clean:** Only `handler.py` + `requirements.txt` committed
- ✅ **`.gitignore` Updated:** Excludes all package directories
- ✅ **Documentation Created:** `docs/Lambda-Dependency-Management.md`

### Documentation
- ✅ PR-01: Core Infrastructure
- ✅ PR-02: Data Ingestion Lambda
- ✅ PR-03: Synthetic Data Generator (updated with dependency warnings)
- ✅ PR-04: Processing Lambda (updated with dependency warnings)
- ✅ PR-05: AI Inference Lambda (updated with dependency warnings)
- ✅ PR-06: Bedrock Config & IAM
- ✅ PR-07: EventBridge & SNS Alerts
- ✅ PR-08: DynamoDB Schema
- ✅ PR-09: Frontend UI (React + TanStack Query)
- ✅ PR-10: Frontend WebSocket Updates
- ✅ PR-11: Alerts Feed UI Component
- ✅ PR-13: CI/CD Pipeline
- ✅ AWS Credentials Setup Guide
- ✅ Lambda Dependency Management Guide

## 🚧 Pending/In-Progress

### Lambda Functions
- ⏳ **Alert Lambda** (`lambda/alert/`) - Empty directory (planned for PR-07: EventBridge + SNS)
  - Purpose: Format alerts for SNS email notifications
  - Language: TypeScript
  - Dependencies: TBD in PR-07
- ⏳ **WebSocket Lambda** (`lambda/websocket/`) - Not yet implemented (see PR-10)
  - Purpose: Real-time updates to frontend
  - Language: TBD in PR-10

### Frontend
- ⏳ **WebSocket Integration** - Per PR-10 documentation
- ⏳ **Alerts Feed Component** - Per PR-11 documentation

## 📁 Directory Structure

```
iops-dashboard/
├── cdk/
│   ├── bin/cdk.ts                    ✅ CDK app entry point
│   └── lib/cdk-stack.ts             ✅ Main stack with all resources
├── lambda/
│   ├── ai/
│   │   ├── handler.py               ✅ AI inference code
│   │   └── requirements.txt         ✅ boto3, requests
│   ├── alert/                       ⏳ Empty (for PR-07)
│   ├── ingest/
│   │   ├── index.ts                 ✅ TypeScript source
│   │   ├── package.json             ✅ npm config
│   │   ├── tsconfig.json            ✅ TS config
│   │   ├── dist/                    ✅ Compiled JavaScript
│   │   └── node_modules/            ✅ 89 packages
│   ├── process/
│   │   ├── handler.py               ✅ Stream processor
│   │   └── requirements.txt         ✅ boto3, pandas, numpy
│   └── simulator/
│       ├── handler.py               ✅ Data generator
│       └── requirements.txt         ✅ requests, faker
├── frontend/                        ✅ React + Vite + TanStack Query
├── docs/
│   ├── PR-*.md                      ✅ Implementation guides
│   ├── AWS-credentials.md           ✅ Setup instructions
│   ├── Lambda-Dependency-Management.md  ✅ Best practices
│   └── CURRENT-STATE.md             ✅ This file
└── .gitignore                       ✅ Updated with Lambda patterns
```

## ⚠️ Important Notes

### Lambda Dependencies
**CRITICAL - DO NOT:**
- ❌ Run `pip install -r requirements.txt -t .` in Lambda directories
- ❌ Commit package directories (boto3/, numpy/, pandas/, etc.)
- ❌ Install packages directly into Lambda folders

**ALWAYS:**
- ✅ Let CDK handle dependency bundling via Docker
- ✅ Keep Lambda directories clean (only code + requirements.txt)
- ✅ Use virtual environments for local testing
- ✅ Refer to `docs/Lambda-Dependency-Management.md`

### AWS Credentials
- Required before running any CDK or AWS CLI commands
- See `docs/AWS-credentials.md` for setup instructions

### Bedrock Access
- AI Lambda requires Bedrock model access in AWS account
- Model: `anthropic.claude-3-5-haiku-20241022:0`
- Fallback to OpenAI GPT-4 available (set `USE_BEDROCK=false`)

## 🔄 Event Flow

```
1. Simulator Lambda
   └─> Generates synthetic events every minute (when enabled)
       └─> Posts to API Gateway

2. Ingestion Lambda
   └─> Receives HTTP POST
       └─> Publishes to Kinesis Stream

3. Processing Lambda
   └─> Triggered by Kinesis batches (100 events)
       └─> Aggregates metrics in DynamoDB
           └─> Detects anomalies
               └─> Sends alerts to EventBridge

4. AI Inference Lambda
   └─> Triggered by EventBridge alerts
       └─> Calls Bedrock Claude for analysis
           └─> Stores insights in DynamoDB
```

## 📊 Deployment Status

### CDK Stacks
- **CdkStack:** ✅ Deployed (all resources)

### Lambda Functions Deployed
1. ✅ IngestFunction
2. ✅ SimulatorFunction
3. ✅ ProcessFunction
4. ✅ AIFunction

### Resources Created
- ✅ Kinesis Stream: `iops-dashboard-events`
- ✅ DynamoDB Table: `iops-dashboard-metrics`
- ✅ API Gateway: `IOpsDashboard-IngestApi`
- ✅ EventBridge: Default bus (custom bus in PR-07)
- ✅ IAM Role: Lambda execution role with Bedrock permissions

## 🎯 Next Steps

1. **Testing:**
   - Manually invoke simulator to generate test data
   - Verify processing pipeline end-to-end
   - Test AI inference with sample alerts

2. **Frontend Integration:**
   - Implement WebSocket handlers (PR-10)
   - Build Alerts Feed component (PR-11)
   - Connect to backend APIs

3. **Production Readiness:**
   - Set up CI/CD pipeline (PR-13)
   - Add monitoring and alarms
   - Configure Secrets Manager for API keys
   - Enable Bedrock model access

## 📞 Support

- **AWS Setup:** See `docs/AWS-credentials.md`
- **Lambda Dependencies:** See `docs/Lambda-Dependency-Management.md`
- **Implementation Guides:** See `docs/PR-*.md`

---

**Project Status:** 🟢 Core infrastructure complete, testing and frontend integration in progress
