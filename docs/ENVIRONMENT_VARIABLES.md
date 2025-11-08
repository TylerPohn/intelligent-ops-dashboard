# Environment Variables Reference

## Frontend Environment Variables

The frontend uses Vite's environment variable system. All variables must be prefixed with `VITE_` to be accessible in the browser.

### Required Variables

#### VITE_API_URL
- **Description**: REST API Gateway endpoint URL
- **Required**: Yes
- **Example**: `https://uwnig53hbd.execute-api.us-east-2.amazonaws.com/prod`
- **Usage**: Base URL for all API calls (insights, metrics, health predictions)
- **How to get**: From CDK deployment output `ApiEndpoint`

### Optional Variables

#### VITE_SSE_URL
- **Description**: Server-Sent Events endpoint for real-time streaming
- **Required**: No (currently using polling instead of SSE)
- **Example**: `https://uwnig53hbd.execute-api.us-east-2.amazonaws.com/prod/stream`
- **Usage**: Real-time updates streaming endpoint
- **How to get**: From CDK deployment output `SSEEndpoint`
- **Default**: Falls back to polling if not set

#### VITE_AWS_REGION
- **Description**: AWS region where backend services are deployed
- **Required**: No
- **Example**: `us-east-2`
- **Default**: `us-east-2`
- **Usage**: AWS SDK configuration (if needed)

## Environment Files

### Development (.env.local)
Create `frontend/.env.local` for local development:

```bash
# Development API (local or deployed)
VITE_API_URL=https://uwnig53hbd.execute-api.us-east-2.amazonaws.com/prod

# Optional SSE URL
VITE_SSE_URL=https://uwnig53hbd.execute-api.us-east-2.amazonaws.com/prod/stream

# AWS Region
VITE_AWS_REGION=us-east-2
```

### Production (Vercel)
Set via Vercel dashboard or CLI:

```bash
vercel env add VITE_API_URL production
# Paste: https://uwnig53hbd.execute-api.us-east-2.amazonaws.com/prod

vercel env add VITE_SSE_URL production
# Paste: https://uwnig53hbd.execute-api.us-east-2.amazonaws.com/prod/stream

vercel env add VITE_AWS_REGION production
# Paste: us-east-2
```

## Legacy Variables (Deprecated)

### VITE_WEBSOCKET_URL
- **Status**: Deprecated (replaced by SSE/polling)
- **Previous Usage**: WebSocket connection for real-time updates
- **Migration**: System now uses HTTP polling or SSE instead

### VITE_DYNAMODB_TABLE
- **Status**: Not used in frontend
- **Reason**: Backend handles DynamoDB access directly

### VITE_KINESIS_STREAM
- **Status**: Not used in frontend
- **Reason**: Backend handles Kinesis streams directly

## Getting CDK Output Values

After deploying your infrastructure:

```bash
cd cdk
npm run deploy

# Output will show:
✅  IOpsDashboard-CoreStack

Outputs:
IOpsDashboard-CoreStack.ApiEndpoint = https://xxxxx.execute-api.us-east-2.amazonaws.com/prod
IOpsDashboard-CoreStack.SSEEndpoint = https://xxxxx.execute-api.us-east-2.amazonaws.com/prod/stream

# Copy the ApiEndpoint value to VITE_API_URL
# Copy the SSEEndpoint value to VITE_SSE_URL (optional)
```

## Environment Variable Access in Code

```typescript
// In any React component or TypeScript file:
const apiUrl = import.meta.env.VITE_API_URL;
const sseUrl = import.meta.env.VITE_SSE_URL;
const region = import.meta.env.VITE_AWS_REGION || 'us-east-2';

// Example from frontend/src/api/client.ts:
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
```

## Verification

### Check Variables in Build
```bash
cd frontend
npm run build

# Vite will show which env vars are being used
# Check dist/assets/*.js for hardcoded URLs
```

### Check Variables in Vercel
```bash
# List all environment variables
vercel env ls

# Pull environment variables locally for testing
vercel env pull .env.vercel
```

### Test API Connection
```bash
# Test if API is accessible
curl https://your-api-url/prod/insights/recent?limit=1

# Should return JSON with insights data
```

## Troubleshooting

### "VITE_API_URL is undefined"
- **Cause**: Environment variable not set in Vercel
- **Fix**: Add via `vercel env add VITE_API_URL`

### "API calls failing with CORS errors"
- **Cause**: API Gateway CORS not configured for Vercel domain
- **Fix**: Update CDK stack to allow Vercel domain in CORS settings

### "Old API URL cached after update"
- **Cause**: Vercel build cache or browser cache
- **Fix**: Trigger new deployment with `vercel --prod --force`

## Security Notes

- Never commit `.env` files with production credentials
- Use Vercel's encrypted environment variables for secrets
- API URLs are public (embedded in frontend JS bundle)
- For sensitive operations, use authentication tokens (not yet implemented)

## Current System Architecture

```
Frontend (Vercel)
    │
    │ HTTP Polling every 5s
    │ GET /insights/recent?limit=10
    │
    ▼
API Gateway (AWS)
    │
    ▼
Lambda Functions
    │
    ▼
DynamoDB (customer-predictions table)
    ▲
    │
    │ Writes predictions every 5 min
    │
AI Lambda (EventBridge scheduled)
    │
    ▼
SageMaker TensorFlow Endpoint (us-east-1)
```

Only `VITE_API_URL` is required for the system to work.
