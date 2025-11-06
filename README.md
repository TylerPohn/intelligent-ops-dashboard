# IOPS Dashboard

Real-time InfiniBand Operations Monitoring Dashboard with AI-powered insights and predictive analytics.

## Features

- 🔥 **Real-time Monitoring**: HTTP polling-based updates every 5 seconds
- 🤖 **AI-Powered Insights**: Claude 3.5 Haiku for predictive analytics
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
# Quick test (50 insights from 10 streams)
npm run generate:quick

# Demo showcase (600 insights from 60 streams)
npm run generate:demo

# Large volume (2000 insights from 100 streams)
npm run generate:large

# Maximum scale (10,000 insights from 200 streams)
npm run generate:showcase
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
Kinesis Stream → Process Lambda → DynamoDB → API Gateway → Dashboard
                      ↓
                 AI Lambda (Claude)
                      ↓
                  Insights
```

### Components

- **Frontend**: React + Vite + Material-UI
- **API**: API Gateway + Lambda (TypeScript)
- **Database**: DynamoDB with GSI for insights
- **AI**: AWS Bedrock with Claude 3.5 Haiku
- **Streaming**: Kinesis Data Streams
- **Events**: EventBridge for alerts
- **Notifications**: SNS for critical alerts

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
│   ├── generate-test-events.sh  # High-volume test generator
│   └── README.md
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
- `npm run generate:quick` - 50 insights (fast)
- `npm run generate:demo` - 600 insights (showcase)
- `npm run generate:large` - 2000 insights (load test)
- `npm run generate:showcase` - 10,000 insights (maximum scale)

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
    "model_used": "claude-3-5-haiku",
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
- **Quick** (50 insights): $0.000063
- **Demo** (600 insights): $0.00075
- **Large** (2,000 insights): $0.0025
- **Showcase** (10,000 insights): $0.0125

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

### Adding New Prediction Types

1. Update `lambda/ai/handler.py` with new detection logic
2. Add to `scripts/generate-test-events.sh` prediction types
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

---

**Last Updated**: November 5, 2025
**Version**: 1.0.0
**Region**: us-east-2 (Ohio)
