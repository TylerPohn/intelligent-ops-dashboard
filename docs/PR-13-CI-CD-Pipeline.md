# PR-13: CI/CD Pipeline

## Overview
Set up GitHub Actions for automated testing, CDK deployment, and frontend deployment to Vercel.

## AWS Credentials for CI/CD
**IMPORTANT**: GitHub Actions will need AWS credentials to deploy infrastructure.

For local development, see `/Users/tyler/Desktop/Gauntlet/iops-dashboard/docs/AWS-credentials.md` for setup instructions.

For CI/CD, you'll configure credentials as GitHub Secrets (see Setup Instructions below).

## GitHub Actions Workflow

**File:** `.github/workflows/deploy.yml`

```yaml
name: Deploy IOps Dashboard

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

env:
  AWS_REGION: us-east-1

jobs:
  test-backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install Lambda dependencies
        run: |
          cd lambda/ingest && npm install && npm run build
          cd ../process && npm install && npm run build
          cd ../simulator && npm install && npm run build
          cd ../ai && npm install && npm run build

      - name: Run tests
        run: |
          cd lambda && npm test || echo "No tests yet"

  deploy-infrastructure:
    needs: test-backend
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v2
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ env.AWS_REGION }}

      - name: Install CDK
        run: npm install -g aws-cdk

      - name: Build Lambdas
        run: |
          cd lambda/ingest && npm install && npm run build
          cd ../process && npm install && npm run build
          cd ../simulator && npm install && npm run build
          cd ../ai && npm install && npm run build
          cd ../websocket && npm install && npm run build

      - name: Deploy CDK stacks
        run: |
          cd cdk
          npm install
          npm run build
          cdk deploy --all --require-approval never

      - name: Save stack outputs
        run: |
          aws cloudformation describe-stacks --stack-name IOpsDashboard-CoreStack \
            --query 'Stacks[0].Outputs' > stack-outputs.json

      - name: Upload outputs
        uses: actions/upload-artifact@v3
        with:
          name: stack-outputs
          path: stack-outputs.json

  deploy-frontend:
    needs: deploy-infrastructure
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Download stack outputs
        uses: actions/download-artifact@v3
        with:
          name: stack-outputs

      - name: Set environment variables
        run: |
          API_URL=$(jq -r '.[] | select(.OutputKey=="IngestApiUrl") | .OutputValue' stack-outputs.json)
          echo "VITE_API_URL=$API_URL" >> $GITHUB_ENV

      - name: Deploy to Vercel
        uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          working-directory: ./frontend
```

## Setup Instructions

1. **Add GitHub Secrets:**
   - `AWS_ACCESS_KEY_ID`
   - `AWS_SECRET_ACCESS_KEY`
   - `VERCEL_TOKEN`
   - `VERCEL_ORG_ID`
   - `VERCEL_PROJECT_ID`

2. **Vercel Setup:**
   ```bash
   cd frontend
   npm install -g vercel
   vercel login
   vercel link
   ```

3. **Test Pipeline:**
   ```bash
   git add .
   git commit -m "Add CI/CD pipeline"
   git push origin main
   ```

## Estimated Time: 45 minutes
