# IOPS Dashboard

Real-time InfiniBand Operations Monitoring Dashboard with AI-powered insights and predictive analytics.

## What This Does (Plain English)

This dashboard monitors InfiniBand network switches as a POC (high-speed data center networking) and uses machine learning to predict problems before they cause outages. It will soon be adapted to tutoring data. 

**How it works:**
1. Your InfiniBand switches send telemetry data (speed, errors, latency) to our API
2. AWS SageMaker ML models analyze the data using 25 different performance indicators
3. The system predicts risk scores (0-100) and generates actionable recommendations
4. If risk is high (≥80), you get an email alert immediately
5. Everything shows up in a real-time web dashboard that updates every 5 seconds

**What you see:**
- Live alerts with color-coded severity (green/yellow/red)
- AI-generated explanations of what's wrong
- Specific recommendations to fix issues
- Which ML model made the prediction (SageMaker XGBoost or Claude AI)
- Confidence scores so you know how sure the AI is

**Why this matters:**
- Catch performance problems before users notice
- Get intelligent explanations, not just raw numbers
- Reduce downtime with predictive maintenance
- No need to manually monitor hundreds of metrics

## Features

- 🔥 **Real-time Monitoring**: HTTP polling-based updates every 5 seconds
- 🤖 **AI-Powered Insights**: AWS SageMaker XGBoost ML models with Bedrock Claude fallback
- 📊 **Multi-Stream Support**: Handle 50+ concurrent InfiniBand data streams
- ⚡ **High Performance**: Lambda-based serverless architecture
- 🎨 **Modern UI**: React + Material-UI + TanStack Query
- 📈 **Risk Scoring**: Intelligent severity classification
- 💡 **Actionable Recommendations**: Context-aware remediation steps

## Quick Start

### Prerequisites

- Node.js 18+
- AWS CLI configured with credentials
- AWS CDK installed globally: `npm install -g aws-cdk`

### Installation

```bash
# Install dependencies
npm install
cd frontend && npm install
cd ../lambda/ingest && npm install
cd ../lambda/api && npm install
```

### Development

```bash
# Start frontend development server
npm run dev
# Opens at http://localhost:3002
```

### Generate Test Data

```bash
# Quick test (10 insights)
npm run generate:quick

# Default (30 insights)
npm run generate:insights

# Medium volume (50 insights)
npm run generate:medium

# Large volume (100 insights)
npm run generate:large
```

### Deploy to AWS

```bash
# Deploy all infrastructure
npm run deploy

# Deploy outputs will include:
# - API Gateway URLs
# - DynamoDB table name
# - Lambda function ARNs
```

## Architecture

```
InfiniBand Telemetry → API Gateway → Ingest Lambda → Kinesis Stream
                                                           ↓
                                                    Process Lambda
                                                           ↓
                                                       DynamoDB
                                                           ↓
Manual Scripts ────────────────────────────→ AI Lambda (SageMaker ML)
                                                           ↓
                                                    DynamoDB (insights)
                                                           ↓
                                                    EventBridge (risk ≥ 80)
                                                           ↓
                                                      SNS → Email

Dashboard ← API Gateway ← API Lambda ← DynamoDB
```

### Components

- **Frontend**: React + Vite + Material-UI
- **API**: API Gateway + Lambda (TypeScript)
- **Database**: DynamoDB with GSI for insights
- **ML Models**: AWS SageMaker XGBoost (iops-classifier-lite, iops-regressor-lite)
- **AI Fallback**: AWS Bedrock with Claude 3.5 Haiku
- **Streaming**: Kinesis Data Streams
- **Events**: EventBridge for alerts
- **Notifications**: SNS for critical alerts (risk ≥ 80)

## Project Structure

```
iops-dashboard/
├── frontend/              # React dashboard UI
│   ├── src/
│   │   ├── components/   # React components
│   │   ├── hooks/        # Custom hooks (usePolling)
│   │   ├── api/          # API client
│   │   └── theme.ts      # Material-UI theme
│   └── package.json
├── lambda/
│   ├── api/              # REST API Lambda
│   │   ├── get-insights.ts
│   │   └── package.json
│   ├── ingest/           # Data ingestion Lambda
│   ├── process/          # Processing Lambda (Python)
│   ├── ai/               # AI inference Lambda (Python)
│   └── simulator/        # Test data generator (Python)
├── cdk/                  # Infrastructure as Code
│   ├── lib/
│   │   ├── cdk-stack.ts         # Core infrastructure
│   │   └── experience-stack.ts  # WebSocket (legacy)
│   └── bin/cdk.ts
├── scripts/
│   ├── simple-generate.sh       # Simple ML insights generator
│   ├── generate-quick.sh        # 10 insights
│   ├── generate-medium.sh       # 50 insights
│   ├── generate-large.sh        # 100 insights
│   └── generate-test-events.sh  # High-volume test generator
├── docs/                 # Documentation
│   ├── POLLING-SOLUTION.md
│   ├── NPM-SCRIPTS.md
│   └── DEPLOYMENT-STATUS.md
└── package.json
```

## npm Scripts

### Development
- `npm run dev` - Start frontend dev server
- `npm run lint` - Run ESLint
- `npm run test` - Run tests

### Deployment
- `npm run deploy` - Deploy to AWS via CDK

### Test Data Generation
- `npm run generate:quick` - 10 insights (fast)
- `npm run generate:insights` - 30 insights (default)
- `npm run generate:medium` - 50 insights (moderate)
- `npm run generate:large` - 100 insights (comprehensive)

See [docs/NPM-SCRIPTS.md](docs/NPM-SCRIPTS.md) for full reference.

## API Endpoints

### REST API

**Base URL**: `https://<api-id>.execute-api.us-east-2.amazonaws.com/prod`

- `GET /insights/recent?limit=N` - Get recent insights (default: 50)
- `GET /insights/{id}` - Get specific insight by ID

### Response Format

```json
[
  {
    "alert_id": "alert_stream_1_event_1_12345",
    "entity_id": "ib_stream_1",
    "timestamp": "2025-11-05T17:36:00Z",
    "prediction_type": "performance_degradation",
    "risk_score": 85,
    "explanation": "InfiniBand call latency increased by 45%...",
    "recommendations": [
      "Check switch port utilization",
      "Review network topology changes"
    ],
    "model_used": "iops-classifier-lite",
    "confidence": 0.92
  }
]
```

## Dashboard Features

### Real-Time Updates
- HTTP polling every 5 seconds
- Automatic TanStack Query cache invalidation
- 0-5 second data latency

### Alerts Feed
- Color-coded risk severity
- Expandable details
- Actionable recommendations
- Stream identification
- Timestamp tracking

### Connection Status
- Visual indicator (connected/error/disconnected)
- Last update timestamp
- Automatic reconnection

## Performance

### Frontend
- Polling interval: 5 seconds
- Bundle size: ~500KB (gzipped)
- Time to interactive: <2s

### Backend
- Lambda cold start: ~1.5s
- Lambda warm response: 200-400ms
- DynamoDB query: <100ms
- End-to-end latency: 0-5s

### Scalability
- Concurrent streams: 50-200+
- Insights/second: 15-100
- DynamoDB throughput: On-demand (automatic scaling)

## Cost Estimates

### Per Month (24/7 operation)
- **Lambda**: ~$5 (17,280 invocations/day)
- **DynamoDB**: ~$5 (read/write operations)
- **API Gateway**: ~$3.50 (1M requests)
- **Bedrock (AI)**: Variable based on usage
- **Total**: ~$15-20/month for single dashboard

### Per Test Data Generation
- **Quick** (10 insights): ~$0.01 (SageMaker inference)
- **Default** (30 insights): ~$0.03
- **Medium** (50 insights): ~$0.05
- **Large** (100 insights): ~$0.10

## Configuration

### Environment Variables

Create `frontend/.env`:

```env
VITE_API_URL=https://<api-id>.execute-api.us-east-2.amazonaws.com/prod
VITE_AWS_REGION=us-east-2
```

### AWS Resources

- **Region**: us-east-2 (Ohio)
- **DynamoDB Table**: iops-dashboard-metrics
- **Kinesis Stream**: iops-dashboard-events
- **EventBridge Bus**: iops-dashboard-alerts
- **SageMaker Endpoints**:
  - iops-classifier-lite (XGBoost classification)
  - iops-regressor-lite (XGBoost regression)
- **SNS Topics**:
  - iops-dashboard-critical-alerts (risk ≥ 80)
  - iops-dashboard-warning-alerts
  - iops-dashboard-info-alerts

## Monitoring

### CloudWatch Logs

```bash
# API Lambda
aws logs tail /aws/lambda/IOpsDashboard-InsightsFunction --follow

# Process Lambda
aws logs tail /aws/lambda/IOpsDashboard-CoreStack-ProcessFunction* --follow

# AI Lambda
aws logs tail /aws/lambda/IOpsDashboard-CoreStack-AIFunction* --follow
```

### Metrics

```bash
# API requests
aws cloudwatch get-metric-statistics \
  --namespace AWS/ApiGateway \
  --metric-name Count \
  --dimensions Name=ApiId,Value=<api-id> \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum
```

## Troubleshooting

### Dashboard Not Updating

1. Check browser console for errors
2. Verify API endpoint is correct
3. Test API directly: `curl <API_URL>/insights/recent`
4. Check Lambda CloudWatch logs

### No Data in Dashboard

1. Generate test data: `npm run generate:quick`
2. Wait 5 seconds for polling
3. Check DynamoDB table has data
4. Verify GSI (EntityTypeIndex) exists

### Permission Errors

```bash
# Verify AWS credentials
aws sts get-caller-identity

# Check IAM permissions for:
# - DynamoDB read/write
# - Lambda invoke
# - API Gateway access
```

## Development

### ML Model Workflow

**Triple-Fallback Architecture:**
1. **Primary**: AWS SageMaker XGBoost models (25 engineered features)
2. **Fallback**: AWS Bedrock Claude 3.5 Haiku (if SageMaker fails)
3. **Last Resort**: Rules-based analysis (if both fail)

**SageMaker Models:**
- **Classifier** (`iops-classifier-lite`): Categorical risk (0, 1, 2, 3) → scaled to 0-100
- **Regressor** (`iops-regressor-lite`): Continuous risk score (currently unused)

**Feature Engineering:**
- Converts 8 raw IOPS metrics → 25 engineered features
- Features include: IOPS patterns, latency distribution, error trends, capacity utilization
- CSV format required for SageMaker XGBoost inference

### Adding New Prediction Types

1. Update `src/lambda/ai-analysis/handler.py` with new detection logic
2. Add to `scripts/generate-quick.sh` prediction types
3. Update risk score calculations
4. Add recommendations for the new type

### Modifying Dashboard

```bash
# Frontend changes with hot reload
npm run dev

# Test changes
npm run test

# Lint code
npm run lint
```

### Updating Infrastructure

```bash
# Modify CDK stacks in cdk/lib/
cd cdk

# Preview changes
npx cdk diff

# Deploy changes
npm run deploy
```

## Documentation

- **[NPM Scripts Reference](docs/NPM-SCRIPTS.md)** - All available npm commands
- **[Polling Solution](docs/POLLING-SOLUTION.md)** - Real-time updates architecture
- **[Deployment Status](docs/DEPLOYMENT-STATUS.md)** - Current deployment info
- **[Scripts README](scripts/README.md)** - Test data generation guide

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `npm run test`
5. Run linter: `npm run lint`
6. Submit a pull request

## License

ISC

## Support

For issues and questions:
- Check [docs/](docs/) directory
- Review CloudWatch logs
- Test with `npm run generate:quick`

## ML Insights Generation

The system uses AWS SageMaker for production ML inference:

```bash
# Generate ML insights using SageMaker
npm run generate:quick   # 10 real ML predictions

# Each insight includes:
# - 25-feature engineering from 8 raw metrics
# - SageMaker XGBoost classification
# - Risk score (0-100 scale)
# - Confidence score (0.95 for SageMaker)
# - Actionable recommendations
# - EventBridge alerts for risk ≥ 80
```

### ML Pipeline

1. **Input**: 8 raw IOPS metrics (IOPS, latency, error rate, throughput, queue depth, connections)
2. **Feature Engineering**: Transform to 25 features (handler.py:32-106)
3. **SageMaker Inference**: XGBoost classification via `iops-classifier-lite`
4. **Output**: Risk score, analysis, recommendations
5. **Storage**: Write to DynamoDB
6. **Alerting**: Trigger EventBridge/SNS if risk ≥ 80

---

**Last Updated**: November 6, 2025
**Version**: 1.0.0
**Region**: us-east-2 (Ohio)
