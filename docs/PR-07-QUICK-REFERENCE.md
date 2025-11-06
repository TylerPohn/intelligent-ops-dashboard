# PR-07: EventBridge + SNS Alerts - Quick Reference

## One-Line Summary
Implemented EventBridge + SNS alerts system with 3 severity levels, dead letter queue, and formatted email notifications.

## Quick Deploy

```bash
# 1. Set environment variables
export CRITICAL_ALERT_EMAILS="your-email@example.com"
export WARNING_ALERT_EMAILS="your-email@example.com"
export INFO_ALERT_EMAILS="your-email@example.com"

# 2. Deploy
cd cdk && npm run build && cdk deploy IOpsDashboard-CdkStack

# 3. Confirm email subscriptions (check inbox)

# 4. Test
cd .. && ./scripts/test-alerts.sh \
  $(aws cloudformation describe-stacks --stack-name IOpsDashboard-CdkStack --query 'Stacks[0].Outputs[?OutputKey==`CriticalAlertTopicArn`].OutputValue' --output text) \
  $(aws cloudformation describe-stacks --stack-name IOpsDashboard-CdkStack --query 'Stacks[0].Outputs[?OutputKey==`WarningAlertTopicArn`].OutputValue' --output text) \
  $(aws cloudformation describe-stacks --stack-name IOpsDashboard-CdkStack --query 'Stacks[0].Outputs[?OutputKey==`InfoAlertTopicArn`].OutputValue' --output text)
```

## Resources Created

| Resource | Name | Purpose |
|----------|------|---------|
| EventBridge Bus | `iops-dashboard-alerts` | Central alert routing |
| SNS Topic | `iops-dashboard-critical-alerts` | Critical severity emails |
| SNS Topic | `iops-dashboard-warning-alerts` | Warning severity emails |
| SNS Topic | `iops-dashboard-info-alerts` | Info severity emails |
| SQS Queue | `iops-dashboard-alert-dlq` | Failed notifications (14d retention) |
| EventBridge Rule | `CriticalAlertRule` | Routes critical alerts to SNS |
| EventBridge Rule | `WarningAlertRule` | Routes warning alerts to SNS |
| EventBridge Rule | `InfoAlertRule` | Routes info alerts to SNS |

## Alert Severities

| Severity | Trigger | Example |
|----------|---------|---------|
| **Critical** | Health score < 50 | Student with 0 sessions + 8 IB calls |
| **Warning** | Health score 50-70 OR 3+ IB calls | Student with 4 IB calls in 14 days |
| **Info** | Supply/demand updates | High demand detected for Math |

## File Locations

```
/lambda/alert/
  ├── format-alert.ts         # Email formatter
  ├── package.json            # Dependencies
  ├── tsconfig.json           # TypeScript config
  └── dist/
      └── format-alert.js     # Compiled output

/scripts/
  └── test-alerts.sh          # Test script (executable)

/cdk/lib/
  └── cdk-stack.ts            # Infrastructure (395 lines)

/docs/
  ├── PR-07-DEPLOYMENT-GUIDE.md       # Full deployment guide
  ├── PR-07-IMPLEMENTATION-SUMMARY.md # Implementation details
  └── PR-07-QUICK-REFERENCE.md        # This file
```

## Common Commands

### Get Topic ARNs
```bash
aws cloudformation describe-stacks \
  --stack-name IOpsDashboard-CdkStack \
  --query 'Stacks[0].Outputs[?contains(OutputKey, `AlertTopicArn`)]'
```

### Check DLQ
```bash
DLQ_URL=$(aws cloudformation describe-stacks \
  --stack-name IOpsDashboard-CdkStack \
  --query 'Stacks[0].Outputs[?OutputKey==`AlertDLQUrl`].OutputValue' \
  --output text)

aws sqs get-queue-attributes \
  --queue-url $DLQ_URL \
  --attribute-names ApproximateNumberOfMessages
```

### Monitor EventBridge
```bash
aws events list-rules --event-bus-name iops-dashboard-alerts
```

### View Processing Lambda Logs
```bash
aws logs tail /aws/lambda/IOpsDashboard-CdkStack-ProcessFunction --follow
```

## Alert Email Format

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IOps Dashboard Alert
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚨 Severity: CRITICAL
📋 Alert Type: low_health_score
🆔 Entity: stu_9999 (student)
⏰ Timestamp: 2025-11-04 20:35:04

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📄 Summary:
Student stu_9999 has critically low health score

🎯 Risk Score: 95/100

💡 AI Analysis:
Zero sessions in 7 days combined with 8 IB calls
indicates extreme churn risk.

📊 Details:
  • health_score: 35
  • sessions_7d: 0
  • ib_calls_14d: 8

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Recommended Actions:
  1. Immediate outreach from customer success team
  2. Offer free session with senior tutor
  3. Investigate root cause of IB call frequency

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔗 Dashboard: https://your-dashboard-url.com/alerts/stu_9999

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| No emails received | Check spam folder, verify SNS subscription confirmed |
| Messages in DLQ | Check CloudWatch Logs for SNS publish errors |
| Too many emails | Adjust thresholds in `lambda/process/handler.py` |
| Wrong event bus | Verify `EVENT_BUS_NAME` in Processing Lambda |

## Environment Variables

```bash
# Required before deployment
CRITICAL_ALERT_EMAILS="ops-critical@example.com,oncall@example.com"
WARNING_ALERT_EMAILS="ops-team@example.com"
INFO_ALERT_EMAILS="product-team@example.com"
```

## Cost Estimate

- **Monthly**: ~$0.51 (500 events/min, 2-5% anomaly rate)
- **SNS**: $0.50 per 1M notifications
- **EventBridge**: Free (under 90M events/month)
- **SQS**: $0.01 for DLQ

## Integration Points

| Component | Integration |
|-----------|-------------|
| Processing Lambda | Generates alerts via `detect_anomalies()` |
| AI Lambda | Can generate enriched alerts with explanations |
| EventBridge Bus | Receives alerts from Lambdas |
| SNS Topics | Delivers formatted emails |
| DLQ | Captures failed deliveries |

## Next Steps

1. ✅ Deploy to AWS
2. ✅ Confirm email subscriptions
3. ✅ Test with test script
4. ⏳ Enable simulator for live testing
5. ⏳ Monitor CloudWatch metrics
6. ⏳ Review alert fatigue
7. ⏳ Adjust thresholds if needed

## Support

- **Deployment Guide**: `/docs/PR-07-DEPLOYMENT-GUIDE.md`
- **Implementation Details**: `/docs/PR-07-IMPLEMENTATION-SUMMARY.md`
- **Original PR Doc**: `/docs/PR-07-EventBridge-SNS-Alerts.md`

---

**Status**: ✅ Ready for Deployment
**Time to Deploy**: 15-20 minutes
**Prerequisites**: AWS account, configured credentials, valid email addresses
