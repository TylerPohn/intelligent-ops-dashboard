# CI/CD Setup Guide

This guide explains how to configure GitHub Secrets and environment variables for the automated CI/CD pipeline.

## Overview

The CI/CD pipeline consists of two workflows:

1. **`deploy.yml`** - Main deployment workflow (triggered on push to main/master)
   - Tests all Lambda functions
   - Deploys CDK infrastructure to AWS
   - Deploys frontend to Vercel
   - Passes stack outputs between jobs

2. **`pr-check.yml`** - PR validation workflow (triggered on pull requests)
   - Lints and type checks code
   - Runs Lambda function tests
   - Validates CDK synthesis
   - Performs security scanning
   - Does NOT deploy (validation only)

## Required GitHub Secrets

### AWS Credentials

The following secrets are required for AWS deployment:

| Secret Name | Description | How to Obtain |
|-------------|-------------|---------------|
| `AWS_ACCESS_KEY_ID` | AWS access key with deployment permissions | Create IAM user with CDK deployment permissions |
| `AWS_SECRET_ACCESS_KEY` | AWS secret access key | Corresponding secret for the access key |
| `AWS_ACCOUNT_ID` | Your 12-digit AWS account ID | Found in AWS Console → Account Settings |

#### Creating AWS IAM User for CI/CD

1. Go to AWS Console → IAM → Users → Create User
2. User name: `github-actions-deployer`
3. Attach policies:
   ```
   - AWSCloudFormationFullAccess
   - IAMFullAccess (for CDK bootstrap)
   - AmazonS3FullAccess (for CDK assets)
   - AWSLambdaFullAccess
   - AmazonDynamoDBFullAccess
   - AmazonAPIGatewayAdministrator
   - AmazonSNSFullAccess
   - AmazonEventBridgeFullAccess
   - CloudWatchLogsFullAccess
   ```
4. Create access key → CLI access
5. Save the Access Key ID and Secret Access Key
6. Add to GitHub Secrets

### Vercel Credentials

The following secrets are required for Vercel deployment:

| Secret Name | Description | How to Obtain |
|-------------|-------------|---------------|
| `VERCEL_TOKEN` | Vercel authentication token | Account Settings → Tokens → Create Token |
| `VERCEL_ORG_ID` | Vercel organization/team ID | Project Settings → General → "Organization ID" |
| `VERCEL_PROJECT_ID` | Vercel project ID | Project Settings → General → "Project ID" |

#### Getting Vercel Credentials

1. **Vercel Token**:
   - Go to https://vercel.com/account/tokens
   - Click "Create Token"
   - Name: `github-actions-deploy`
   - Scope: Full access (or limit to specific projects)
   - Copy and save the token

2. **Organization ID**:
   ```bash
   # Install Vercel CLI
   npm install -g vercel

   # Login
   vercel login

   # Link your project
   cd frontend
   vercel link

   # Get org and project IDs
   cat .vercel/project.json
   ```

3. **Project ID**:
   - Same as above, found in `.vercel/project.json`
   - Or from Vercel dashboard: Project Settings → General

## Adding Secrets to GitHub

1. Go to your GitHub repository
2. Settings → Secrets and variables → Actions
3. Click "New repository secret"
4. Add each secret with exact name and value

### Example Secret Addition

```bash
# Using GitHub CLI
gh secret set AWS_ACCESS_KEY_ID
gh secret set AWS_SECRET_ACCESS_KEY
gh secret set AWS_ACCOUNT_ID
gh secret set VERCEL_TOKEN
gh secret set VERCEL_ORG_ID
gh secret set VERCEL_PROJECT_ID
```

## Environment Variables

The workflows automatically set these environment variables:

```yaml
env:
  AWS_REGION: us-east-1
  NODE_VERSION: '18'
  PYTHON_VERSION: '3.11'
```

### Frontend Environment Variables (Passed from CDK)

These are automatically extracted from CDK outputs and passed to Vercel:

- `VITE_API_GATEWAY_URL` - API Gateway REST API URL
- `VITE_WEBSOCKET_URL` - WebSocket API URL

## Workflow Architecture

### Deploy Workflow (`deploy.yml`)

```
┌─────────────────┐
│  Test Lambdas   │
│  - TypeScript   │
│  - Python       │
└────────┬────────┘
         │ (needs: test-lambdas)
         ▼
┌─────────────────────────┐
│  Deploy Infrastructure  │
│  - CDK Bootstrap        │
│  - CDK Deploy           │
│  - Extract Outputs      │
└────────┬────────────────┘
         │ (outputs: api-url, websocket-url)
         ▼
┌─────────────────────────┐
│   Deploy Frontend       │
│  - Build with env vars  │
│  - Deploy to Vercel     │
│  - Set Vercel env vars  │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│  Notify Deployment      │
│  - Summary report       │
└─────────────────────────┘
```

### PR Check Workflow (`pr-check.yml`)

```
┌──────────────────┐   ┌──────────────────┐
│  Lint & Type     │   │  Test Lambdas    │
│  Check           │   │  (Matrix)        │
└──────────────────┘   └──────────────────┘
         │                      │
         └──────────┬───────────┘
                    │
         ┌──────────┴──────────┐
         │                     │
┌────────▼─────────┐  ┌────────▼─────────┐
│  Validate CDK    │  │  Security Scan   │
│  Synthesis       │  │  - Trivy         │
└────────┬─────────┘  └────────┬─────────┘
         │                     │
         └──────────┬──────────┘
                    ▼
         ┌─────────────────────┐
         │   PR Summary        │
         │   Report            │
         └─────────────────────┘
```

## Testing the Pipeline

### 1. Test PR Validation

```bash
# Create a feature branch
git checkout -b test/ci-pipeline

# Make a small change
echo "# Test" >> README.md
git add README.md
git commit -m "test: CI pipeline"

# Push and create PR
git push origin test/ci-pipeline
# Create PR on GitHub
```

### 2. Test Deployment

```bash
# Merge to main or push directly
git checkout main
git merge test/ci-pipeline
git push origin main

# Watch GitHub Actions tab for deployment progress
```

## CDK Outputs Artifact

The pipeline creates an artifact containing CDK stack outputs:

```json
{
  "IopsDashboardStack": {
    "ApiGatewayUrl": "https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com/prod",
    "WebSocketUrl": "wss://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com/prod"
  }
}
```

This artifact is:
- Created by `deploy-infrastructure` job
- Downloaded by `deploy-frontend` job
- Retained for 7 days
- Used to configure Vercel environment variables

## Troubleshooting

### AWS Deployment Fails

```bash
# Check AWS credentials
aws sts get-caller-identity

# Check CDK bootstrap
aws cloudformation describe-stacks \
  --stack-name CDKToolkit \
  --region us-east-1
```

### Vercel Deployment Fails

```bash
# Test Vercel CLI locally
vercel login
vercel --prod

# Check project link
vercel link
vercel env ls
```

### Lambda Tests Fail

```bash
# Run tests locally
cd lambda/ingest
npm test

cd lambda/process
pytest

# Check dependencies
npm ci
pip install -r requirements.txt
```

## Security Best Practices

1. **Never commit secrets** to the repository
2. **Use GitHub Secrets** for all sensitive data
3. **Rotate credentials** regularly (every 90 days)
4. **Limit IAM permissions** to minimum required
5. **Enable branch protection** on main/master
6. **Require PR reviews** before merging
7. **Enable security scanning** (Dependabot, CodeQL)

## Branch Protection Rules

Recommended settings for `main` branch:

```yaml
Require pull request reviews: Yes
  - Required approvals: 1
  - Dismiss stale reviews: Yes

Require status checks: Yes
  - Lint and Type Check
  - Test Lambda Functions
  - Validate CDK Synthesis
  - Security Scan

Require branches to be up to date: Yes

Restrict who can push: Yes (admins only)
```

## Manual Deployment

If you need to deploy manually:

```bash
# Deploy infrastructure
cd cdk
npm run build
cdk deploy --all

# Deploy frontend
cd frontend
vercel --prod
```

## Monitoring

### GitHub Actions Dashboard

- View workflow runs: Repository → Actions
- Download artifacts: Workflow run → Artifacts
- View logs: Workflow run → Job → Steps

### AWS CloudWatch

- Lambda logs: CloudWatch → Log groups → `/aws/lambda/*`
- API Gateway logs: CloudWatch → Log groups → `API-Gateway-*`

### Vercel Dashboard

- Deployments: https://vercel.com/dashboard
- Build logs: Deployment → View Details
- Environment variables: Project Settings → Environment Variables

## Cost Optimization

- GitHub Actions: 2,000 minutes/month free (public repos unlimited)
- AWS: Pay-as-you-go (estimate $5-20/month for dev)
- Vercel: Free tier includes 100 GB bandwidth

## Next Steps

1. ✅ Set up all GitHub Secrets
2. ✅ Test PR validation workflow
3. ✅ Test deployment workflow
4. ✅ Configure branch protection
5. ✅ Add team members as reviewers
6. ✅ Monitor first production deployment
7. ✅ Set up CloudWatch alarms (PR-07)
8. ✅ Configure SNS notifications (PR-07)

## Support

For issues or questions:
- Check GitHub Actions logs
- Review CloudFormation stack events
- Check Vercel deployment logs
- Consult AWS CloudWatch logs

---

**Last Updated**: 2025-11-04
**Pipeline Version**: 1.0.0
**PR Reference**: PR-13
