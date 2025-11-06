# PR-12: Email Integration

## Overview
This PR has been largely covered in PR-07 (EventBridge Rules + SNS Alerts). This document provides additional enhancements.

## Additional Enhancements

### 1. HTML Email Templates
Create rich HTML emails instead of plain text.

**File:** `lambda/alert/email-template.ts`

```typescript
export function generateHTMLEmail(alert: any): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; }
    .container { max-width: 600px; margin: 0 auto; }
    .header { background: #dc2626; color: white; padding: 20px; }
    .content { padding: 20px; background: #f9fafb; }
    .risk-score { font-size: 48px; font-weight: bold; color: #dc2626; }
    .recommendations { background: white; padding: 15px; margin: 10px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🚨 ${alert.severity.toUpperCase()} Alert</h1>
    </div>
    <div class="content">
      <h2>${alert.alert_type}</h2>
      <p><strong>Entity:</strong> ${alert.entity_id}</p>
      <div class="risk-score">${alert.risk_score || 'N/A'}</div>
      <p>${alert.explanation || alert.message}</p>
      <div class="recommendations">
        <h3>Recommended Actions:</h3>
        ${alert.recommendations?.map((r: string) => `<li>${r}</li>`).join('') || ''}
      </div>
      <p><a href="https://dashboard.yourcompany.com/alerts/${alert.entity_id}">View in Dashboard →</a></p>
    </div>
  </div>
</body>
</html>
  `;
}
```

### 2. Digest Emails
Send daily/weekly digests instead of individual emails for low-severity alerts.

```typescript
// Schedule with EventBridge to run daily
export async function sendDailyDigest() {
  const insights = await getInsightsFromLast24Hours();

  const digest = `
    <h2>Daily Operations Digest</h2>
    <p>Total Alerts: ${insights.length}</p>
    <ul>
      ${insights.map(i => `<li>${i.entity_id}: ${i.explanation}</li>`).join('')}
    </ul>
  `;

  await sns.publish({ Message: digest });
}
```

## Estimated Time: 30 minutes
