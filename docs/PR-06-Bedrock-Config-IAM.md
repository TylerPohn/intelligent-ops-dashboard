# PR-06: Bedrock Configuration & IAM Policies

## Overview
Configure AWS Bedrock access, request model access for Claude 4.5 Haiku and Sonnet, and set up proper IAM policies for the AI inference Lambda.

## Dependencies
- PR-05: AI Inference Lambda (requires IAM policy updates)

## AWS Credentials Setup
**IMPORTANT**: Ensure AWS credentials are configured before running CDK/CLI commands.

See `/Users/tyler/Desktop/Gauntlet/iops-dashboard/docs/AWS-credentials.md` for setup instructions.

## Objectives
- Enable AWS Bedrock service
- Request access to Claude 4.5 Haiku and Sonnet models
- Configure IAM policies for Bedrock access
- Update Lambda code to use AWS Bedrock Runtime (not OpenAI)
- Test Bedrock connectivity

## Step-by-Step Instructions

### 1. Enable Bedrock in AWS Console

**Important:** Bedrock is only available in specific regions. Best options:
- `us-east-1` (N. Virginia)
- `us-west-2` (Oregon)

```bash
# Verify current region
aws configure get region

# If needed, set region to us-east-1
export AWS_REGION=us-east-1
```

**Console Steps:**
1. Navigate to AWS Bedrock console: https://console.aws.amazon.com/bedrock/
2. Click "Get Started" if this is your first time
3. Accept terms and conditions

### 2. Request Model Access

**Console Steps:**
1. In Bedrock console, go to "Model access" in left sidebar
2. Click "Manage model access"
3. Find "Claude 4.5 Haiku" and "Claude Sonnet 4.5" in the list
4. Check the boxes next to both models
5. Click "Request model access"
6. Wait for approval (usually instant for Claude models)

**Verify via CLI:**
```bash
aws bedrock list-foundation-models \
  --region us-east-1 \
  --query 'modelSummaries[?contains(modelId, `claude`)]'
```

Expected output shows model details including:
```json
[
  {
    "modelId": "anthropic.claude-haiku-4-5-20251001-v1:0",
    "modelName": "Claude Haiku 4.5",
    "providerName": "Anthropic"
  },
  {
    "modelId": "anthropic.claude-sonnet-4-5-20250929-v1:0",
    "modelName": "Claude Sonnet 4.5",
    "providerName": "Anthropic"
  }
]
```

### 3. Update IAM Role Policy in CDK

The policy is already added in PR-05, but let's verify and enhance it:

**File:** `cdk/lib/intelligence-stack.ts` (verify/update)

```typescript
// Enhanced Bedrock permissions for Claude 4.5 models
this.aiFunction.addToRolePolicy(new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: [
    'bedrock:InvokeModel',
    'bedrock:InvokeModelWithResponseStream',
  ],
  resources: [
    // Claude 4.5 Haiku (cost-effective, fast)
    `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0`,
    // Claude Sonnet 4.5 (balanced capability/cost)
    `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-sonnet-4-5-20250929-v1:0`,
    // Global inference profiles (cross-region routing for higher availability)
    `arn:aws:bedrock:*::foundation-model/global.anthropic.claude-haiku-4-5-20251001-v1:0`,
    `arn:aws:bedrock:*::foundation-model/global.anthropic.claude-sonnet-4-5-20250929-v1:0`,
  ],
}));

// Optional: Add CloudWatch Logs for Bedrock calls
this.aiFunction.addToRolePolicy(new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: [
    'logs:CreateLogGroup',
    'logs:CreateLogStream',
    'logs:PutLogEvents',
  ],
  resources: [
    `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/bedrock/*`,
  ],
}));
```

### 4. Deploy Updated Stack
```bash
cd cdk
npm run build
cdk deploy IOpsDashboard-IntelligenceStack
```

### 5. Update Lambda to Use AWS Bedrock Runtime

**IMPORTANT:** Replace OpenAI API calls with AWS Bedrock Runtime. No API keys needed - uses IAM authentication.

**File:** `lambda/ai/index.ts` (update)

Replace OpenAI imports with Bedrock:
```typescript
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const bedrockClient = new BedrockRuntimeClient({
  region: process.env.AWS_REGION || 'us-east-1'
});

// Use Claude 4.5 Haiku (cost-effective, fast)
const BEDROCK_MODEL_ID = 'anthropic.claude-haiku-4-5-20251001-v1:0';

// Or use global inference profile for higher availability
// const BEDROCK_MODEL_ID = 'global.anthropic.claude-haiku-4-5-20251001-v1:0';
```

Replace `callOpenAI` function with `callBedrock`:
```typescript
async function callBedrock(prompt: string): Promise<string> {
  const payload = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 1000,
    temperature: 0.7,
    messages: [
      {
        role: 'user',
        content: prompt
      }
    ]
  };

  const command = new InvokeModelCommand({
    modelId: BEDROCK_MODEL_ID,
    body: JSON.stringify(payload),
    contentType: 'application/json',
    accept: 'application/json'
  });

  try {
    const response = await bedrockClient.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    // Claude response format: { content: [{ type: 'text', text: '...' }] }
    return responseBody.content[0].text;
  } catch (error) {
    console.error('Bedrock invocation error:', error);
    throw new Error(`Failed to invoke Bedrock: ${error.message}`);
  }
}
```

**Update package.json:**
```json
{
  "dependencies": {
    "@aws-sdk/client-bedrock-runtime": "^3.450.0",
    "@aws-sdk/client-dynamodb": "^3.450.0",
    "@aws-sdk/lib-dynamodb": "^3.450.0"
  }
}
```

**Note:** No `axios` or `@aws-sdk/client-secrets-manager` needed - Bedrock uses IAM authentication directly.

### 6. Create IAM Policy Document for Reference

**File:** `docs/iam-policy-bedrock.json`

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "BedrockModelInvoke",
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream"
      ],
      "Resource": [
        "arn:aws:bedrock:*::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0",
        "arn:aws:bedrock:*::foundation-model/anthropic.claude-sonnet-4-5-20250929-v1:0",
        "arn:aws:bedrock:*::foundation-model/global.anthropic.claude-haiku-4-5-20251001-v1:0",
        "arn:aws:bedrock:*::foundation-model/global.anthropic.claude-sonnet-4-5-20250929-v1:0"
      ]
    },
    {
      "Sid": "BedrockLogging",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:log-group:/aws/bedrock/*"
    }
  ]
}
```

### 7. Rebuild and Deploy
```bash
cd lambda/ai
npm install
npm run build

cd ../../cdk
npm run build
cdk deploy IOpsDashboard-IntelligenceStack
```

## Verification Steps

### 1. Verify Bedrock Model Access
```bash
aws bedrock list-foundation-models \
  --region us-east-1 \
  --by-provider Anthropic \
  --query 'modelSummaries[].modelId'
```

Should include: `anthropic.claude-haiku-4-5-20251001-v1:0` and `anthropic.claude-sonnet-4-5-20250929-v1:0`

### 2. Test Bedrock Invocation Directly
Create test script:

**File:** `scripts/test-bedrock.sh`
```bash
#!/bin/bash

aws bedrock-runtime invoke-model \
  --region us-east-1 \
  --model-id anthropic.claude-haiku-4-5-20251001-v1:0 \
  --body '{
    "anthropic_version": "bedrock-2023-05-31",
    "max_tokens": 100,
    "messages": [
      {
        "role": "user",
        "content": "Say hello!"
      }
    ]
  }' \
  --cli-binary-format raw-in-base64-out \
  output.json

cat output.json | jq '.content[0].text'
```

Run:
```bash
chmod +x scripts/test-bedrock.sh
./scripts/test-bedrock.sh
```

Expected output:
```
"Hello! How can I help you today?"
```

### 3. Test Lambda with Bedrock
```bash
FUNCTION_NAME=$(aws cloudformation describe-stacks \
  --stack-name IOpsDashboard-IntelligenceStack \
  --query 'Stacks[0].Outputs[?OutputKey==`AIFunctionName`].OutputValue' \
  --output text)

# Verify environment variables
aws lambda get-function-configuration \
  --function-name $FUNCTION_NAME \
  | jq '.Environment.Variables'

# Should show:
# {
#   "DYNAMODB_TABLE_NAME": "iops-dashboard-metrics",
#   "AWS_REGION": "us-east-1"
# }
```

### 4. Test End-to-End AI Inference
```bash
# Use test alert from PR-05
aws lambda invoke \
  --function-name $FUNCTION_NAME \
  --payload file://test/test-alert.json \
  response.json

# Check logs for Bedrock call
aws logs tail /aws/lambda/$FUNCTION_NAME --since 5m
```

Expected log output:
```
Calling AWS Bedrock...
AI Response: {"risk_score": 82, "explanation": "High frequency of IB calls...", ...}
```

### 5. Verify IAM Permissions
```bash
# Get Lambda role name
ROLE_NAME=$(aws lambda get-function-configuration \
  --function-name $FUNCTION_NAME \
  --query 'Role' \
  --output text | cut -d'/' -f2)

# List role policies
aws iam list-role-policies --role-name $ROLE_NAME

# Get policy details
aws iam get-role-policy \
  --role-name $ROLE_NAME \
  --policy-name <policy-name-from-above>
```

## Configuration Options

### Switch Bedrock Model
Update `lambda/ai/index.ts`:
```typescript
// Use Claude 4.5 Haiku (fastest, most cost-effective) - DEFAULT
const BEDROCK_MODEL_ID = 'anthropic.claude-haiku-4-5-20251001-v1:0';

// Or use Claude Sonnet 4.5 (more capable, higher cost)
const BEDROCK_MODEL_ID = 'anthropic.claude-sonnet-4-5-20250929-v1:0';

// Or use global inference profile for higher availability
const BEDROCK_MODEL_ID = 'global.anthropic.claude-haiku-4-5-20251001-v1:0';
```

## Cost Considerations

**Claude 4.5 Haiku Pricing (as of Jan 2025):**
- Input: $0.80 per 1M tokens
- Output: $4.00 per 1M tokens

**Estimated costs for 500 alerts/day:**
- Average prompt: ~200 tokens
- Average response: ~150 tokens
- Daily cost: ~$0.38
- Monthly cost: ~$11.40

**Claude Sonnet 4.5 (if needed for complex analysis):**
- Input: $3.00 per 1M tokens
- Output: $15.00 per 1M tokens
- ~4x more expensive than Haiku

## Troubleshooting

### Issue: AccessDeniedException for Bedrock
**Check:**
```bash
# 1. Verify model access in console
# 2. Check region matches (must be us-east-1 or us-west-2)
# 3. Verify IAM policy attached to Lambda role
```

### Issue: Model Access Request Pending
**Solution:**
- Usually instant for Claude models
- Check email for approval notification
- May take up to 24 hours for some accounts

### Issue: ResourceNotFoundException
**Cause:** Wrong model ID or region
**Solution:**
```bash
# List available models in your region
aws bedrock list-foundation-models --region us-east-1
```

### Issue: ThrottlingException
**Solution:** Bedrock has rate limits. Implement exponential backoff:
```typescript
async function callBedrockWithRetry(prompt: string, retries = 3): Promise<string> {
  for (let i = 0; i < retries; i++) {
    try {
      return await callBedrock(prompt);
    } catch (error: any) {
      if (error.name === 'ThrottlingException' && i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, i)));
        continue;
      }
      throw error;
    }
  }
  throw new Error('Max retries exceeded');
}
```

## Files Created/Updated
- `cdk/lib/intelligence-stack.ts` (updated)
- `lambda/ai/index.ts` (updated)
- `lambda/ai/package.json` (updated)
- `docs/iam-policy-bedrock.json`
- `scripts/test-bedrock.sh`

## Next Steps
- PR-07: EventBridge Rules + SNS Alerts (add email notifications)
- PR-08: DynamoDB Schema (store AI insights)
- Test AI predictions with real data from simulator

## Estimated Time
- 30-45 minutes (including model access approval)

## Skills Required
- AWS Console navigation
- IAM policy understanding
- AWS Secrets Manager basics
- Understanding of API key security

## References
- [AWS Bedrock Documentation](https://docs.aws.amazon.com/bedrock/)
- [Claude Model Access](https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html)
- [Bedrock Pricing](https://aws.amazon.com/bedrock/pricing/)
- [AWS Secrets Manager](https://docs.aws.amazon.com/secretsmanager/)
- [Claude 3.5 Model Card](https://docs.anthropic.com/en/docs/about-claude/models)
