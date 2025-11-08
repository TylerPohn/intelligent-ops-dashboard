#!/usr/bin/env ts-node
/**
 * Generate Mock Insights for UI Testing
 * Writes properly formatted insight records directly to DynamoDB
 * Bypasses the broken AI Lambda
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({ region: 'us-east-2' });
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = 'iops-dashboard-metrics';

interface Insight {
  entity_id: string;
  entity_type: string;
  timestamp: string;
  prediction_type: string;
  risk_score: number;
  explanation: string;
  recommendations: string[];
  model_used: string;
  confidence: number;
  related_entity?: string;
  ttl: number;
}

const PREDICTION_TYPES = [
  'customer_health',
  'churn_risk',
  'session_quality',
  'marketplace_balance',
  'tutor_capacity',
  'first_session_success'
];

const CUSTOMER_SEGMENTS = ['thriving', 'healthy', 'at_risk', 'churned'];

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

function generateCustomerHealthInsight(): Insight {
  const customerId = `cust_${randomInt(1000, 9999).toString().padStart(6, '0')}`;
  const segment = randomChoice(CUSTOMER_SEGMENTS);
  const healthScore = segment === 'thriving' ? randomInt(80, 100) :
                      segment === 'healthy' ? randomInt(60, 79) :
                      segment === 'at_risk' ? randomInt(40, 59) :
                      randomInt(0, 39);

  const riskScore = 100 - healthScore;
  const churnRisk = segment === 'churned' ? 0.95 :
                   segment === 'at_risk' ? randomInt(45, 75) / 100 :
                   segment === 'healthy' ? randomInt(10, 30) / 100 :
                   randomInt(5, 15) / 100;

  const sessionVelocity = segment === 'thriving' ? randomInt(15, 30) / 10 :
                          segment === 'healthy' ? randomInt(8, 20) / 10 :
                          segment === 'at_risk' ? randomInt(2, 8) / 10 :
                          0;

  const recommendations = [
    `Health Score: ${healthScore}/100`,
    `Segment: ${segment}`,
    `Churn Risk (14d): ${(churnRisk * 100).toFixed(0)}%`,
    `Session Velocity: ${sessionVelocity.toFixed(1)} sessions/week`,
  ];

  if (segment === 'at_risk') {
    recommendations.push('⚠️ Immediate outreach recommended');
  } else if (segment === 'churned') {
    recommendations.push('❌ Re-engagement campaign needed');
  }

  return {
    entity_id: `insight_${Date.now()}_${randomInt(1000, 9999)}`,
    entity_type: 'insight',
    timestamp: new Date().toISOString(),
    prediction_type: 'customer_health',
    risk_score: riskScore,
    explanation: `Customer ${customerId} has ${healthScore}/100 health score (${segment} segment)`,
    recommendations,
    model_used: 'mock_generator_v1',
    confidence: randomInt(75, 95) / 100,
    related_entity: customerId,
    ttl: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60), // 30 days
  };
}

function generateChurnRiskInsight(): Insight {
  const customerId = `cust_${randomInt(1000, 9999).toString().padStart(6, '0')}`;
  const churnProb = randomInt(50, 95) / 100;
  const daysSinceLastSession = randomInt(14, 45);
  const ibCalls = randomInt(2, 8);

  return {
    entity_id: `insight_${Date.now()}_${randomInt(1000, 9999)}`,
    entity_type: 'insight',
    timestamp: new Date().toISOString(),
    prediction_type: 'churn_risk',
    risk_score: Math.round(churnProb * 100),
    explanation: `Customer ${customerId} has ${(churnProb * 100).toFixed(0)}% churn probability in next 14 days`,
    recommendations: [
      `Days since last session: ${daysSinceLastSession}`,
      `IB calls (14d): ${ibCalls}`,
      `Churn Probability: ${(churnProb * 100).toFixed(0)}%`,
      '🚨 High churn risk - prioritize retention',
    ],
    model_used: 'mock_generator_v1',
    confidence: randomInt(70, 90) / 100,
    related_entity: customerId,
    ttl: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60),
  };
}

function generateSessionQualityInsight(): Insight {
  const sessionId = `session_${Date.now()}_${randomInt(100, 999)}`;
  const rating = randomInt(25, 50) / 10;
  const duration = randomInt(20, 90);
  const wasCancelled = Math.random() < 0.15;
  const riskScore = wasCancelled ? 85 : rating < 3.0 ? 70 : rating < 4.0 ? 40 : 20;

  return {
    entity_id: `insight_${Date.now()}_${randomInt(1000, 9999)}`,
    entity_type: 'insight',
    timestamp: new Date().toISOString(),
    prediction_type: 'session_quality',
    risk_score: riskScore,
    explanation: `Session ${sessionId}: ${rating}/5.0 rating, ${duration} minutes${wasCancelled ? ' (CANCELLED)' : ''}`,
    recommendations: [
      `Rating: ${rating}/5.0`,
      `Duration: ${duration} minutes`,
      `Status: ${wasCancelled ? 'Cancelled' : 'Completed'}`,
      riskScore > 60 ? '⚠️ Poor session quality detected' : '✓ Session quality acceptable',
    ],
    model_used: 'mock_generator_v1',
    confidence: 0.85,
    related_entity: sessionId,
    ttl: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60),
  };
}

function generateMarketplaceBalanceInsight(): Insight {
  const subject = randomChoice(['algebra_1', 'algebra_2', 'ap_calculus', 'ap_physics', 'spanish', 'french']);
  const availableTutors = randomInt(5, 50);
  const pendingRequests = randomInt(5, 40);
  const ratio = availableTutors / pendingRequests;
  const riskScore = ratio < 0.5 ? 85 : ratio < 0.8 ? 60 : ratio < 1.2 ? 30 : 15;

  return {
    entity_id: `insight_${Date.now()}_${randomInt(1000, 9999)}`,
    entity_type: 'insight',
    timestamp: new Date().toISOString(),
    prediction_type: 'marketplace_balance',
    risk_score: riskScore,
    explanation: `${subject}: ${availableTutors} tutors available, ${pendingRequests} pending requests (${ratio.toFixed(2)} ratio)`,
    recommendations: [
      `Available Tutors: ${availableTutors}`,
      `Pending Requests: ${pendingRequests}`,
      `Supply/Demand Ratio: ${ratio.toFixed(2)}`,
      ratio < 0.8 ? '🚨 Tutor shortage - recruit more tutors' : '✓ Supply adequate',
    ],
    model_used: 'mock_generator_v1',
    confidence: 0.90,
    related_entity: subject,
    ttl: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60),
  };
}

function generateTutorCapacityInsight(): Insight {
  const tutorId = `tutor_${randomInt(100, 999).toString().padStart(5, '0')}`;
  const availableSlots = randomInt(0, 30);
  const rating = randomInt(35, 50) / 10;
  const riskScore = availableSlots < 5 ? 75 : availableSlots < 10 ? 50 : 20;

  return {
    entity_id: `insight_${Date.now()}_${randomInt(1000, 9999)}`,
    entity_type: 'insight',
    timestamp: new Date().toISOString(),
    prediction_type: 'tutor_capacity',
    risk_score: riskScore,
    explanation: `Tutor ${tutorId}: ${availableSlots} slots available this week (${rating}/5.0 rating)`,
    recommendations: [
      `Available Slots: ${availableSlots}`,
      `Tutor Rating: ${rating}/5.0`,
      availableSlots < 5 ? '⚠️ Low availability - may need backup' : '✓ Adequate availability',
    ],
    model_used: 'mock_generator_v1',
    confidence: 0.82,
    related_entity: tutorId,
    ttl: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60),
  };
}

function generateFirstSessionSuccessInsight(): Insight {
  const customerId = `cust_${randomInt(1000, 9999).toString().padStart(6, '0')}`;
  const successProb = randomInt(30, 95) / 100;
  const riskScore = Math.round((1 - successProb) * 100);

  return {
    entity_id: `insight_${Date.now()}_${randomInt(1000, 9999)}`,
    entity_type: 'insight',
    timestamp: new Date().toISOString(),
    prediction_type: 'first_session_success',
    risk_score: riskScore,
    explanation: `Customer ${customerId}: ${(successProb * 100).toFixed(0)}% predicted first session success`,
    recommendations: [
      `Success Probability: ${(successProb * 100).toFixed(0)}%`,
      successProb < 0.5 ? '⚠️ Low success probability - assign top-rated tutor' : '✓ Good success probability',
      'Ensure tutor onboarding is complete',
    ],
    model_used: 'mock_generator_v1',
    confidence: 0.78,
    related_entity: customerId,
    ttl: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60),
  };
}

async function generateInsight(): Promise<Insight> {
  const generators = [
    generateCustomerHealthInsight,
    generateChurnRiskInsight,
    generateSessionQualityInsight,
    generateMarketplaceBalanceInsight,
    generateTutorCapacityInsight,
    generateFirstSessionSuccessInsight,
  ];

  const generator = randomChoice(generators);
  return generator();
}

async function writeInsightToDynamoDB(insight: Insight): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: insight,
    })
  );
}

async function main() {
  const count = parseInt(process.argv[2] || '20', 10);

  console.log(`🚀 Generating ${count} mock insights...`);
  console.log(`📊 Table: ${TABLE_NAME}`);
  console.log(`🌍 Region: us-east-2\n`);

  for (let i = 0; i < count; i++) {
    const insight = await generateInsight();
    await writeInsightToDynamoDB(insight);

    const riskEmoji = insight.risk_score >= 70 ? '🔴' : insight.risk_score >= 40 ? '🟡' : '🟢';
    console.log(`[${i + 1}/${count}] ${riskEmoji} ${insight.prediction_type} (risk: ${insight.risk_score})`);

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log(`\n✅ Generated ${count} mock insights!`);
  console.log('\n📋 Insight Types Generated:');
  console.log('  - customer_health: Overall customer health scores');
  console.log('  - churn_risk: 14-day churn predictions');
  console.log('  - session_quality: Session ratings and quality');
  console.log('  - marketplace_balance: Supply/demand ratios');
  console.log('  - tutor_capacity: Tutor availability');
  console.log('  - first_session_success: New customer predictions');
  console.log('\n🌐 View in UI: Your dashboard should now show these insights');
}

main().catch(console.error);
