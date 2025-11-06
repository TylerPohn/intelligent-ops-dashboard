# IOPS Dashboard - NPM Scripts Reference

## Available Scripts

### Development

```bash
# Start frontend development server
npm run dev
# Opens: http://localhost:3002
# Features: Hot reload, React DevTools
```

### Deployment

```bash
# Deploy all CDK stacks to AWS
npm run deploy
# Deploys: CoreStack, ExperienceStack
# Region: us-east-2 (Ohio)
```

### Testing & Quality

```bash
# Run linter
npm run lint

# Run tests
npm run test
```

### Test Data Generation

#### Quick Reference

```bash
# Quick test (50 insights)
npm run generate:quick

# Demo/showcase (600 insights)
npm run generate:demo

# Large volume (2000 insights)
npm run generate:large

# Maximum showcase (10,000 insights)
npm run generate:showcase
```

#### Detailed Scripts

**`npm run generate:test-data`**
- **Purpose**: Generate test insights with default settings
- **Streams**: 60 concurrent
- **Events**: 10 per stream
- **Total**: 600 insights
- **Duration**: ~30-40 seconds
- **Use case**: Default testing and demos

**`npm run generate:demo`**
- **Purpose**: Same as default, explicit demo preset
- **Streams**: 60 concurrent
- **Events**: 10 per stream
- **Total**: 600 insights
- **Use case**: Showcase 50+ concurrent streams

**`npm run generate:quick`**
- **Purpose**: Fast test data generation
- **Streams**: 10 concurrent
- **Events**: 5 per stream
- **Total**: 50 insights
- **Duration**: ~5-10 seconds
- **Use case**: Quick verification, development testing

**`npm run generate:large`**
- **Purpose**: High-volume data generation
- **Streams**: 100 concurrent
- **Events**: 20 per stream
- **Total**: 2,000 insights
- **Duration**: ~2-3 minutes
- **Use case**: Load testing, stress testing

**`npm run generate:showcase`**
- **Purpose**: Maximum volume demonstration
- **Streams**: 200 concurrent
- **Events**: 50 per stream
- **Total**: 10,000 insights
- **Duration**: ~10-15 minutes
- **Use case**: Large-scale capability showcase

### Utility

```bash
# Run Claude Code without permissions prompts
npm run c
```

## Custom Data Generation

To generate custom volumes, use the script directly:

```bash
# Syntax: ./scripts/generate-test-events.sh <streams> <events_per_stream>

# Example: 75 streams with 15 events each = 1,125 total
./scripts/generate-test-events.sh 75 15

# Example: 500 streams with 10 events each = 5,000 total
./scripts/generate-test-events.sh 500 10
```

## Workflow Examples

### First-Time Setup

```bash
# 1. Start development server
npm run dev

# 2. In another terminal, generate demo data
npm run generate:demo

# 3. Open http://localhost:3002 to see insights
```

### Pre-Demo Preparation

```bash
# Generate fresh showcase data
npm run generate:showcase

# Wait 10-15 minutes for completion
# Dashboard will auto-update via polling
```

### Development Testing

```bash
# Quick iterations
npm run generate:quick

# Verify changes
npm run lint
npm run test
```

### Load Testing

```bash
# Generate large dataset
npm run generate:large

# Monitor dashboard performance
# Check API response times
# Verify DynamoDB throughput
```

### Continuous Demo Mode

```bash
# Keep generating fresh data
while true; do
  npm run generate:quick
  sleep 60  # Wait 1 minute between batches
done
```

## Output Examples

### Successful Generation

```
🚀 IOPS Dashboard - High Volume Test Event Generator
==================================================
Target: 60 concurrent data streams
Events per stream: 10
Total events: 600
Region: us-east-2
Table: iops-dashboard-metrics

📝 Generating 600 test insights...
⏳ Progress: 600/600 events (100%)...

✅ Generation Complete!
======================
✓ Generated: 600 insights
✓ Streams: 60 concurrent
✓ Duration: 39s
✓ Rate: 15 events/sec

📊 Sample Insights (latest 5):
[Table showing recent insights]

🎯 Dashboard Polling:
Your dashboard will automatically pick up these insights
within 5 seconds via HTTP polling.
```

## Troubleshooting

### Permission Denied

```bash
# Make script executable
chmod +x scripts/generate-test-events.sh

# Then retry
npm run generate:demo
```

### AWS Credentials Error

```bash
# Verify AWS CLI is configured
aws sts get-caller-identity

# Configure if needed
aws configure
```

### DynamoDB Throttling

If you see throttling errors with large volumes:

```bash
# Use smaller batches
npm run generate:demo  # Instead of generate:showcase

# Or spread over time
npm run generate:quick
sleep 60
npm run generate:quick
```

### Script Not Found

```bash
# Ensure you're in project root
cd /path/to/iops-dashboard

# Verify script exists
ls -la scripts/generate-test-events.sh
```

## Performance Benchmarks

| Script | Streams | Events | Total | Duration | Rate |
|--------|---------|--------|-------|----------|------|
| `generate:quick` | 10 | 5 | 50 | ~5s | 10/s |
| `generate:demo` | 60 | 10 | 600 | ~40s | 15/s |
| `generate:large` | 100 | 20 | 2,000 | ~2m | 16/s |
| `generate:showcase` | 200 | 50 | 10,000 | ~12m | 13/s |

*Rates may vary based on network latency and DynamoDB throttling*

## Cost Estimates

### Per Script Execution

| Script | DynamoDB WCUs | Estimated Cost |
|--------|---------------|----------------|
| `generate:quick` | 50 | $0.000063 |
| `generate:demo` | 600 | $0.00075 |
| `generate:large` | 2,000 | $0.0025 |
| `generate:showcase` | 10,000 | $0.0125 |

*Based on $1.25 per million write capacity units in us-east-2*

### Dashboard Polling Cost

- **Frequency**: Every 5 seconds
- **Requests/day**: 17,280
- **Lambda cost**: ~$0.10/day ($3/month)
- **DynamoDB reads**: Minimal with caching

## Integration with Dashboard

All scripts automatically integrate with the dashboard:

1. **Generation**: Script writes to DynamoDB
2. **Indexing**: EntityTypeIndex makes data queryable
3. **API**: Lambda serves via `/insights/recent` endpoint
4. **Polling**: Dashboard polls every 5 seconds
5. **Display**: Insights appear within 0-5 seconds

No manual refresh or configuration needed!

## Environment Variables

Scripts use these AWS configuration values:

- **Region**: `us-east-2` (hardcoded in script)
- **Table**: `iops-dashboard-metrics` (hardcoded)
- **Credentials**: From AWS CLI default profile

To use a different profile:

```bash
# Set profile for session
export AWS_PROFILE=my-profile

# Then run script
npm run generate:demo
```

## See Also

- **Script Details**: `scripts/README.md`
- **Dashboard Guide**: `docs/POLLING-SOLUTION.md`
- **Deployment**: `docs/DEPLOYMENT-STATUS.md`

---

**Last Updated**: November 5, 2025
**Project**: IOPS Dashboard
**Region**: us-east-2 (Ohio)
