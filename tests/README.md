# IOPS Dashboard Test Suite

Comprehensive testing suite with >90% coverage for the IOPS Dashboard project.

## 📁 Directory Structure

```
tests/
├── setup.ts                    # Global test configuration and AWS mocks
├── jest.config.js              # Jest configuration with coverage thresholds
├── fixtures/
│   └── test-events.ts          # Sample events and test data generators
├── helpers/
│   └── mock-generators.ts      # Utility functions for generating test data
├── unit/
│   ├── ai-lambda.test.ts       # AI/ML inference Lambda tests
│   ├── bedrock-client.test.ts  # Bedrock API client tests
│   ├── process-lambda.test.ts  # Kinesis processor Lambda tests
│   ├── rules-engine.test.ts    # Anomaly detection logic tests
│   └── ingest-lambda.test.ts   # API Gateway ingestion tests
├── integration/
│   ├── metric-flow.test.ts     # End-to-end metric flow tests
│   └── alert-flow.test.ts      # EventBridge → SNS integration tests
└── performance/
    ├── load-test.ts            # Load testing (200 streams, 600 insights)
    └── cost-validation.test.ts # Monthly cost validation (<$50)
```

## 🚀 Running Tests

### Run All Tests
```bash
npm test
```

### Run with Coverage
```bash
npm run test:coverage
```

### Run Specific Test Suites
```bash
# Unit tests only
npm test -- tests/unit

# Integration tests
npm test -- tests/integration

# Performance tests
npm test -- tests/performance

# Specific test file
npm test -- tests/unit/process-lambda.test.ts
```

### Run in Watch Mode
```bash
npm test -- --watch
```

### Run with Verbose Output
```bash
npm test -- --verbose
```

## 📊 Coverage Requirements

The test suite enforces the following coverage thresholds:

- **Statements**: 90%
- **Branches**: 85%
- **Functions**: 90%
- **Lines**: 90%

## 🧪 Test Categories

### Unit Tests

Test individual Lambda functions and components in isolation:

1. **process-lambda.test.ts** (Kinesis Stream Processor)
   - Kinesis record decoding
   - Metrics aggregation (sessions, IB calls, health scores)
   - Anomaly detection (high IB calls, low health, supply/demand)
   - EventBridge integration
   - Error handling and data type conversions

2. **rules-engine.test.ts** (Anomaly Detection Logic)
   - IOPS threshold detection (>= 3 IB calls in 14 days)
   - Latency threshold analysis (> 10ms)
   - Error rate threshold (> 1%)
   - Queue depth analysis (> 100)
   - Risk score calculation (0-100)
   - Health score classification (critical < 50, warning 50-69, normal >= 70)

3. **ingest-lambda.test.ts** (API Gateway Handler)
   - Request validation (body, event_type, payload)
   - Event enrichment (timestamp, metadata)
   - Kinesis integration
   - Response formatting (200/400/500)
   - Error handling and concurrent requests

4. **ai-lambda.test.ts** (AI/ML Inference)
   - Bedrock client initialization
   - Prompt generation for different alert types
   - Response parsing and validation
   - DynamoDB write operations
   - Exponential backoff retry logic

5. **bedrock-client.test.ts** (Bedrock API Client)
   - Retry logic (1s, 2s, 4s exponential backoff)
   - Max 3 retries enforcement
   - Throttling error handling
   - Timeout handling
   - Fallback to rules-based analysis

### Integration Tests

Test complete workflows end-to-end:

1. **metric-flow.test.ts** (Complete Data Pipeline)
   - API Gateway → Ingest Lambda → Kinesis → Process Lambda → DynamoDB
   - 600 diverse test insights processing
   - DynamoDB write verification
   - AI analysis trigger verification
   - <500ms latency per insight validation

2. **alert-flow.test.ts** (Alert Generation and Delivery)
   - EventBridge rule triggers (risk >= 80)
   - SNS email delivery
   - Alert content formatting
   - Different severity levels (critical, warning, info)
   - Alert deduplication
   - End-to-end flow validation

### Performance Tests

Validate performance and cost targets:

1. **load-test.ts** (Load and Scalability)
   - 200 concurrent streams simulation
   - 600 diverse test insights processing
   - DynamoDB capacity utilization (< 10%)
   - End-to-end latency (< 500ms per insight)
   - API Gateway throttling compliance
   - Memory and CPU usage tracking
   - Concurrent operations handling
   - Scalability validation (linear scaling)

2. **cost-validation.test.ts** (Monthly Budget Compliance)
   - Lambda costs (ingest, process, AI)
   - DynamoDB costs (writes, reads, storage)
   - Kinesis Data Streams costs
   - Bedrock AI costs (Claude 3.5 Haiku)
   - API Gateway, EventBridge, SNS costs
   - CloudWatch costs
   - **Total validation: < $50/month for 200 streams**
   - Cost per stream and per event analysis

## 🔧 Mocked AWS Services

All AWS SDK calls are mocked using `aws-sdk-client-mock`:

- DynamoDB (PutCommand, GetCommand, QueryCommand)
- Bedrock Runtime (InvokeModelCommand)
- EventBridge (PutEventsCommand)
- Kinesis (PutRecordCommand)
- SNS (PublishCommand)
- SageMaker Runtime (InvokeEndpointCommand)

## 📝 Test Data

### Fixtures (`fixtures/test-events.ts`)

Pre-defined test events:
- `validSessionStartedEvent`
- `validSessionCompletedEvent`
- `validIBCallEvent`
- `validHealthUpdateEvent`
- `validSupplyDemandEvent`
- `highRiskStudentMetrics`
- `normalStudentMetrics`

### Generators (`helpers/mock-generators.ts`)

Dynamic test data generation:
- `MockDataGenerator.generateStudentMetrics()`
- `MockDataGenerator.generateTutorMetrics()`
- `MockDataGenerator.generateSessionEvent()`
- `MockDataGenerator.generateIBCallEvent()`
- `MockDataGenerator.generateHealthUpdateEvent()`
- `MockDataGenerator.generateSupplyDemandEvent()`
- `MockDataGenerator.generateEventBatch(count)`

### Performance Tracking

`PerformanceTracker` utility for measuring operation timing:
```typescript
const tracker = new PerformanceTracker();
const end = tracker.start('operation-name');
// ... perform operation
end();
tracker.printStats();
```

## 🎯 Key Test Scenarios

### High-Risk Student Detection
Tests validate detection of students at risk of churning:
- Health score < 50 (critical)
- Health score 50-69 (warning)
- IB calls >= 3 in 14 days
- Declining session frequency

### Supply/Demand Imbalance
Tests validate detection of tutor shortages:
- Demand > Supply * 1.5 (high demand)
- Supply > Demand * 1.5 (high supply)

### Performance Targets
- **Throughput**: 200 events/second
- **Latency**: < 500ms per insight
- **DynamoDB**: < 10% capacity utilization
- **Cost**: < $50/month for 200 streams

## 🐛 Debugging Tests

### View Test Output
```bash
npm test -- --verbose --no-coverage
```

### Run Single Test
```bash
npm test -- -t "should detect high IB call frequency"
```

### Debug with Node Inspector
```bash
node --inspect-brk node_modules/.bin/jest --runInBand
```

## 📈 CI/CD Integration

Tests are designed to run in CI/CD pipelines:

```yaml
# Example GitHub Actions workflow
- name: Run Tests
  run: npm test -- --coverage --ci

- name: Upload Coverage
  uses: codecov/codecov-action@v3
  with:
    files: ./coverage/lcov.info
```

## 🔍 Coverage Reports

After running tests with coverage, view the HTML report:

```bash
open coverage/lcov-report/index.html
```

## 📊 Test Metrics

Expected test execution times:
- **Unit tests**: ~5-10 seconds
- **Integration tests**: ~10-15 seconds
- **Performance tests**: ~15-20 seconds
- **Total suite**: ~30-45 seconds

## 🚨 Troubleshooting

### Tests Timing Out
Increase Jest timeout in individual tests:
```typescript
jest.setTimeout(30000); // 30 seconds
```

### AWS SDK Mock Issues
Reset mocks between tests:
```typescript
beforeEach(() => {
  dynamoDBMock.reset();
  kinesisMock.reset();
});
```

### Memory Issues
Run with increased Node memory:
```bash
NODE_OPTIONS=--max-old-space-size=4096 npm test
```

## 📚 Resources

- [Jest Documentation](https://jestjs.io/)
- [AWS SDK Mock](https://github.com/m-radzikowski/aws-sdk-client-mock)
- [Testing Best Practices](https://testingjavascript.com/)

## ✅ Test Checklist

Before committing:
- [ ] All tests pass
- [ ] Coverage >= 90%
- [ ] No console errors
- [ ] Performance tests under targets
- [ ] Cost validation < $50/month

---

**Last Updated**: 2024-11-05
**Test Suite Version**: 1.0.0
**Maintained by**: Test Engineer Agent
