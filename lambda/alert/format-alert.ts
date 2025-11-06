import { SNSEvent, SNSEventRecord } from 'aws-lambda';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

const snsClient = new SNSClient({ region: process.env.AWS_REGION });

interface Alert {
  alert_type: string;
  severity: string;
  entity_id: string;
  entity_type: string;
  details: Record<string, any>;
  message: string;
  timestamp: string;
  explanation?: string;
  risk_score?: number;
  recommendations?: string[];
}

function formatAlertEmail(alert: Alert): { subject: string; body: string } {
  const emoji = alert.severity === 'critical' ? '🚨' : alert.severity === 'warning' ? '⚠️' : 'ℹ️';

  let subject = `${emoji} ${alert.severity.toUpperCase()}: ${alert.alert_type}`;

  let body = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IOps Dashboard Alert
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${emoji} Severity: ${alert.severity.toUpperCase()}
📋 Alert Type: ${alert.alert_type}
🆔 Entity: ${alert.entity_id} (${alert.entity_type})
⏰ Timestamp: ${new Date(alert.timestamp).toLocaleString()}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📄 Summary:
${alert.message}

${alert.risk_score ? `🎯 Risk Score: ${alert.risk_score}/100\n` : ''}
${alert.explanation ? `\n💡 AI Analysis:\n${alert.explanation}\n` : ''}

📊 Details:
${Object.entries(alert.details)
  .map(([key, value]) => `  • ${key}: ${value}`)
  .join('\n')}

${alert.recommendations && alert.recommendations.length > 0 ? `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Recommended Actions:
${alert.recommendations.map((rec, i) => `  ${i + 1}. ${rec}`).join('\n')}
` : ''}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔗 Dashboard: https://your-dashboard-url.com/alerts/${alert.entity_id}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`.trim();

  return { subject, body };
}

export const handler = async (event: SNSEvent): Promise<void> => {
  console.log('Formatting alerts for SNS:', JSON.stringify(event, null, 2));

  for (const record of event.Records) {
    try {
      const alert: Alert = JSON.parse(record.Sns.Message);
      const { subject, body } = formatAlertEmail(alert);

      console.log('Formatted alert:', subject);

      // Note: In production, this would publish to final SNS topic
      // For now, we'll just log it
      console.log(body);

    } catch (error) {
      console.error('Error formatting alert:', error);
    }
  }
};
