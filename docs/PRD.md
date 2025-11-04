# 🧠 Intelligent Operations Dashboard — Product Requirements Document (PRD)

## Overview

**Project Goal:**  
Build a **real-time intelligent command center** that monitors marketplace health, predicts supply/demand imbalances, alerts operators to anomalies, and provides explainable AI insights.

The system must:
- Handle **50+ data streams** of tutoring-related operational events.
- Generate **predictive insights** (e.g. churn risk, tutor supply gaps) via LLM inference.
- Provide **real-time dashboards** for operators and product teams.
- Integrate **externally** with the existing Varsity Tutors / Nerdy Rails + React platform.
- Deploy to **AWS via CDK** in a single command.

---

## Guiding Principles

- **Prototype Fast → Deploy Clean**  
  Favor serverless and modular design; productionize later without rewrites.

- **Explainable Intelligence**  
  Every AI prediction includes a text explanation (reasoning).

- **Human-AI Collaboration**  
  Operators can confirm/dismiss alerts, feeding back into model performance.

- **Single Repo Simplicity**  
  One repo handles infra (CDK), logic (Lambdas), and UX (React).

---

## Project Structure

```
iops-dashboard/
├── frontend/          # React + Vite (TypeScript + TanStack Query v5)
│   ├── src/
│   ├── public/
│   └── vite.config.ts
│
├── cdk/               # AWS CDK app (TypeScript)
│   ├── bin/
│   ├── lib/
│   └── cdk.json
│
├── lambda/            # All backend Lambda functions
│   ├── ingest/
│   ├── process/
│   ├── ai/
│   ├── alert/
│   └── simulator/
│
├── docs/              # PRDs, architecture, AI prompt logs
└── .github/workflows/ # CI/CD (CDK + Vercel deploy)
```

---

## Frontend Specification

### Framework
- **Vite + React + TypeScript**
- **TanStack Query v5** (`@tanstack/react-query`)
- **Recharts** for analytics visualization
- **Axios** for API communication

### Key Components
- **Dashboard** (main view): Displays KPIs, charts, and live feed.
- **AlertsFeed**: Streams EventBridge / SNS messages in real time.
- **ExplainabilityPanel**: Expands AI reasoning per alert.
- **Settings / Auth Modal**: Accepts JWT or API key for company integration.

### Example Dependencies
```bash
npm install @tanstack/react-query @tanstack/react-query-devtools axios recharts
```

### Initialization Example
```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient();

root.render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>
);
```

---

## Architecture Summary

### CDK Stacks (3 Total)

1. **Core Stack**
   - Kinesis Data Stream (primary ingestion)
   - Lambda Processor (aggregation + transformation)
   - DynamoDB Table (state + metrics)
   - IAM Roles & Policies

2. **Intelligence Stack**
   - AI Inference Lambda (Bedrock/OpenAI)
   - EventBridge Bus (alert routing)
   - SNS Notifications (Email)
   - CloudWatch Alarms (throughput, latency)

3. **Experience Stack**
   - React dashboard (Vercel)
   - API Gateway (REST + WebSocket)
   - Real-time updates to dashboard clients

---

## Functional Requirements

### 1. Data Ingestion
- Accept inbound JSON events from external Rails system (Varsity Tutors) via:
  - API Gateway `/ingest` endpoint, or
  - Direct push to Kinesis.
- Validate schema and forward to stream.
- Support at least **50 concurrent simulated data feeds**.

### 2. Synthetic Data Generation (for Demo)
To support demo and development before live integration:

- A **Lambda-based simulator** will emit realistic Varsity Tutors–style events at configurable rates.
- Emits 50+ concurrent streams of data, covering:
  - `session_started`
  - `session_completed`
  - `ib_call_logged`
  - `tutor_availability_updated`
  - `customer_health_update`
  - `supply_demand_update`
- Rate and volume controlled via environment variables:
  ```
  STREAM_COUNT=50
  EVENT_RATE_PER_SEC=5
  ```
- Uses random but correlated IDs (students, tutors, subjects).

---

### 3. Data Processing
- Lambda consumer aggregates event data:
  - Sessions per 7/14/30 days
  - IB call frequency
  - First-session success rates
  - Session velocity trends
- Aggregated data written to DynamoDB and triggers EventBridge rules for anomalies.

---

### 4. AI Inference and Predictions
- AI Lambda calls **AWS Bedrock (Claude 4.5 Haiku)** or fallback **OpenAI GPT-4** to:
  - Predict churn risk.
  - Identify supply/demand imbalances.
  - Explain causes in plain English.

**Example Output:**
```json
{
  "event_type": "churn_risk_detected",
  "student_id": "stu_4532",
  "churn_risk": 0.82,
  "explanation": "2 IB calls in 14 days and declining session velocity."
}
```

---

### 5. Alerting System
- EventBridge triggers SNS → Email.
- Alerts include:
  - Alert type (churn, call spike, supply issue)
  - Severity (info/warn/critical)
  - AI explanation string
  - Link to dashboard

---

### 6. Integration with Varsity Tutors / Nerdy Platform

Because the company’s Rails/React stack is not accessible, integration occurs through **external interfaces**:

| Direction | Description |
|------------|--------------|
| **Inbound** | Varsity Tutors Rails backend can POST JSON events to `/ingest` API endpoint. |
| **Outbound** | This system exposes `/outbound/alerts` for posting AI results or anomalies back to Varsity endpoints if available. |
| **Frontend** | The React dashboard is embeddable via iframe or microfrontend in their platform. |
| **Security** | All traffic authenticated via JWT or API key; CORS restricted to Varsity domains. |

---

## AI Integration and Post-Swarm Deployment Tasks

| Area | Swarm Output |
|-------|---------------|
| AWS CDK | Full stack definitions and IAM policies |
| Lambdas | Ingest, simulate, process, AI inference, alert |
| React UI | Live dashboard with WebSocket hooks |
| CI/CD | GitHub Actions workflow |
| Docs | Architecture + cost analysis |

---

## What You’ll Do After Swarm Generation

| Task | Manual Step | Notes |
|------|--------------|-------|
| Deploy stacks | `npx cdk deploy --all` | 10–15 min setup |
| Configure Bedrock | Enable Bedrock API or use OpenAI fallback | Add env vars |
| Email alerts | Add webhook URLs / SNS emails | 5 min |
| Load testing | Adjust `STREAM_COUNT` and `EVENT_RATE_PER_SEC` | 10 min tuning |
| Vercel deploy | Set frontend env vars for API URLs | 5 min |

---

## Suggested Sharding Strategy (for Claude Code)

1. Core Infra (CDK)
2. Data Ingestion Lambda
3. Synthetic Data Generator
4. Processing Lambda
5. AI Inference Lambda
6. Bedrock Config / IAM Policies
7. EventBridge Rules + SNS Alerts
8. DynamoDB Schema
9. Frontend UI (React + TanStack Query v5)
10. Frontend Live WebSocket Updates
11. Alerts Feed UI
12. Email Integration
13. CI/CD Pipeline
14. Docs (Cost, Architecture, Prompts)
15. Integration Interfaces (Inbound/Outbound)
16. Testing Scripts + Demo Flow

---

## Notes for AI Swarm Execution

- Swarm should shard tasks per module (CDK, Lambdas, Frontend, AI).
- All modules use consistent schema and CDK exports.
- Use Bedrock calls only as mock until credentials provided.
- Prioritize functional event flow first:
  `data → inference → alert → dashboard`.

---

## Development Environment Notes

- **AWS CLI Access**: Direct AWS CLI access is available without SSO requirement. All AWS operations (S3, CloudFormation, CDK deploy, etc.) can be executed via command line with pre-configured credentials.

---

*End of PRD*
