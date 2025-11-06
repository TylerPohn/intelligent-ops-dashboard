# CORS Fix for Insights API

## Problem
Frontend was getting CORS errors when calling `/insights/recent`:
```
Access to XMLHttpRequest at 'https://dp41u4qn19.execute-api.us-east-2.amazonaws.com/prod/insights/recent?limit=50'
from origin 'http://localhost:3002' has been blocked by CORS policy:
No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

## Root Cause
1. The `/insights` API endpoint didn't exist in the CDK stack
2. No CORS configuration on API Gateway
3. Lambda functions weren't returning CORS headers

## Solution

### 1. Created Insights Lambda (`lambda/api/get-insights.ts`)
- Handles `GET /insights/recent?limit=N` - Get recent insights
- Handles `GET /insights/{id}` - Get specific insight by ID
- Queries DynamoDB with EntityTypeIndex GSI
- Returns proper CORS headers in all responses

### 2. Updated CDK Stack (`cdk/lib/cdk-stack.ts`)

#### Added CORS to API Gateway
```typescript
const api = new apigateway.RestApi(this, 'IngestApi', {
  defaultCorsPreflightOptions: {
    allowOrigins: apigateway.Cors.ALL_ORIGINS,
    allowMethods: apigateway.Cors.ALL_METHODS,
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: cdk.Duration.days(1),
  },
});
```

#### Added DynamoDB GSI
```typescript
this.metricsTable.addGlobalSecondaryIndex({
  indexName: 'EntityTypeIndex',
  partitionKey: { name: 'entity_type', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
  projectionType: dynamodb.ProjectionType.ALL,
});
```

#### Added API Endpoints
```typescript
// Create /insights resource
const insightsResource = api.root.addResource('insights');

// Add /insights/recent endpoint
const recentResource = insightsResource.addResource('recent');
recentResource.addMethod('GET', new apigateway.LambdaIntegration(insightsLambda));

// Add /insights/{id} endpoint
const insightIdResource = insightsResource.addResource('{id}');
insightIdResource.addMethod('GET', new apigateway.LambdaIntegration(insightsLambda));
```

### 3. Lambda CORS Headers
All Lambda responses include:
```typescript
{
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}
```

## API Endpoints

### Get Recent Insights
```bash
GET /insights/recent?limit=50
```

**Response:**
```json
[
  {
    "alert_id": "alert-123",
    "entity_id": "entity-456",
    "timestamp": "2025-11-05T09:30:00Z",
    "prediction_type": "high_ib_call_frequency",
    "risk_score": 0.85,
    "explanation": "Unusual spike in IB call frequency detected",
    "recommendations": ["Scale resources", "Check for memory leaks"],
    "model_used": "bedrock-claude",
    "confidence": 0.92
  }
]
```

### Get Specific Insight
```bash
GET /insights/{alertId}
```

**Response:**
```json
{
  "alert_id": "alert-123",
  "entity_id": "entity-456",
  "timestamp": "2025-11-05T09:30:00Z",
  "prediction_type": "high_ib_call_frequency",
  "risk_score": 0.85,
  "explanation": "Unusual spike in IB call frequency detected",
  "recommendations": ["Scale resources", "Check for memory leaks"],
  "model_used": "bedrock-claude",
  "confidence": 0.92
}
```

## Testing

### Test CORS Preflight
```bash
curl -X OPTIONS \
  https://dp41u4qn19.execute-api.us-east-2.amazonaws.com/prod/insights/recent \
  -H "Origin: http://localhost:3002" \
  -H "Access-Control-Request-Method: GET" \
  -v
```

### Test GET Request
```bash
curl -X GET \
  "https://dp41u4qn19.execute-api.us-east-2.amazonaws.com/prod/insights/recent?limit=10" \
  -H "Origin: http://localhost:3002" \
  -v
```

Expected headers in response:
```
access-control-allow-origin: *
access-control-allow-methods: GET, OPTIONS
access-control-allow-headers: Content-Type, Authorization
```

## DynamoDB Schema

### Insights Table Structure
```typescript
{
  entity_id: "alert-uuid",      // Partition Key
  entity_type: "insight",        // Sort Key
  timestamp: "2025-11-05T09:30:00Z",
  prediction_type: "high_ib_call_frequency",
  risk_score: 0.85,
  explanation: "...",
  recommendations: ["..."],
  model_used: "bedrock-claude",
  confidence: 0.92,
  related_entity: "entity-456",
  ttl: 1730822400
}
```

### GSI: EntityTypeIndex
- **Partition Key**: `entity_type` (e.g., "insight", "metric", "alert")
- **Sort Key**: `timestamp` (ISO 8601 string)
- **Projection**: ALL
- **Purpose**: Query all insights sorted by time

## Deployment

```bash
# Build Lambda
cd lambda/api
npm install
npm run build

# Deploy infrastructure
cd ../../cdk
npx cdk deploy --all
```

## Files Changed
- `cdk/lib/cdk-stack.ts` - Added CORS, GSI, and insights endpoints
- `lambda/api/get-insights.ts` - New Lambda function
- `lambda/api/package.json` - Dependencies
- `lambda/api/tsconfig.json` - TypeScript config

## Security Notes

### Production Considerations
Current configuration allows ALL origins (`*`). For production:

1. **Restrict Origins**:
```typescript
allowOrigins: [
  'https://your-production-domain.com',
  'https://your-staging-domain.com'
],
```

2. **Add Authentication**:
- Use API Gateway authorizers
- Implement JWT validation
- Use AWS Cognito user pools

3. **Rate Limiting**:
- Enable API Gateway throttling
- Add WAF rules for DDoS protection

4. **Monitoring**:
- CloudWatch alarms for 4xx/5xx errors
- X-Ray tracing for performance
- CloudWatch Logs Insights queries

## Troubleshooting

### Still seeing CORS errors?
1. Clear browser cache
2. Check API Gateway deployment (must redeploy after CORS changes)
3. Verify Lambda returns CORS headers (check CloudWatch Logs)
4. Test with curl to isolate browser vs server issues

### 403 Forbidden errors?
1. Check Lambda IAM role has DynamoDB permissions
2. Verify API Gateway resource policy
3. Check Lambda execution logs in CloudWatch

### No data returned?
1. Verify DynamoDB has data with `entity_type = "insight"`
2. Check EntityTypeIndex GSI is active
3. Verify timestamp field exists and is ISO 8601 format
4. Check Lambda logs for query errors
