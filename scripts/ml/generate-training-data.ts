#!/usr/bin/env ts-node

/**
 * Training Data Generation Script
 * Generates 10,000 realistic IOPS insights for ML training
 */

import { faker } from '@faker-js/faker';
import * as fs from 'fs';
import * as path from 'path';

interface TrainingInsight {
  timestamp: string;
  deviceId: string;
  volumeId: string;

  // IOPS Metrics
  read_iops: number;
  write_iops: number;
  total_iops: number;
  iops_variance: number;

  // Latency Metrics
  avg_latency: number;
  p95_latency: number;
  p99_latency: number;
  latency_spike_count: number;

  // Throughput Metrics
  bandwidth_mbps: number;
  throughput_variance: number;

  // Error Metrics
  error_rate: number;
  error_trend: number;

  // Time-Based
  hour_of_day: number;
  day_of_week: number;
  time_since_last_alert: number;

  // Access Patterns
  sequential_access_ratio: number;
  random_access_ratio: number;

  // Device Metrics
  queue_depth: number;
  io_size_avg: number;
  io_size_variance: number;

  // Labels
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  workload_type: 'sequential' | 'random' | 'mixed' | 'burst';
  anomaly_detected: boolean;
  performance_score: number;
}

function generateNormalOperations(): TrainingInsight {
  const timestamp = faker.date.recent({ days: 90 });
  const read_iops = faker.number.int({ min: 100, max: 500 });
  const write_iops = faker.number.int({ min: 50, max: 300 });
  const total_iops = read_iops + write_iops;

  return {
    timestamp: timestamp.toISOString(),
    deviceId: faker.string.alphanumeric(10),
    volumeId: `vol-${faker.string.alphanumeric(8)}`,

    // IOPS - Normal range
    read_iops,
    write_iops,
    total_iops,
    iops_variance: faker.number.float({ min: 5, max: 20, precision: 0.01 }),

    // Latency - Low and stable
    avg_latency: faker.number.float({ min: 2, max: 8, precision: 0.01 }),
    p95_latency: faker.number.float({ min: 8, max: 15, precision: 0.01 }),
    p99_latency: faker.number.float({ min: 15, max: 25, precision: 0.01 }),
    latency_spike_count: faker.number.int({ min: 0, max: 2 }),

    // Throughput - Steady
    bandwidth_mbps: faker.number.float({ min: 50, max: 200, precision: 0.01 }),
    throughput_variance: faker.number.float({ min: 2, max: 10, precision: 0.01 }),

    // Errors - Minimal
    error_rate: faker.number.float({ min: 0, max: 0.5, precision: 0.01 }),
    error_trend: faker.number.float({ min: -0.1, max: 0.1, precision: 0.01 }),

    // Time-based
    hour_of_day: timestamp.getHours(),
    day_of_week: timestamp.getDay(),
    time_since_last_alert: faker.number.int({ min: 10000, max: 100000 }),

    // Access Patterns
    sequential_access_ratio: faker.number.float({ min: 0.3, max: 0.7, precision: 0.01 }),
    random_access_ratio: faker.number.float({ min: 0.3, max: 0.7, precision: 0.01 }),

    // Device Metrics
    queue_depth: faker.number.int({ min: 1, max: 8 }),
    io_size_avg: faker.number.float({ min: 4, max: 64, precision: 0.01 }),
    io_size_variance: faker.number.float({ min: 1, max: 10, precision: 0.01 }),

    // Labels
    risk_level: 'low',
    workload_type: 'mixed',
    anomaly_detected: false,
    performance_score: faker.number.float({ min: 85, max: 100, precision: 0.01 })
  };
}

function generateMediumRisk(): TrainingInsight {
  const timestamp = faker.date.recent({ days: 90 });
  const read_iops = faker.number.int({ min: 500, max: 1500 });
  const write_iops = faker.number.int({ min: 300, max: 800 });
  const total_iops = read_iops + write_iops;

  return {
    timestamp: timestamp.toISOString(),
    deviceId: faker.string.alphanumeric(10),
    volumeId: `vol-${faker.string.alphanumeric(8)}`,

    // IOPS - Elevated
    read_iops,
    write_iops,
    total_iops,
    iops_variance: faker.number.float({ min: 20, max: 50, precision: 0.01 }),

    // Latency - Moderate increase
    avg_latency: faker.number.float({ min: 8, max: 20, precision: 0.01 }),
    p95_latency: faker.number.float({ min: 20, max: 40, precision: 0.01 }),
    p99_latency: faker.number.float({ min: 40, max: 70, precision: 0.01 }),
    latency_spike_count: faker.number.int({ min: 3, max: 8 }),

    // Throughput - Higher with variance
    bandwidth_mbps: faker.number.float({ min: 200, max: 500, precision: 0.01 }),
    throughput_variance: faker.number.float({ min: 10, max: 30, precision: 0.01 }),

    // Errors - Noticeable
    error_rate: faker.number.float({ min: 0.5, max: 2, precision: 0.01 }),
    error_trend: faker.number.float({ min: 0.1, max: 0.5, precision: 0.01 }),

    // Time-based
    hour_of_day: timestamp.getHours(),
    day_of_week: timestamp.getDay(),
    time_since_last_alert: faker.number.int({ min: 1000, max: 10000 }),

    // Access Patterns
    sequential_access_ratio: faker.number.float({ min: 0.2, max: 0.5, precision: 0.01 }),
    random_access_ratio: faker.number.float({ min: 0.5, max: 0.8, precision: 0.01 }),

    // Device Metrics
    queue_depth: faker.number.int({ min: 8, max: 32 }),
    io_size_avg: faker.number.float({ min: 8, max: 128, precision: 0.01 }),
    io_size_variance: faker.number.float({ min: 10, max: 30, precision: 0.01 }),

    // Labels
    risk_level: 'medium',
    workload_type: faker.helpers.arrayElement(['random', 'mixed', 'burst']),
    anomaly_detected: faker.datatype.boolean(),
    performance_score: faker.number.float({ min: 60, max: 85, precision: 0.01 })
  };
}

function generateHighRisk(): TrainingInsight {
  const timestamp = faker.date.recent({ days: 90 });
  const read_iops = faker.number.int({ min: 1500, max: 3000 });
  const write_iops = faker.number.int({ min: 800, max: 2000 });
  const total_iops = read_iops + write_iops;

  return {
    timestamp: timestamp.toISOString(),
    deviceId: faker.string.alphanumeric(10),
    volumeId: `vol-${faker.string.alphanumeric(8)}`,

    // IOPS - Very high
    read_iops,
    write_iops,
    total_iops,
    iops_variance: faker.number.float({ min: 50, max: 100, precision: 0.01 }),

    // Latency - High
    avg_latency: faker.number.float({ min: 20, max: 50, precision: 0.01 }),
    p95_latency: faker.number.float({ min: 50, max: 100, precision: 0.01 }),
    p99_latency: faker.number.float({ min: 100, max: 200, precision: 0.01 }),
    latency_spike_count: faker.number.int({ min: 10, max: 25 }),

    // Throughput - High variance
    bandwidth_mbps: faker.number.float({ min: 500, max: 1000, precision: 0.01 }),
    throughput_variance: faker.number.float({ min: 30, max: 70, precision: 0.01 }),

    // Errors - Concerning
    error_rate: faker.number.float({ min: 2, max: 5, precision: 0.01 }),
    error_trend: faker.number.float({ min: 0.5, max: 1.5, precision: 0.01 }),

    // Time-based
    hour_of_day: timestamp.getHours(),
    day_of_week: timestamp.getDay(),
    time_since_last_alert: faker.number.int({ min: 100, max: 1000 }),

    // Access Patterns
    sequential_access_ratio: faker.number.float({ min: 0.1, max: 0.3, precision: 0.01 }),
    random_access_ratio: faker.number.float({ min: 0.7, max: 0.9, precision: 0.01 }),

    // Device Metrics
    queue_depth: faker.number.int({ min: 32, max: 128 }),
    io_size_avg: faker.number.float({ min: 16, max: 256, precision: 0.01 }),
    io_size_variance: faker.number.float({ min: 30, max: 70, precision: 0.01 }),

    // Labels
    risk_level: 'high',
    workload_type: faker.helpers.arrayElement(['random', 'burst']),
    anomaly_detected: true,
    performance_score: faker.number.float({ min: 30, max: 60, precision: 0.01 })
  };
}

function generateCriticalRisk(): TrainingInsight {
  const timestamp = faker.date.recent({ days: 90 });
  const read_iops = faker.number.int({ min: 3000, max: 5000 });
  const write_iops = faker.number.int({ min: 2000, max: 4000 });
  const total_iops = read_iops + write_iops;

  return {
    timestamp: timestamp.toISOString(),
    deviceId: faker.string.alphanumeric(10),
    volumeId: `vol-${faker.string.alphanumeric(8)}`,

    // IOPS - Critical
    read_iops,
    write_iops,
    total_iops,
    iops_variance: faker.number.float({ min: 100, max: 200, precision: 0.01 }),

    // Latency - Critical
    avg_latency: faker.number.float({ min: 50, max: 150, precision: 0.01 }),
    p95_latency: faker.number.float({ min: 100, max: 250, precision: 0.01 }),
    p99_latency: faker.number.float({ min: 250, max: 500, precision: 0.01 }),
    latency_spike_count: faker.number.int({ min: 25, max: 50 }),

    // Throughput - Maxed out
    bandwidth_mbps: faker.number.float({ min: 1000, max: 2000, precision: 0.01 }),
    throughput_variance: faker.number.float({ min: 70, max: 150, precision: 0.01 }),

    // Errors - Severe
    error_rate: faker.number.float({ min: 5, max: 15, precision: 0.01 }),
    error_trend: faker.number.float({ min: 1.5, max: 5, precision: 0.01 }),

    // Time-based
    hour_of_day: timestamp.getHours(),
    day_of_week: timestamp.getDay(),
    time_since_last_alert: faker.number.int({ min: 0, max: 100 }),

    // Access Patterns
    sequential_access_ratio: faker.number.float({ min: 0, max: 0.2, precision: 0.01 }),
    random_access_ratio: faker.number.float({ min: 0.8, max: 1, precision: 0.01 }),

    // Device Metrics
    queue_depth: faker.number.int({ min: 128, max: 512 }),
    io_size_avg: faker.number.float({ min: 32, max: 512, precision: 0.01 }),
    io_size_variance: faker.number.float({ min: 70, max: 150, precision: 0.01 }),

    // Labels
    risk_level: 'critical',
    workload_type: 'burst',
    anomaly_detected: true,
    performance_score: faker.number.float({ min: 0, max: 30, precision: 0.01 })
  };
}

async function generateTrainingData(count: number = 10000) {
  console.log(`🚀 Generating ${count} training insights...`);

  const insights: TrainingInsight[] = [];

  // Distribution: 50% low, 30% medium, 15% high, 5% critical
  const distribution = {
    low: Math.floor(count * 0.50),
    medium: Math.floor(count * 0.30),
    high: Math.floor(count * 0.15),
    critical: Math.floor(count * 0.05)
  };

  // Generate insights
  for (let i = 0; i < distribution.low; i++) {
    insights.push(generateNormalOperations());
  }

  for (let i = 0; i < distribution.medium; i++) {
    insights.push(generateMediumRisk());
  }

  for (let i = 0; i < distribution.high; i++) {
    insights.push(generateHighRisk());
  }

  for (let i = 0; i < distribution.critical; i++) {
    insights.push(generateCriticalRisk());
  }

  // Shuffle insights
  for (let i = insights.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [insights[i], insights[j]] = [insights[j], insights[i]];
  }

  // Save to files
  const dataDir = path.join(process.cwd(), 'data', 'training');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Save as JSON
  const jsonPath = path.join(dataDir, 'training-data.json');
  fs.writeFileSync(jsonPath, JSON.stringify(insights, null, 2));
  console.log(`✅ Saved JSON to ${jsonPath}`);

  // Save as CSV
  const csvPath = path.join(dataDir, 'training-data.csv');
  const headers = Object.keys(insights[0]).join(',');
  const rows = insights.map(insight =>
    Object.values(insight).map(v =>
      typeof v === 'string' ? `"${v}"` : v
    ).join(',')
  );
  fs.writeFileSync(csvPath, [headers, ...rows].join('\n'));
  console.log(`✅ Saved CSV to ${csvPath}`);

  // Generate statistics
  const stats = {
    total: insights.length,
    distribution: {
      low: insights.filter(i => i.risk_level === 'low').length,
      medium: insights.filter(i => i.risk_level === 'medium').length,
      high: insights.filter(i => i.risk_level === 'high').length,
      critical: insights.filter(i => i.risk_level === 'critical').length
    },
    anomalies: insights.filter(i => i.anomaly_detected).length,
    workload_types: {
      sequential: insights.filter(i => i.workload_type === 'sequential').length,
      random: insights.filter(i => i.workload_type === 'random').length,
      mixed: insights.filter(i => i.workload_type === 'mixed').length,
      burst: insights.filter(i => i.workload_type === 'burst').length
    },
    coverage: Math.floor((insights.length / count) * 100)
  };

  const statsPath = path.join(dataDir, 'training-stats.json');
  fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2));
  console.log(`✅ Saved statistics to ${statsPath}`);

  console.log('\n📊 Training Data Statistics:');
  console.log(`Total records: ${stats.total}`);
  console.log(`Risk distribution: Low=${stats.distribution.low}, Medium=${stats.distribution.medium}, High=${stats.distribution.high}, Critical=${stats.distribution.critical}`);
  console.log(`Anomalies detected: ${stats.anomalies} (${Math.floor((stats.anomalies / stats.total) * 100)}%)`);
  console.log(`Coverage: ${stats.coverage}%`);

  return insights;
}

// Run if executed directly
if (require.main === module) {
  generateTrainingData(10000)
    .then(() => {
      console.log('✅ Training data generation complete!');
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Error generating training data:', error);
      process.exit(1);
    });
}

export { generateTrainingData, TrainingInsight };
