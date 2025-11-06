# SageMaker Integration Tests

## Overview

This directory contains unit and integration tests for the SageMaker endpoint integration in the AI Analysis Lambda function.

## Test Coverage

### SageMaker Client Tests (`sagemaker-client.test.ts`)

**Endpoint Invocation:**
- Successful SageMaker endpoint calls with valid metrics
- Response validation and parsing
- Payload formatting for SageMaker API

**Error Handling:**
- `ModelNotReadyException` - Model endpoint not yet available
- `ValidationException` - Invalid payload format
- `ModelError` - Model inference errors
- `TimeoutError` - Endpoint timeout handling
- Empty or malformed responses

**Fallback Logic:**
- SageMaker → Bedrock fallback on errors
- Bedrock → Rules-based fallback on errors
- Direct Bedrock when `USE_SAGEMAKER=false`

**Configuration:**
- Environment variable validation
- Missing endpoint configuration handling

## Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test sagemaker-client.test.ts

# Run with coverage
npm test -- --coverage

# Watch mode for development
npm test -- --watch
```

## Test Implementation Status

Current tests are **STUBS** that demonstrate the testing strategy. To complete implementation:

1. **Import Lambda Handler**: Import the actual handler from `src/lambda/ai-analysis/index.ts`
2. **Create Mock Events**: Create proper test events matching `IOPSMetric[]` interface
3. **Complete Assertions**: Replace placeholder `expect(true).toBe(true)` with actual assertions
4. **Add Integration Tests**: Test the complete Lambda handler flow end-to-end
5. **Mock Additional Services**: Mock DynamoDB and EventBridge clients
6. **Test Coverage**: Ensure 80%+ code coverage for critical paths

## Test Data Examples

### Valid SageMaker Response
```typescript
{
  risk_score: 75,
  analysis: "High IOPS detected on node-1 with elevated latency",
  recommendations: [
    "Scale storage capacity",
    "Monitor network congestion",
    "Check queue depth settings"
  ]
}
```

### Valid Metric Input
```typescript
{
  timestamp: 1730835600000,
  nodeId: "node-1",
  iops: 85000,
  latency: 12.5,
  errorRate: 1.2,
  throughput: 2500,
  queueDepth: 56,
  activeConnections: 120
}
```

## Dependencies

Required testing libraries (add to package.json if missing):
```json
{
  "devDependencies": {
    "vitest": "^1.0.0",
    "aws-sdk-client-mock": "^3.0.0",
    "@types/jest": "^29.0.0"
  }
}
```

## CI/CD Integration

These tests should be run:
- On every pull request
- Before deployment
- As part of the CDK pipeline validation

## Coverage Goals

- **Unit Tests**: 90%+ coverage of SageMaker integration code
- **Integration Tests**: All critical paths tested
- **Error Scenarios**: All error types handled and tested
- **Fallback Logic**: Complete fallback chain tested
