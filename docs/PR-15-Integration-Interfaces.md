# PR-15: Integration Interfaces (Inbound/Outbound)

## Overview
Create API endpoints for bidirectional integration with Varsity Tutors platform.

## Inbound Integration (Already Covered)
- PR-02 created `/ingest` endpoint
- Accepts JSON events from external systems

## Outbound Integration

### 1. Create Outbound Lambda

**File:** `lambda/integration/outbound.ts`

```typescript
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import axios from 'axios';

const VARSITY_WEBHOOK_URL = process.env.VARSITY_WEBHOOK_URL!;

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const alert = JSON.parse(event.body || '{}');

  // Forward high-risk alerts back to Varsity Tutors
  if (alert.risk_score >= 80) {
    await axios.post(VARSITY_WEBHOOK_URL, {
      type: 'high_risk_alert',
      student_id: alert.entity_id,
      risk_score: alert.risk_score,
      explanation: alert.explanation,
      recommendations: alert.recommendations,
      timestamp: new Date().toISOString(),
    });
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'Alert forwarded' }),
  };
};
```

### 2. Add to Core Stack

```typescript
const outboundLambda = new lambda.Function(this, 'OutboundFunction', {
  runtime: lambda.Runtime.NODEJS_18_X,
  handler: 'index.handler',
  code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/integration/dist')),
  environment: {
    VARSITY_WEBHOOK_URL: process.env.VARSITY_WEBHOOK_URL || '',
  },
});

const outboundApi = api.root.addResource('outbound');
outboundApi.addMethod('POST', new apigateway.LambdaIntegration(outboundLambda));
```

## API Documentation

**File:** `docs/api-spec.md`

```markdown
# API Specification

## POST /ingest
Accepts events from external systems.

**Request:**
```json
{
  "event_type": "session_started",
  "payload": {
    "session_id": "sess_123",
    "student_id": "stu_456",
    "tutor_id": "tut_789"
  }
}
```

## POST /outbound
Sends high-risk alerts back to Varsity Tutors.

**Request:**
```json
{
  "entity_id": "stu_123",
  "risk_score": 85,
  "explanation": "...",
  "recommendations": ["..."]
}
```
```

## Estimated Time: 30 minutes
