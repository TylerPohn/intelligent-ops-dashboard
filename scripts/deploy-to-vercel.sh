#!/bin/bash

# IOPS Dashboard - Vercel Deployment Script
# This script guides you through deploying the frontend to Vercel

set -e

echo "╔══════════════════════════════════════════════════════════════════════╗"
echo "║         IOPS Dashboard - Vercel Deployment Wizard                   ║"
echo "╚══════════════════════════════════════════════════════════════════════╝"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if we're in the right directory
if [ ! -f "frontend/package.json" ]; then
    echo -e "${RED}Error: Must run from project root directory${NC}"
    echo "cd to: /Users/tyler/Desktop/Gauntlet/iops-dashboard"
    exit 1
fi

echo "Step 1: Checking prerequisites..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}✗ Node.js not found${NC}"
    echo "Install from: https://nodejs.org"
    exit 1
fi
echo -e "${GREEN}✓ Node.js $(node --version)${NC}"

# Check npm
if ! command -v npm &> /dev/null; then
    echo -e "${RED}✗ npm not found${NC}"
    exit 1
fi
echo -e "${GREEN}✓ npm $(npm --version)${NC}"

# Check if Vercel CLI is installed
if ! command -v vercel &> /dev/null; then
    echo -e "${YELLOW}⚠ Vercel CLI not installed${NC}"
    echo ""
    read -p "Install Vercel CLI now? (y/n) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "Installing Vercel CLI..."
        npm install -g vercel
        echo -e "${GREEN}✓ Vercel CLI installed${NC}"
    else
        echo -e "${RED}Cannot proceed without Vercel CLI${NC}"
        echo "Install manually: npm install -g vercel"
        exit 1
    fi
else
    echo -e "${GREEN}✓ Vercel CLI installed${NC}"
fi

echo ""
echo "Step 2: Vercel Authentication"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check if already logged in
if vercel whoami &> /dev/null; then
    VERCEL_USER=$(vercel whoami)
    echo -e "${GREEN}✓ Already logged in as: $VERCEL_USER${NC}"
else
    echo "Opening browser for Vercel login..."
    vercel login
fi

echo ""
echo "Step 3: Building Frontend"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

cd frontend

# Install dependencies
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

# Test build locally
echo "Testing production build..."
npm run build

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Build successful${NC}"
else
    echo -e "${RED}✗ Build failed${NC}"
    echo "Fix build errors before deploying"
    exit 1
fi

echo ""
echo "Step 4: Environment Variables"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ ! -f ".env" ]; then
    echo -e "${YELLOW}⚠ No .env file found${NC}"
    echo "Creating .env from AWS deployment outputs..."

    cat > .env << 'EOF'
# IOps Dashboard - Environment Configuration
# Generated from CDK deployment outputs

# API Gateway REST API URL
VITE_API_URL=https://dp41u4qn19.execute-api.us-east-2.amazonaws.com/prod

# WebSocket API URL for real-time updates
VITE_WEBSOCKET_URL=wss://il7omaw929.execute-api.us-east-2.amazonaws.com/prod

# AWS Region
VITE_AWS_REGION=us-east-2
EOF

    echo -e "${GREEN}✓ Created .env file${NC}"
else
    echo -e "${GREEN}✓ .env file exists${NC}"
fi

echo ""
echo "Environment variables:"
cat .env | grep -v '^#' | grep -v '^$'

echo ""
echo "Step 5: Deploy to Vercel"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

read -p "Deploy to production? (y/n) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Deployment cancelled"
    exit 0
fi

echo "Deploying to Vercel..."
echo ""

# Deploy
vercel --prod

if [ $? -eq 0 ]; then
    echo ""
    echo "╔══════════════════════════════════════════════════════════════════════╗"
    echo "║                    🎉 DEPLOYMENT SUCCESSFUL! 🎉                      ║"
    echo "╚══════════════════════════════════════════════════════════════════════╝"
    echo ""
    echo "Your IOPS Dashboard is now live!"
    echo ""
    echo "Next steps:"
    echo "1. Visit your Vercel dashboard to see the deployment URL"
    echo "2. Test the live application"
    echo "3. Configure custom domain (optional)"
    echo "4. Set up environment variables in Vercel dashboard"
    echo ""
    echo "Don't forget to:"
    echo "- Confirm SNS email subscriptions"
    echo "- Test data generation with simulator Lambda"
    echo "- Monitor CloudWatch logs"
    echo ""
else
    echo -e "${RED}✗ Deployment failed${NC}"
    echo "Check the error messages above"
    exit 1
fi
