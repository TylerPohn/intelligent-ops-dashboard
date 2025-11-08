/**
 * Training Data Generator for Tutor Marketplace Health Model
 *
 * Generates realistic synthetic data for 6 prediction tasks:
 * 1. First session success probability
 * 2. Session velocity (sessions/week)
 * 3. Churn risk (14-day)
 * 4. Churn risk (30-day)
 * 5. Supply/demand scores by subject
 * 6. Customer health score (0-100)
 */

import * as fs from 'fs';
import * as path from 'path';

// Configuration
const CONFIG = {
  NUM_CUSTOMERS: 10000,
  NUM_SUBJECTS: 20,
  SUBJECTS: [
    'algebra_1', 'algebra_2', 'geometry', 'precalculus', 'ap_calculus',
    'ap_physics', 'ap_chemistry', 'ap_biology',
    'spanish', 'french', 'english', 'history',
    'sat_prep', 'act_prep', 'ap_statistics',
    'computer_science', 'economics', 'psychology',
    'elementary_math', 'middle_school_science'
  ],
  TIERS: ['budget', 'standard', 'premium'],
  ACQUISITION_CHANNELS: ['organic', 'paid_google', 'paid_facebook', 'referral'],
  GRADE_LEVELS: ['elementary', 'middle_school', 'high_school', 'college'],
};

// Customer segment definitions (realistic marketplace distribution)
const SEGMENTS = {
  thriving: {
    probability: 0.30,
    patterns: {
      session_frequency: { mean: 2.5, std: 0.5 },
      avg_rating: { mean: 4.5, std: 0.3 },
      ib_calls_14d: { lambda: 0.2 },
      days_since_last_session: { min: 1, max: 4 },
      payment_success_rate: { min: 0.95, max: 1.0 },
      login_frequency: { mean: 8, std: 2 },
      tutor_consistency: { min: 0.8, max: 1.0 },
      first_session_success: 0.85,
      churn_risk_14d: 0.05,
      churn_risk_30d: 0.08,
      health_score: { min: 80, max: 100 },
    }
  },
  healthy: {
    probability: 0.40,
    patterns: {
      session_frequency: { mean: 1.5, std: 0.5 },
      avg_rating: { mean: 4.0, std: 0.4 },
      ib_calls_14d: { lambda: 0.5 },
      days_since_last_session: { min: 3, max: 8 },
      payment_success_rate: { min: 0.90, max: 0.98 },
      login_frequency: { mean: 5, std: 2 },
      tutor_consistency: { min: 0.6, max: 0.9 },
      first_session_success: 0.75,
      churn_risk_14d: 0.12,
      churn_risk_30d: 0.20,
      health_score: { min: 60, max: 79 },
    }
  },
  at_risk: {
    probability: 0.20,
    patterns: {
      session_frequency: { mean: 0.5, std: 0.3 },
      avg_rating: { mean: 3.5, std: 0.5 },
      ib_calls_14d: { lambda: 1.5 },
      days_since_last_session: { min: 10, max: 20 },
      payment_success_rate: { min: 0.70, max: 0.90 },
      login_frequency: { mean: 2, std: 1 },
      tutor_consistency: { min: 0.3, max: 0.7 },
      first_session_success: 0.50,
      churn_risk_14d: 0.45,
      churn_risk_30d: 0.65,
      health_score: { min: 40, max: 59 },
    }
  },
  churned: {
    probability: 0.10,
    patterns: {
      session_frequency: { mean: 0, std: 0 },
      avg_rating: { mean: 3.0, std: 0.6 },
      ib_calls_14d: { lambda: 2.5 },
      days_since_last_session: { min: 25, max: 60 },
      payment_success_rate: { min: 0.40, max: 0.70 },
      login_frequency: { mean: 0, std: 0 },
      tutor_consistency: { min: 0.1, max: 0.5 },
      first_session_success: 0.30,
      churn_risk_14d: 0.85,
      churn_risk_30d: 0.95,
      health_score: { min: 0, max: 39 },
    }
  }
};

interface CustomerRecord {
  customer_id: string;
  segment: string;

  // Time-window features (7d, 14d, 30d)
  session_count_7d: number;
  session_count_14d: number;
  session_count_30d: number;
  session_frequency_7d: number;
  session_frequency_14d: number;
  session_frequency_30d: number;
  avg_rating_7d: number;
  avg_rating_14d: number;
  avg_rating_30d: number;
  cancellation_rate_7d: number;
  cancellation_rate_14d: number;
  cancellation_rate_30d: number;

  // IB call metrics
  ib_call_count_7d: number;
  ib_call_count_14d: number;
  ib_call_count_30d: number;
  negative_calls_7d: number;
  negative_calls_14d: number;
  negative_calls_30d: number;

  // Recency features
  days_since_last_session: number;
  days_since_last_login: number;
  days_since_last_payment: number;
  days_since_last_ib_call: number;

  // Lifetime features
  customer_tenure_days: number;
  total_sessions_lifetime: number;
  total_spend_lifetime: number;
  subscription_tier: number; // 0=budget, 1=standard, 2=premium
  acquisition_channel: number; // 0=organic, 1=paid_google, 2=paid_facebook, 3=referral
  grade_level: number; // 0=elementary, 1=middle, 2=high, 3=college

  // Engagement features
  login_count_7d: number;
  login_count_14d: number;
  login_count_30d: number;
  message_count_7d: number;
  message_count_14d: number;
  message_count_30d: number;

  // Payment features
  payment_success_rate_7d: number;
  payment_success_rate_14d: number;
  payment_success_rate_30d: number;

  // Tutor consistency
  tutor_consistency_score: number;
  primary_tutor_rating: number;
  tutor_switch_count_30d: number;
  avg_tutor_response_time_hours: number;

  // First session
  first_session_was_success: number; // 0 or 1

  // Trend features
  session_velocity_change: number;
  rating_trend: number;
  engagement_trend: number;

  // Subject
  primary_subject: number; // Index into SUBJECTS array

  // TARGET LABELS
  label_first_session_success: number;
  label_session_velocity: number;
  label_churn_risk_14d: number;
  label_churn_risk_30d: number;
  label_health_score: number;
}

// Helper functions
function randomNormal(mean: number, std: number): number {
  // Box-Muller transform
  const u1 = Math.random();
  const u2 = Math.random();
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return z0 * std + mean;
}

function randomPoisson(lambda: number): number {
  let L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= Math.random();
  } while (p > L);
  return k - 1;
}

function randomUniform(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function selectSegment(): string {
  const rand = Math.random();
  let cumProb = 0;
  for (const [segment, config] of Object.entries(SEGMENTS)) {
    cumProb += config.probability;
    if (rand <= cumProb) return segment;
  }
  return 'healthy'; // fallback
}

function generateCustomer(index: number): CustomerRecord {
  const segment = selectSegment();
  const patterns = SEGMENTS[segment as keyof typeof SEGMENTS].patterns;

  // Generate base patterns
  const sessionFreq = Math.max(0, randomNormal(patterns.session_frequency.mean, patterns.session_frequency.std));
  const avgRating = clamp(randomNormal(patterns.avg_rating.mean, patterns.avg_rating.std), 1, 5);
  const ibCalls14d = randomPoisson(patterns.ib_calls_14d.lambda);
  const daysSinceLastSession = randomInt(patterns.days_since_last_session.min, patterns.days_since_last_session.max);
  const paymentSuccessRate = randomUniform(patterns.payment_success_rate.min, patterns.payment_success_rate.max);
  const loginFreq = Math.max(0, randomNormal(patterns.login_frequency.mean, patterns.login_frequency.std));
  const tutorConsistency = randomUniform(patterns.tutor_consistency.min, patterns.tutor_consistency.max);

  // Subscription tier (premium more likely in thriving segment)
  let tierProbs: number[];
  if (segment === 'thriving') {
    tierProbs = [0.1, 0.3, 0.6]; // budget, standard, premium
  } else if (segment === 'healthy') {
    tierProbs = [0.2, 0.5, 0.3];
  } else {
    tierProbs = [0.4, 0.4, 0.2];
  }
  const tierRand = Math.random();
  let tier = 0;
  let cumProb = 0;
  for (let i = 0; i < tierProbs.length; i++) {
    cumProb += tierProbs[i];
    if (tierRand <= cumProb) {
      tier = i;
      break;
    }
  }

  const acquisitionChannel = randomInt(0, CONFIG.ACQUISITION_CHANNELS.length - 1);
  const gradeLevel = randomInt(0, CONFIG.GRADE_LEVELS.length - 1);
  const primarySubject = randomInt(0, CONFIG.SUBJECTS.length - 1);

  // Tenure (longer tenure = lower churn typically)
  const tenureDays = segment === 'churned' ? randomInt(30, 90) : randomInt(30, 365);

  // Calculate time-window features
  const sessionCount7d = Math.round(sessionFreq * 7);
  const sessionCount14d = Math.round(sessionFreq * 14);
  const sessionCount30d = Math.round(sessionFreq * 30);

  const totalSessionsLifetime = Math.round(sessionFreq * tenureDays / 7);
  const totalSpendLifetime = totalSessionsLifetime * (60 + tier * 30); // $60-120 per session

  // IB calls
  const ibCalls7d = Math.max(0, Math.round(ibCalls14d * 0.5));
  const ibCalls30d = Math.max(0, Math.round(ibCalls14d * 2));
  const negativeCalls14d = Math.round(ibCalls14d * 0.6); // 60% of calls are negative

  // Engagement
  const loginCount7d = Math.round(loginFreq);
  const loginCount14d = Math.round(loginFreq * 2);
  const loginCount30d = Math.round(loginFreq * 4);

  const messageCount7d = randomPoisson(sessionFreq * 2); // ~2 messages per session
  const messageCount14d = randomPoisson(sessionFreq * 4);
  const messageCount30d = randomPoisson(sessionFreq * 8);

  // Tutor features
  const primaryTutorRating = randomUniform(3.5, 5.0);
  const tutorSwitchCount = segment === 'at_risk' ? randomInt(2, 5) : randomInt(0, 2);
  const avgTutorResponseTime = segment === 'at_risk' ? randomUniform(4, 12) : randomUniform(1, 6);

  // First session success
  const firstSessionSuccess = Math.random() < patterns.first_session_success ? 1 : 0;

  // Trend features (comparing windows)
  const sessionVelocityChange = (sessionCount7d / 7) - (sessionCount30d / 30);
  const ratingTrend = avgRating - randomNormal(avgRating, 0.2); // slight variation
  const engagementTrend = loginCount7d - (loginCount14d / 2);

  // Cancellation rates
  const cancellationRate = segment === 'at_risk' ? randomUniform(0.15, 0.30) : randomUniform(0.02, 0.10);

  // Days since events
  const daysSinceLogin = daysSinceLastSession + randomInt(0, 3);
  const daysSincePayment = randomInt(1, 30);
  const daysSinceIbCall = ibCalls14d > 0 ? randomInt(1, 14) : 999;

  // TARGET LABELS
  const labelFirstSessionSuccess = firstSessionSuccess;
  const labelSessionVelocity = sessionFreq;
  const labelChurnRisk14d = patterns.churn_risk_14d;
  const labelChurnRisk30d = patterns.churn_risk_30d;
  const labelHealthScore = randomUniform(patterns.health_score.min, patterns.health_score.max);

  return {
    customer_id: `cust_${index.toString().padStart(6, '0')}`,
    segment,

    // Time-window features
    session_count_7d: sessionCount7d,
    session_count_14d: sessionCount14d,
    session_count_30d: sessionCount30d,
    session_frequency_7d: sessionFreq,
    session_frequency_14d: sessionFreq,
    session_frequency_30d: sessionFreq,
    avg_rating_7d: avgRating,
    avg_rating_14d: avgRating,
    avg_rating_30d: avgRating,
    cancellation_rate_7d: cancellationRate,
    cancellation_rate_14d: cancellationRate,
    cancellation_rate_30d: cancellationRate,

    // IB calls
    ib_call_count_7d: ibCalls7d,
    ib_call_count_14d: ibCalls14d,
    ib_call_count_30d: ibCalls30d,
    negative_calls_7d: Math.round(ibCalls7d * 0.6),
    negative_calls_14d: negativeCalls14d,
    negative_calls_30d: Math.round(ibCalls30d * 0.6),

    // Recency
    days_since_last_session: daysSinceLastSession,
    days_since_last_login: daysSinceLogin,
    days_since_last_payment: daysSincePayment,
    days_since_last_ib_call: daysSinceIbCall,

    // Lifetime
    customer_tenure_days: tenureDays,
    total_sessions_lifetime: totalSessionsLifetime,
    total_spend_lifetime: totalSpendLifetime,
    subscription_tier: tier,
    acquisition_channel: acquisitionChannel,
    grade_level: gradeLevel,

    // Engagement
    login_count_7d: loginCount7d,
    login_count_14d: loginCount14d,
    login_count_30d: loginCount30d,
    message_count_7d: messageCount7d,
    message_count_14d: messageCount14d,
    message_count_30d: messageCount30d,

    // Payment
    payment_success_rate_7d: paymentSuccessRate,
    payment_success_rate_14d: paymentSuccessRate,
    payment_success_rate_30d: paymentSuccessRate,

    // Tutor
    tutor_consistency_score: tutorConsistency,
    primary_tutor_rating: primaryTutorRating,
    tutor_switch_count_30d: tutorSwitchCount,
    avg_tutor_response_time_hours: avgTutorResponseTime,

    // First session
    first_session_was_success: firstSessionSuccess,

    // Trends
    session_velocity_change: sessionVelocityChange,
    rating_trend: ratingTrend,
    engagement_trend: engagementTrend,

    // Subject
    primary_subject: primarySubject,

    // TARGET LABELS
    label_first_session_success: labelFirstSessionSuccess,
    label_session_velocity: labelSessionVelocity,
    label_churn_risk_14d: labelChurnRisk14d,
    label_churn_risk_30d: labelChurnRisk30d,
    label_health_score: labelHealthScore,
  };
}

function generateDataset(numCustomers: number): CustomerRecord[] {
  const dataset: CustomerRecord[] = [];

  console.log(`Generating ${numCustomers} customer records...`);

  for (let i = 0; i < numCustomers; i++) {
    dataset.push(generateCustomer(i));

    if ((i + 1) % 1000 === 0) {
      console.log(`Generated ${i + 1}/${numCustomers} records...`);
    }
  }

  return dataset;
}

function splitDataset(dataset: CustomerRecord[]) {
  // Shuffle dataset
  const shuffled = [...dataset].sort(() => Math.random() - 0.5);

  // 70% train, 15% validation, 15% test
  const trainSize = Math.floor(shuffled.length * 0.7);
  const valSize = Math.floor(shuffled.length * 0.15);

  return {
    train: shuffled.slice(0, trainSize),
    validation: shuffled.slice(trainSize, trainSize + valSize),
    test: shuffled.slice(trainSize + valSize),
  };
}

function saveDataset(dataset: CustomerRecord[], filename: string) {
  const outputPath = path.join(__dirname, '..', 'data', filename);

  // Ensure directory exists
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Save as JSONL (one JSON object per line - standard for ML)
  const lines = dataset.map(record => JSON.stringify(record)).join('\n');
  fs.writeFileSync(outputPath, lines);

  console.log(`Saved ${dataset.length} records to ${outputPath}`);
}

function saveAsCSV(dataset: CustomerRecord[], filename: string) {
  const outputPath = path.join(__dirname, '..', 'data', filename);

  // Get headers (all keys except customer_id and segment)
  const headers = Object.keys(dataset[0]).filter(k => k !== 'customer_id' && k !== 'segment');

  // CSV header row
  const headerRow = headers.join(',');

  // CSV data rows
  const dataRows = dataset.map(record => {
    return headers.map(key => record[key as keyof CustomerRecord]).join(',');
  });

  const csv = [headerRow, ...dataRows].join('\n');
  fs.writeFileSync(outputPath, csv);

  console.log(`Saved CSV to ${outputPath}`);
}

function printDatasetStats(dataset: CustomerRecord[]) {
  console.log('\n=== Dataset Statistics ===\n');

  // Segment distribution
  const segmentCounts: Record<string, number> = {};
  dataset.forEach(record => {
    segmentCounts[record.segment] = (segmentCounts[record.segment] || 0) + 1;
  });

  console.log('Segment Distribution:');
  Object.entries(segmentCounts).forEach(([segment, count]) => {
    const pct = (count / dataset.length * 100).toFixed(1);
    console.log(`  ${segment}: ${count} (${pct}%)`);
  });

  // Feature statistics
  console.log('\nFeature Ranges:');
  console.log(`  Session Frequency: ${Math.min(...dataset.map(r => r.session_frequency_7d)).toFixed(2)} - ${Math.max(...dataset.map(r => r.session_frequency_7d)).toFixed(2)}`);
  console.log(`  Avg Rating: ${Math.min(...dataset.map(r => r.avg_rating_7d)).toFixed(2)} - ${Math.max(...dataset.map(r => r.avg_rating_7d)).toFixed(2)}`);
  console.log(`  IB Calls (14d): ${Math.min(...dataset.map(r => r.ib_call_count_14d))} - ${Math.max(...dataset.map(r => r.ib_call_count_14d))}`);
  console.log(`  Health Score: ${Math.min(...dataset.map(r => r.label_health_score)).toFixed(0)} - ${Math.max(...dataset.map(r => r.label_health_score)).toFixed(0)}`);

  // Label distributions
  console.log('\nLabel Statistics:');
  const firstSessionSuccessRate = dataset.filter(r => r.label_first_session_success === 1).length / dataset.length;
  const churnRate14d = dataset.filter(r => r.label_churn_risk_14d > 0.5).length / dataset.length;
  const churnRate30d = dataset.filter(r => r.label_churn_risk_30d > 0.5).length / dataset.length;

  console.log(`  First Session Success Rate: ${(firstSessionSuccessRate * 100).toFixed(1)}%`);
  console.log(`  High Churn Risk (14d): ${(churnRate14d * 100).toFixed(1)}%`);
  console.log(`  High Churn Risk (30d): ${(churnRate30d * 100).toFixed(1)}%`);
  console.log(`  Avg Health Score: ${(dataset.reduce((sum, r) => sum + r.label_health_score, 0) / dataset.length).toFixed(1)}`);
  console.log(`  Avg Session Velocity: ${(dataset.reduce((sum, r) => sum + r.label_session_velocity, 0) / dataset.length).toFixed(2)}`);
}

// Main execution
async function main() {
  console.log('=== Tutor Marketplace Training Data Generator ===\n');

  // Generate dataset
  const fullDataset = generateDataset(CONFIG.NUM_CUSTOMERS);

  // Print statistics
  printDatasetStats(fullDataset);

  // Split into train/val/test
  const splits = splitDataset(fullDataset);

  console.log('\n=== Dataset Splits ===');
  console.log(`Training: ${splits.train.length} records`);
  console.log(`Validation: ${splits.validation.length} records`);
  console.log(`Test: ${splits.test.length} records`);

  // Save datasets
  console.log('\n=== Saving Datasets ===\n');
  saveDataset(splits.train, 'train.jsonl');
  saveDataset(splits.validation, 'validation.jsonl');
  saveDataset(splits.test, 'test.jsonl');

  // Also save as CSV for easy inspection
  saveAsCSV(splits.train, 'train.csv');

  // Save full dataset
  saveDataset(fullDataset, 'full_dataset.jsonl');

  console.log('\n✅ Training data generation complete!');
  console.log('\nNext steps:');
  console.log('1. Review data/train.csv to verify data quality');
  console.log('2. Use data/train.jsonl for SageMaker training');
  console.log('3. Use data/validation.jsonl for hyperparameter tuning');
  console.log('4. Use data/test.jsonl for final model evaluation');
}

main().catch(console.error);
