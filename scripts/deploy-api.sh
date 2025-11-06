#!/bin/bash
set -e

echo "================================================"
echo "🚀 Deploying IOPS Dashboard API Infrastructure"
echo "================================================"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Change to project root
cd "$(dirname "$0")/.."

echo -e "\n${YELLOW}Step 1: Building API Lambda${NC}"
cd lambda/api
echo "Installing dependencies..."
npm install
echo "Building TypeScript..."
npm run build
echo -e "${GREEN}✓ API Lambda built successfully${NC}"

echo -e "\n${YELLOW}Step 2: Building WebSocket Lambda${NC}"
cd ../websocket
echo "Installing dependencies..."
npm install
echo "Building TypeScript..."
npm run build
echo -e "${GREEN}✓ WebSocket Lambda built successfully${NC}"

echo -e "\n${YELLOW}Step 3: Deploying CDK Stack${NC}"
cd ../../cdk
echo "Synthesizing CloudFormation template..."
npx cdk synth --all

echo "Deploying to AWS..."
npx cdk deploy --all --require-approval never

echo -e "\n${GREEN}================================================${NC}"
echo -e "${GREEN}✓ Deployment Complete!${NC}"
echo -e "${GREEN}================================================${NC}"

# Get outputs
echo -e "\n${YELLOW}API Endpoints:${NC}"
aws cloudformation describe-stacks \
  --stack-name IopsDashboardStack \
  --query 'Stacks[0].Outputs[?OutputKey==`IngestApiUrl`].OutputValue' \
  --output text 2>/dev/null || echo "REST API: (check AWS Console)"

aws cloudformation describe-stacks \
  --stack-name IopsDashboardStack-ExperienceStack \
  --query 'Stacks[0].Outputs[?OutputKey==`WebSocketUrl`].OutputValue' \
  --output text 2>/dev/null || echo "WebSocket API: (check AWS Console)"

echo -e "\n${YELLOW}Next Steps:${NC}"
echo "1. Update frontend/.env with API URLs"
echo "2. Start frontend: cd frontend && npm run dev"
echo "3. Test WebSocket: node scripts/test-websocket.js"
echo "4. Enable simulator: aws events enable-rule --name [rule-name]"
