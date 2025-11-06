import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  InvokeModelCommandInput,
} from '@aws-sdk/client-bedrock-runtime';
import {
  DynamoDBClient,
  PutItemCommand,
} from '@aws-sdk/client-dynamodb';
import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';
import {
  SageMakerRuntimeClient,
  InvokeEndpointCommand,
} from '@aws-sdk/client-sagemaker-runtime';

// Environment configuration
const BEDROCK_MODEL_ID = 'anthropic.claude-3-5-haiku-20241022-v1:0';
const TEMPERATURE = 0.3;
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1000; // 1 second
const DYNAMODB_TABLE = process.env.INSIGHTS_TABLE || 'IOPSInsights';
const EVENTBRIDGE_BUS = process.env.EVENT_BUS_NAME || 'default';
const USE_SAGEMAKER = process.env.USE_SAGEMAKER === 'true';
const SAGEMAKER_ENDPOINT = process.env.SAGEMAKER_ENDPOINT || '';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

// Initialize AWS clients
const bedrockClient = new BedrockRuntimeClient({ region: AWS_REGION });
const dynamoClient = new DynamoDBClient({ region: AWS_REGION });
const eventBridgeClient = new EventBridgeClient({ region: AWS_REGION });
const sageMakerClient = new SageMakerRuntimeClient({ region: AWS_REGION });

interface IOPSMetric {
  timestamp: number;
  nodeId: string;
  iops: number;
  latency: number;
  errorRate: number;
  throughput: number;
  queueDepth: number;
  activeConnections: number;
}

interface AIInsight {
  timestamp: number;
  nodeId: string;
  riskScore: number;
  analysis: string;
  recommendations: string[];
  source: 'bedrock' | 'sagemaker' | 'rules-based';
  modelUsed?: string;
}

interface BedrockResponse {
  content: Array<{
    text: string;
  }>;
}

interface SageMakerPrediction {
  risk_score: number;
  analysis: string;
  recommendations: string[];
}

/**
 * InfiniBand-specific prompt for Claude 3.5 Haiku
 * Optimized for storage protocol analysis
 */
function buildInfiniBandPrompt(metrics: IOPSMetric[]): string {
  const metricsSummary = metrics.map(m =>
    `Node ${m.nodeId}: IOPS=${m.iops}, Latency=${m.latency}ms, ErrorRate=${m.errorRate}%, ` +
    `Throughput=${m.throughput}MB/s, QueueDepth=${m.queueDepth}, Connections=${m.activeConnections}`
  ).join('\n');

  return `You are an expert in InfiniBand storage protocols and high-performance computing infrastructure.

Analyze the following InfiniBand storage metrics and provide insights:

${metricsSummary}

Provide your analysis in the following JSON format:
{
  "risk_score": <number 0-100>,
  "analysis": "<detailed analysis of the metrics>",
  "recommendations": ["<recommendation 1>", "<recommendation 2>", ...]
}

Focus on:
1. IOPS bottlenecks and throughput issues
2. Latency patterns indicating network congestion
3. Error rates suggesting hardware or protocol issues
4. Queue depth indicating saturation
5. Connection patterns and their impact on performance

Return ONLY the JSON object, no additional text.`;
}

/**
 * Invoke Bedrock with exponential backoff retry logic
 */
async function invokeBedrockWithRetry(
  prompt: string,
  retryCount = 0
): Promise<BedrockResponse> {
  try {
    const input: InvokeModelCommandInput = {
      modelId: BEDROCK_MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 2000,
        temperature: TEMPERATURE,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    };

    const command = new InvokeModelCommand(input);
    const response = await bedrockClient.send(command);

    if (!response.body) {
      throw new Error('Empty response body from Bedrock');
    }

    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    return responseBody;
  } catch (error: any) {
    console.error(`Bedrock invocation failed (attempt ${retryCount + 1}):`, error);

    // Check if we should retry
    const isThrottling = error.name === 'ThrottlingException' || error.$metadata?.httpStatusCode === 429;
    const isTimeout = error.name === 'TimeoutError' || error.code === 'ETIMEDOUT';
    const shouldRetry = (isThrottling || isTimeout) && retryCount < MAX_RETRIES;

    if (shouldRetry) {
      // Exponential backoff: 1s, 2s, 4s
      const backoffMs = BASE_BACKOFF_MS * Math.pow(2, retryCount);
      console.log(`Retrying after ${backoffMs}ms...`);
      await sleep(backoffMs);
      return invokeBedrockWithRetry(prompt, retryCount + 1);
    }

    throw error;
  }
}

/**
 * Generate human-readable analysis from SageMaker risk score
 */
function generateAnalysisFromScore(riskLevel: number, metric: IOPSMetric): string {
  const riskLabels = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
  const label = riskLabels[Math.min(Math.floor(riskLevel), 3)];

  const issues: string[] = [];

  if (metric.iops > 100000) issues.push(`high IOPS load (${metric.iops})`);
  if (metric.latency > 10) issues.push(`elevated latency (${metric.latency}ms)`);
  if (metric.errorRate > 1) issues.push(`error rate at ${metric.errorRate}%`);
  if (metric.queueDepth > 64) issues.push(`queue saturation (depth: ${metric.queueDepth})`);

  const issueText = issues.length > 0 ? ` Detected: ${issues.join(', ')}.` : '';

  return `SageMaker ML model predicts ${label} risk (${riskLevel}/3) for node ${metric.nodeId}.${issueText} Based on 25 engineered features including IOPS patterns, latency distribution, error trends, and capacity utilization.`;
}

/**
 * Generate recommendations from SageMaker risk score
 */
function generateRecommendationsFromScore(riskLevel: number, metric: IOPSMetric): string[] {
  const recommendations: string[] = [];

  if (riskLevel >= 3) {
    recommendations.push('CRITICAL: Immediate investigation required');
    if (metric.errorRate > 3) recommendations.push('Check for hardware failures or connectivity issues');
    if (metric.latency > 20) recommendations.push('Network congestion detected - investigate InfiniBand fabric');
    if (metric.iops > 120000) recommendations.push('Resource saturation - consider scaling or load balancing');
  } else if (riskLevel >= 2) {
    recommendations.push('HIGH: Schedule maintenance window for investigation');
    if (metric.latency > 10) recommendations.push('Monitor latency trends - potential congestion building');
    if (metric.queueDepth > 64) recommendations.push('Queue depth approaching limits - review workload distribution');
  } else if (riskLevel >= 1) {
    recommendations.push('MEDIUM: Monitor closely for trend changes');
    if (metric.iops > 80000) recommendations.push('IOPS trending high - prepare capacity plan');
  } else {
    recommendations.push('LOW: Continue normal monitoring');
  }

  return recommendations;
}

/**
 * Convert IOPSMetric to 25-feature CSV format for SageMaker XGBoost
 * Feature order matches training data:
 * 1-4: IOPS metrics, 5-8: Latency, 9-10: Throughput, 11-12: Error rates,
 * 13-15: Time-based, 16-17: Access patterns, 18-20: Device metrics,
 * 21-25: Derived features
 */
function metricsToFeatureCSV(metric: IOPSMetric): string {
  const now = new Date();

  // Derive features from available metrics
  const readIops = Math.floor(metric.iops * 0.6); // Estimate 60% read
  const writeIops = Math.floor(metric.iops * 0.4); // Estimate 40% write
  const totalIops = metric.iops;
  const iopsVariance = Math.floor(metric.iops * 0.15); // Estimate variance

  const avgLatency = metric.latency;
  const p95Latency = metric.latency * 2.5; // Estimate p95
  const p99Latency = metric.latency * 5; // Estimate p99
  const latencySpikeCount = metric.latency > 10 ? 3 : 0; // Estimate spikes

  const bandwidthMbps = metric.throughput;
  const throughputVariance = Math.floor(metric.throughput * 0.1);

  const errorRate = metric.errorRate;
  const errorTrend = metric.errorRate > 1 ? 0.5 : -0.2; // Increasing or decreasing

  const hourOfDay = now.getHours();
  const dayOfWeek = now.getDay();
  const timeSinceLastAlert = 3600; // Default 1 hour

  const sequentialAccessRatio = 0.7; // Estimate based on typical workload
  const randomAccessRatio = 0.3;

  const queueDepth = metric.queueDepth;
  const ioSizeAvg = 128; // Typical block size in KB
  const ioSizeVariance = 32;

  // Derived features
  const iopsPerLatency = avgLatency > 0 ? totalIops / avgLatency : 0;
  const anomalyScore = (metric.errorRate * 2) + (avgLatency > 10 ? 3 : 0);
  const trendScore = (metric.iops > 80000 ? 7 : 3) + (avgLatency > 15 ? 2 : 0);
  const capacityUtilization = Math.min(metric.iops / 150000, 1);
  const workloadType = metric.iops > 100000 ? 2 : (metric.latency > 10 ? 1 : 0);

  // Return CSV row (25 features, no header)
  return [
    readIops,
    writeIops,
    totalIops,
    iopsVariance,
    avgLatency.toFixed(2),
    p95Latency.toFixed(2),
    p99Latency.toFixed(2),
    latencySpikeCount,
    bandwidthMbps,
    throughputVariance,
    errorRate.toFixed(2),
    errorTrend.toFixed(2),
    hourOfDay,
    dayOfWeek,
    timeSinceLastAlert,
    sequentialAccessRatio.toFixed(2),
    randomAccessRatio.toFixed(2),
    queueDepth,
    ioSizeAvg,
    ioSizeVariance,
    iopsPerLatency.toFixed(2),
    anomalyScore.toFixed(2),
    trendScore.toFixed(2),
    capacityUtilization.toFixed(2),
    workloadType
  ].join(',');
}

/**
 * Invoke SageMaker endpoint for predictions with enhanced error handling
 */
async function invokeSageMaker(metrics: IOPSMetric[]): Promise<SageMakerPrediction> {
  // Validate endpoint configuration
  if (!SAGEMAKER_ENDPOINT || SAGEMAKER_ENDPOINT.trim() === '') {
    throw new Error('SAGEMAKER_ENDPOINT environment variable is not configured');
  }

  try {
    // Convert first metric to CSV format (XGBoost expects CSV, not JSON)
    const csvData = metricsToFeatureCSV(metrics[0]);

    console.log(`Invoking SageMaker endpoint: ${SAGEMAKER_ENDPOINT}`);
    console.log(`Feature CSV: ${csvData}`);

    const command = new InvokeEndpointCommand({
      EndpointName: SAGEMAKER_ENDPOINT,
      ContentType: 'text/csv',
      Body: csvData,
    });

    const response = await sageMakerClient.send(command);

    if (!response.Body) {
      throw new Error('Empty response from SageMaker endpoint');
    }

    const result = JSON.parse(new TextDecoder().decode(response.Body));

    // XGBoost returns predictions array, extract risk score
    const riskScore = result.predictions?.[0]?.score || result.score || 0;

    // Map score (0-3) to 0-100 scale
    const scaledRiskScore = Math.round(riskScore * 33.33);

    // Generate analysis based on risk score
    const analysis = generateAnalysisFromScore(riskScore, metrics[0]);
    const recommendations = generateRecommendationsFromScore(riskScore, metrics[0]);

    console.log(`SageMaker prediction successful: risk=${riskScore}, scaled=${scaledRiskScore}`);

    return {
      risk_score: scaledRiskScore,
      analysis,
      recommendations
    };
  } catch (error: any) {
    // Enhanced error logging with specific SageMaker error types
    const errorName = error.name || 'Unknown';
    const errorMessage = error.message || 'No error message';
    const httpStatus = error.$metadata?.httpStatusCode;

    console.error('SageMaker invocation failed:', {
      errorName,
      errorMessage,
      httpStatus,
      endpoint: SAGEMAKER_ENDPOINT,
      region: AWS_REGION,
    });

    // Handle specific SageMaker errors
    if (errorName === 'ModelNotReadyException') {
      console.error('SageMaker model endpoint is not ready. The endpoint may still be creating or updating.');
    } else if (errorName === 'ValidationException') {
      console.error('SageMaker validation error. Check payload format and endpoint configuration.');
    } else if (errorName === 'ModelError') {
      console.error('SageMaker model error. The model encountered an error during inference.');
    } else if (error.code === 'ETIMEDOUT' || errorName === 'TimeoutError') {
      console.error('SageMaker request timed out. The endpoint may be overloaded or slow to respond.');
    }

    throw error;
  }
}

/**
 * Fallback rules-based analysis
 */
function rulesBasedAnalysis(metrics: IOPSMetric[]): AIInsight {
  let riskScore = 0;
  const issues: string[] = [];
  const recommendations: string[] = [];

  for (const metric of metrics) {
    // IOPS threshold analysis
    if (metric.iops > 100000) {
      riskScore += 20;
      issues.push(`Node ${metric.nodeId}: High IOPS (${metric.iops})`);
      recommendations.push(`Scale out storage for node ${metric.nodeId}`);
    }

    // Latency analysis
    if (metric.latency > 10) {
      riskScore += 25;
      issues.push(`Node ${metric.nodeId}: High latency (${metric.latency}ms)`);
      recommendations.push(`Investigate network congestion on node ${metric.nodeId}`);
    }

    // Error rate analysis
    if (metric.errorRate > 1) {
      riskScore += 30;
      issues.push(`Node ${metric.nodeId}: Elevated error rate (${metric.errorRate}%)`);
      recommendations.push(`Check hardware health on node ${metric.nodeId}`);
    }

    // Queue depth analysis
    if (metric.queueDepth > 64) {
      riskScore += 15;
      issues.push(`Node ${metric.nodeId}: Queue saturation (depth: ${metric.queueDepth})`);
      recommendations.push(`Increase queue depth or reduce load on node ${metric.nodeId}`);
    }

    // Throughput analysis
    if (metric.throughput < 1000 && metric.iops > 50000) {
      riskScore += 10;
      issues.push(`Node ${metric.nodeId}: Low throughput relative to IOPS`);
      recommendations.push(`Optimize block size for node ${metric.nodeId}`);
    }
  }

  riskScore = Math.min(riskScore, 100);

  const analysis = issues.length > 0
    ? `Rules-based analysis detected ${issues.length} issue(s): ${issues.join('; ')}`
    : 'All metrics within acceptable thresholds';

  return {
    timestamp: Date.now(),
    nodeId: metrics[0]?.nodeId || 'unknown',
    riskScore,
    analysis,
    recommendations: recommendations.length > 0 ? recommendations : ['Continue monitoring'],
    source: 'rules-based',
  };
}

/**
 * Analyze metrics using AI (Bedrock or SageMaker)
 */
async function analyzeWithAI(metrics: IOPSMetric[]): Promise<AIInsight> {
  // Try SageMaker first if enabled
  if (USE_SAGEMAKER && SAGEMAKER_ENDPOINT) {
    try {
      console.log('Attempting SageMaker prediction...');
      const prediction = await invokeSageMaker(metrics);

      return {
        timestamp: Date.now(),
        nodeId: metrics[0]?.nodeId || 'unknown',
        riskScore: prediction.risk_score,
        analysis: prediction.analysis,
        recommendations: prediction.recommendations,
        source: 'sagemaker',
        modelUsed: SAGEMAKER_ENDPOINT,
      };
    } catch (error) {
      console.error('SageMaker failed, falling back to Bedrock:', error);
    }
  }

  // Try Bedrock
  try {
    console.log('Invoking Bedrock...');
    const prompt = buildInfiniBandPrompt(metrics);
    const response = await invokeBedrockWithRetry(prompt);

    const responseText = response.content[0]?.text || '{}';
    const parsed = JSON.parse(responseText);

    return {
      timestamp: Date.now(),
      nodeId: metrics[0]?.nodeId || 'unknown',
      riskScore: parsed.risk_score || 0,
      analysis: parsed.analysis || 'No analysis provided',
      recommendations: parsed.recommendations || [],
      source: 'bedrock',
      modelUsed: BEDROCK_MODEL_ID,
    };
  } catch (error) {
    console.error('Bedrock failed after retries, falling back to rules-based:', error);
    return rulesBasedAnalysis(metrics);
  }
}

/**
 * Write insight to DynamoDB
 */
async function writeInsightToDynamoDB(insight: AIInsight): Promise<void> {
  try {
    const command = new PutItemCommand({
      TableName: DYNAMODB_TABLE,
      Item: {
        PK: { S: `NODE#${insight.nodeId}` },
        SK: { S: `INSIGHT#${insight.timestamp}` },
        riskScore: { N: insight.riskScore.toString() },
        analysis: { S: insight.analysis },
        recommendations: { SS: insight.recommendations },
        source: { S: insight.source },
        modelUsed: { S: insight.modelUsed || 'N/A' },
        timestamp: { N: insight.timestamp.toString() },
        ttl: { N: Math.floor(Date.now() / 1000 + 30 * 24 * 60 * 60).toString() }, // 30 days
      },
    });

    await dynamoClient.send(command);
    console.log('Insight written to DynamoDB');
  } catch (error) {
    console.error('Failed to write to DynamoDB:', error);
    throw error;
  }
}

/**
 * Trigger EventBridge event for high-risk insights
 */
async function triggerHighRiskAlert(insight: AIInsight): Promise<void> {
  try {
    const command = new PutEventsCommand({
      Entries: [
        {
          Source: 'iops.ai-analysis',
          DetailType: 'High Risk Detected',
          Detail: JSON.stringify({
            nodeId: insight.nodeId,
            riskScore: insight.riskScore,
            analysis: insight.analysis,
            recommendations: insight.recommendations,
            timestamp: insight.timestamp,
          }),
          EventBusName: EVENTBRIDGE_BUS,
        },
      ],
    });

    await eventBridgeClient.send(command);
    console.log('High-risk alert triggered via EventBridge');
  } catch (error) {
    console.error('Failed to trigger EventBridge event:', error);
    // Don't throw - alerting failure shouldn't block analysis
  }
}

/**
 * Lambda handler
 */
export async function handler(event: any): Promise<any> {
  console.log('AI Analysis Lambda invoked:', JSON.stringify(event, null, 2));

  try {
    // Parse metrics from event
    const metrics: IOPSMetric[] = Array.isArray(event.Records)
      ? event.Records.map((record: any) => JSON.parse(record.body))
      : Array.isArray(event)
      ? event
      : [event];

    if (metrics.length === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'No metrics provided' }),
      };
    }

    // Analyze with AI
    const insight = await analyzeWithAI(metrics);

    // Write to DynamoDB
    await writeInsightToDynamoDB(insight);

    // Trigger alert if high risk
    if (insight.riskScore >= 80) {
      await triggerHighRiskAlert(insight);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        insight,
      }),
    };
  } catch (error: any) {
    console.error('Lambda execution failed:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Internal server error',
        message: error.message,
      }),
    };
  }
}

/**
 * Utility: Sleep function
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
