import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatch_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as kinesis from 'aws-cdk-lib/aws-kinesis';
import * as kinesisfirehose from 'aws-cdk-lib/aws-kinesisfirehose';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { KinesisEventSource, SqsDlq } from 'aws-cdk-lib/aws-lambda-event-sources';
import { StartingPosition } from 'aws-cdk-lib/aws-lambda';
import * as path from 'path';

export class CdkStack extends cdk.Stack {
  public readonly lambdaExecutionRole: iam.Role;
  public readonly metricsTable: dynamodb.Table;
  public readonly eventBus: events.EventBus;
  public readonly riskAlertTopic: sns.Topic;
  public readonly eventsStream: kinesis.Stream;
  public readonly malformedDataTopic: sns.Topic;
  public readonly archiveBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create shared Lambda execution role
    this.lambdaExecutionRole = new iam.Role(this, 'LambdaExecutionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Create DynamoDB Table for metrics and insights
    this.metricsTable = new dynamodb.Table(this, 'MetricsTable', {
      tableName: 'iops-dashboard-metrics',
      partitionKey: { name: 'entity_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'entity_type', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For dev/demo only
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES, // Enable DynamoDB Streams for WebSocket updates (PR-10)
    });

    // Add GSI for querying insights by entity_type and timestamp
    this.metricsTable.addGlobalSecondaryIndex({
      indexName: 'EntityTypeIndex',
      partitionKey: { name: 'entity_type', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Grant DynamoDB permissions to execution role
    this.metricsTable.grantReadWriteData(this.lambdaExecutionRole);

    // ========================================
    // Kinesis Data Stream for Event-Driven Architecture
    // ========================================

    // Create Kinesis Data Stream with encryption and auto-scaling
    this.eventsStream = new kinesis.Stream(this, 'EventsStream', {
      streamName: 'iops-dashboard-events-stream',
      shardCount: 2, // Initial capacity: 2 MB/s write, 4 MB/s read
      retentionPeriod: cdk.Duration.hours(24), // 24-hour replay capability
      encryption: kinesis.StreamEncryption.MANAGED,
      streamMode: kinesis.StreamMode.PROVISIONED, // Use provisioned for auto-scaling
    });

    // Grant Kinesis permissions to execution role
    this.eventsStream.grantReadWrite(this.lambdaExecutionRole);

    // ========================================
    // S3 Bucket for Data Archive (Kinesis Firehose destination)
    // ========================================

    this.archiveBucket = new s3.Bucket(this, 'ArchiveBucket', {
      bucketName: `iops-dashboard-archive-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: false,
      lifecycleRules: [
        {
          id: 'TransitionToIA',
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(30),
            },
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(90),
            },
          ],
          expiration: cdk.Duration.days(365), // Delete after 1 year
        },
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN, // Keep data on stack deletion
    });

    // ========================================
    // SNS Topic for Malformed Data Alerts
    // ========================================

    this.malformedDataTopic = new sns.Topic(this, 'MalformedDataTopic', {
      topicName: 'iops-dashboard-malformed-events',
      displayName: 'IOps Dashboard Malformed Data Alerts',
      fifo: false,
    });

    // Add email subscription for malformed data
    this.malformedDataTopic.addSubscription(
      new subscriptions.EmailSubscription('tylerpohn@gmail.com')
    );

    // ========================================
    // S3 Archive Bucket (Stream Processor will write directly)
    // ========================================
    // Note: Removed Firehose due to IAM propagation timing issues.
    // Stream Processor Lambda now writes directly to S3 for archival.

    // ========================================
    // Stream Processor Lambda for Kinesis → DynamoDB
    // ========================================

    const streamProcessorLambda = new lambda.Function(this, 'StreamProcessorFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'dist/index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/stream-processor')),
      role: this.lambdaExecutionRole,
      environment: {
        DYNAMODB_TABLE_NAME: this.metricsTable.tableName,
        MALFORMED_DATA_TOPIC_ARN: this.malformedDataTopic.topicArn,
        ARCHIVE_BUCKET_NAME: this.archiveBucket.bucketName,
      },
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      description: 'Processes Kinesis stream events with validation, batch writes to DynamoDB, and S3 archival',
      reservedConcurrentExecutions: 50, // 50 concurrent executions for stream processing
    });

    // Grant SNS publish permissions for malformed data notifications
    this.malformedDataTopic.grantPublish(streamProcessorLambda);

    // Grant S3 write permissions for archival
    this.archiveBucket.grantWrite(streamProcessorLambda);

    // Create DLQ for Stream Processor failures
    const streamProcessorDLQ = new sqs.Queue(this, 'StreamProcessorDLQ', {
      queueName: 'iops-dashboard-stream-processor-dlq',
      retentionPeriod: cdk.Duration.days(14),
    });

    // Add Kinesis event source to Stream Processor
    streamProcessorLambda.addEventSource(
      new KinesisEventSource(this.eventsStream, {
        startingPosition: StartingPosition.LATEST,
        batchSize: 100, // Process up to 100 records per batch
        maxBatchingWindow: cdk.Duration.seconds(5), // Wait up to 5 seconds to fill batch
        bisectBatchOnError: true, // Split batch on error for better error isolation
        retryAttempts: 3, // Retry failed batches 3 times
        parallelizationFactor: 10, // Process up to 10 batches per shard in parallel
        onFailure: new SqsDlq(streamProcessorDLQ),
      })
    );

    // Create Ingestion Lambda (TypeScript) - Writes to Kinesis
    const ingestLambda = new lambda.Function(this, 'IngestFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/ingest/dist')),
      role: this.lambdaExecutionRole,
      environment: {
        KINESIS_STREAM_NAME: this.eventsStream.streamName,
        DYNAMODB_TABLE_NAME: this.metricsTable.tableName, // Fallback for feature flag
        EVENT_BUS_NAME: 'default', // Will be updated to custom bus
        USE_KINESIS: 'true', // Feature flag to enable Kinesis path
      },
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      description: 'Ingests metrics and writes to Kinesis stream (TypeScript)',
      reservedConcurrentExecutions: 100, // Support 200 streams at 0.5% capacity
    });

    // Create API Gateway for ingestion and insights endpoints
    // Configured for 200 streams at 0.5% DynamoDB capacity (~10-20 RPS per stream)
    const api = new apigateway.RestApi(this, 'IngestApi', {
      restApiName: 'IOpsDashboard-IngestApi',
      description: 'API Gateway for metric ingestion and insights (200 streams @ 0.5% capacity)',
      deployOptions: {
        stageName: 'prod',
        throttlingBurstLimit: 4000, // 200 streams * 20 RPS burst
        throttlingRateLimit: 2000,  // 200 streams * 10 RPS steady-state
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
        maxAge: cdk.Duration.days(1),
      },
    });

    // Define request validator model for /metrics endpoint
    const metricsRequestModel = new apigateway.Model(this, 'MetricsRequestModel', {
      restApi: api,
      contentType: 'application/json',
      schema: {
        type: apigateway.JsonSchemaType.OBJECT,
        required: ['entity_id', 'entity_type', 'timestamp'],
        properties: {
          entity_id: { type: apigateway.JsonSchemaType.STRING },
          entity_type: { type: apigateway.JsonSchemaType.STRING },
          timestamp: { type: apigateway.JsonSchemaType.STRING },
          metrics: { type: apigateway.JsonSchemaType.OBJECT },
          metadata: { type: apigateway.JsonSchemaType.OBJECT },
        },
      },
    });

    // Create request validator
    const requestValidator = new apigateway.RequestValidator(this, 'MetricsRequestValidator', {
      restApi: api,
      requestValidatorName: 'metrics-validator',
      validateRequestBody: true,
      validateRequestParameters: true,
    });

    // Add /metrics endpoint with validation
    const metricsResource = api.root.addResource('metrics');
    metricsResource.addMethod('POST', new apigateway.LambdaIntegration(ingestLambda), {
      requestValidator,
      requestModels: {
        'application/json': metricsRequestModel,
      },
    });

    // Keep legacy /ingest endpoint for backward compatibility (deprecated)
    const ingestResource = api.root.addResource('ingest');
    ingestResource.addMethod('POST', new apigateway.LambdaIntegration(ingestLambda));

    // Create Insights Lambda (TypeScript)
    const insightsLambda = new lambda.Function(this, 'InsightsFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'get-insights.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/api/dist')),
      role: this.lambdaExecutionRole,
      environment: {
        DYNAMODB_TABLE_NAME: this.metricsTable.tableName,
      },
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      description: 'REST API endpoint for retrieving insights from DynamoDB',
    });

    // Create /insights resource with CORS
    const insightsResource = api.root.addResource('insights', {
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: ['GET', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    // Add /insights/recent endpoint
    const recentResource = insightsResource.addResource('recent');
    recentResource.addMethod('GET', new apigateway.LambdaIntegration(insightsLambda));

    // Add /insights/{id} endpoint
    const insightIdResource = insightsResource.addResource('{id}');
    insightIdResource.addMethod('GET', new apigateway.LambdaIntegration(insightsLambda));

    // Create Simulator Lambda (Python)
    const simulatorLambda = new lambda.Function(this, 'SimulatorFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'handler.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/simulator'), {
        bundling: {
          image: lambda.Runtime.PYTHON_3_12.bundlingImage,
          command: [
            'bash', '-c',
            'pip install -r requirements.txt -t /asset-output && cp -au . /asset-output'
          ],
        },
      }),
      role: this.lambdaExecutionRole,
      environment: {
        INGEST_API_URL: api.url + 'ingest',
        STREAM_COUNT: '50',
        EVENTS_PER_RUN: '10', // 10 events per stream per minute = 500 events/min
      },
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      description: 'Generates synthetic data for demo and testing (Python)',
    });

    // Create EventBridge rule to run simulator every minute (disabled by default)
    const simulatorRule = new events.Rule(this, 'SimulatorSchedule', {
      schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
      description: 'Triggers synthetic data generation every minute',
      enabled: false, // Start disabled, enable manually when needed
    });

    simulatorRule.addTarget(new targets.LambdaFunction(simulatorLambda));

    // Grant EventBridge permissions to ingest lambda
    this.lambdaExecutionRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['events:PutEvents'],
      resources: ['*'], // Will be scoped to custom event bus
    }));

    // ========================================
    // EventBridge Event Bus (create BEFORE AI Lambda)
    // ========================================

    // Create custom EventBridge event bus for alerts
    this.eventBus = new events.EventBus(this, 'AlertEventBus', {
      eventBusName: 'iops-dashboard-alerts',
      description: 'Event bus for routing IOps Dashboard risk-based alerts',
    });

    // Create AI Inference Lambda (Python) - TensorFlow Multi-Task Marketplace Health Model
    const aiLambda = new lambda.Function(this, 'AIFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'handler.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/ai-analysis'), {
        bundling: {
          image: lambda.Runtime.PYTHON_3_12.bundlingImage,
          command: [
            'bash', '-c',
            'pip install -r requirements.txt -t /asset-output && cp -au . /asset-output'
          ],
        },
      }),
      role: this.lambdaExecutionRole,
      environment: {
        DYNAMODB_TABLE_NAME: this.metricsTable.tableName,
        SAGEMAKER_ENDPOINT_NAME: 'marketplace-health-endpoint',
        MODEL_VERSION: 'marketplace-health-v1',
        MODEL_TYPE: 'tensorflow_multi_task',
        BATCH_SIZE: '100',
        EVENT_BUS_NAME: this.eventBus.eventBusName,
      },
      timeout: cdk.Duration.minutes(5),
      memorySize: 1024,
      description: 'AI inference with TensorFlow multi-task marketplace health model (46 features → 5 predictions)',
    });

    // Grant Bedrock permissions to AI lambda (both standard and streaming)
    aiLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeModel',
        'bedrock:InvokeModelWithResponseStream',
      ],
      resources: [
        `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-3-5-haiku-20241022-v1:0`,
        `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-3-5-sonnet-20241022-v2:0`,
      ],
    }));

    // Grant SageMaker permissions to AI lambda for ML inference
    aiLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['sagemaker:InvokeEndpoint'],
      resources: [
        `arn:aws:sagemaker:us-east-1:${this.account}:endpoint/marketplace-health-endpoint`,
        // Keep old endpoint for backward compatibility during transition
        `arn:aws:sagemaker:${this.region}:${this.account}:endpoint/iops-classifier-lite`,
      ],
    }));

    // Grant CloudWatch permissions to AI lambda for publishing metrics
    aiLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['cloudwatch:PutMetricData'],
      resources: ['*'],
    }));

    // Schedule AI Lambda to run every 5 minutes for prediction refresh
    const aiRefreshRule = new events.Rule(this, 'AIRefreshRule', {
      ruleName: 'iops-dashboard-ai-prediction-refresh',
      description: 'Trigger AI Lambda every 5 minutes to refresh customer health predictions',
      schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
      enabled: true,
    });

    aiRefreshRule.addTarget(new targets.LambdaFunction(aiLambda, {
      retryAttempts: 2,
      maxEventAge: cdk.Duration.minutes(10),
    }));

    // ========================================
    // SNS Risk-Based Alerts System
    // ========================================

    // Create Dead Letter Queue for failed notifications
    const alertDLQ = new sqs.Queue(this, 'AlertDLQ', {
      queueName: 'iops-dashboard-alert-dlq',
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    // Create SNS topic for high-risk alerts (risk >= 80)
    this.riskAlertTopic = new sns.Topic(this, 'RiskAlertTopic', {
      topicName: 'iops-dashboard-high-risk-alerts',
      displayName: 'IOps Dashboard High Risk Alerts (>=80)',
      fifo: false,
    });

    // Add email subscription for tylerpohn@gmail.com
    this.riskAlertTopic.addSubscription(
      new subscriptions.EmailSubscription('tylerpohn@gmail.com')
    );

    // Create EventBridge rule for high-risk alerts (risk >= 80)
    const highRiskRule = new events.Rule(this, 'HighRiskAlertRule', {
      eventBus: this.eventBus,
      eventPattern: {
        source: ['iops-dashboard.ingest', 'iops-dashboard.ai'],
        detail: {
          risk_score: [{ numeric: ['>=', 80] }],
        },
      },
      description: 'Routes high-risk alerts (risk >= 80) to SNS for immediate notification',
    });

    highRiskRule.addTarget(new targets.SnsTopic(this.riskAlertTopic, {
      message: events.RuleTargetInput.fromEventPath('$.detail'),
      deadLetterQueue: alertDLQ,
    }));

    // Update Ingest Lambda environment to use custom event bus
    ingestLambda.addEnvironment('EVENT_BUS_NAME', this.eventBus.eventBusName);

    // Grant EventBridge permissions to send events to custom bus
    this.eventBus.grantPutEventsTo(this.lambdaExecutionRole);

    // ========================================
    // CloudWatch Alarms for Cost and Error Monitoring
    // ========================================

    // Lambda error rate alarm for ingest function
    const ingestErrorAlarm = new cloudwatch.Alarm(this, 'IngestLambdaErrorAlarm', {
      alarmName: 'iops-dashboard-ingest-lambda-errors',
      alarmDescription: 'Alert when ingest Lambda error rate exceeds 5%',
      metric: ingestLambda.metricErrors({
        period: cdk.Duration.minutes(5),
        statistic: 'Sum',
      }),
      threshold: 50, // 50 errors per 5 minutes (5% of 1000 invocations)
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });

    ingestErrorAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.riskAlertTopic));

    // Lambda throttle alarm for ingest function
    const ingestThrottleAlarm = new cloudwatch.Alarm(this, 'IngestLambdaThrottleAlarm', {
      alarmName: 'iops-dashboard-ingest-lambda-throttles',
      alarmDescription: 'Alert when ingest Lambda is being throttled',
      metric: ingestLambda.metricThrottles({
        period: cdk.Duration.minutes(5),
        statistic: 'Sum',
      }),
      threshold: 10, // 10 throttles in 5 minutes
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });

    ingestThrottleAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.riskAlertTopic));

    // AI Lambda error rate alarm
    const aiErrorAlarm = new cloudwatch.Alarm(this, 'AILambdaErrorAlarm', {
      alarmName: 'iops-dashboard-ai-lambda-errors',
      alarmDescription: 'Alert when AI Lambda error rate is high',
      metric: aiLambda.metricErrors({
        period: cdk.Duration.minutes(5),
        statistic: 'Sum',
      }),
      threshold: 5, // 5 errors per 5 minutes
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });

    aiErrorAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.riskAlertTopic));

    // ========================================
    // Marketplace Health Prediction Alarms
    // ========================================

    // High churn risk alarm
    const highChurnAlarm = new cloudwatch.Alarm(this, 'HighChurnRateAlarm', {
      alarmName: 'iops-dashboard-high-churn-rate',
      alarmDescription: 'Alert when 10+ customers have >70% churn risk within 14 days',
      metric: new cloudwatch.Metric({
        namespace: 'IOpsDashboard/Predictions',
        metricName: 'HighChurnRiskCount',
        statistic: 'Maximum',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 10,
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    });

    highChurnAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.riskAlertTopic));

    // Low average health score alarm
    const lowHealthAlarm = new cloudwatch.Alarm(this, 'LowHealthScoreAlarm', {
      alarmName: 'iops-dashboard-low-health-average',
      alarmDescription: 'Alert when average customer health score drops below 60',
      metric: new cloudwatch.Metric({
        namespace: 'IOpsDashboard/Predictions',
        metricName: 'AverageHealthScore',
        statistic: 'Average',
        period: cdk.Duration.minutes(15),
      }),
      threshold: 60,
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
    });

    lowHealthAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.riskAlertTopic));

    // At-risk customer count alarm
    const atRiskCustomersAlarm = new cloudwatch.Alarm(this, 'AtRiskCustomersAlarm', {
      alarmName: 'iops-dashboard-at-risk-customers-high',
      alarmDescription: 'Alert when at-risk customer count exceeds 25% of total',
      metric: new cloudwatch.Metric({
        namespace: 'IOpsDashboard/Predictions',
        metricName: 'AtRiskCustomers',
        statistic: 'Maximum',
        period: cdk.Duration.minutes(15),
      }),
      threshold: 50, // Alert if 50+ customers are at-risk
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    });

    atRiskCustomersAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.riskAlertTopic));

    // DynamoDB consumed read capacity alarm (cost monitoring)
    const dynamoReadCapacityAlarm = new cloudwatch.Alarm(this, 'DynamoDBReadCapacityAlarm', {
      alarmName: 'iops-dashboard-dynamodb-high-read-capacity',
      alarmDescription: 'Alert when DynamoDB read capacity exceeds expected levels (cost control)',
      metric: this.metricsTable.metricConsumedReadCapacityUnits({
        period: cdk.Duration.minutes(5),
        statistic: 'Sum',
      }),
      threshold: 10000, // 10k read units per 5 minutes
      evaluationPeriods: 3,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });

    dynamoReadCapacityAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.riskAlertTopic));

    // DynamoDB consumed write capacity alarm (cost monitoring)
    const dynamoWriteCapacityAlarm = new cloudwatch.Alarm(this, 'DynamoDBWriteCapacityAlarm', {
      alarmName: 'iops-dashboard-dynamodb-high-write-capacity',
      alarmDescription: 'Alert when DynamoDB write capacity exceeds expected levels (cost control)',
      metric: this.metricsTable.metricConsumedWriteCapacityUnits({
        period: cdk.Duration.minutes(5),
        statistic: 'Sum',
      }),
      threshold: 5000, // 5k write units per 5 minutes (200 streams * 25 writes/min = 5k/5min)
      evaluationPeriods: 3,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });

    dynamoWriteCapacityAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.riskAlertTopic));

    // API Gateway 4XX error rate alarm
    const api4xxAlarm = new cloudwatch.Alarm(this, 'APIGateway4xxAlarm', {
      alarmName: 'iops-dashboard-api-4xx-errors',
      alarmDescription: 'Alert when API Gateway 4xx error rate is high (validation failures)',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/ApiGateway',
        metricName: '4XXError',
        dimensionsMap: {
          ApiName: api.restApiName,
        },
        period: cdk.Duration.minutes(5),
        statistic: 'Sum',
      }),
      threshold: 100, // 100 4xx errors per 5 minutes
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });

    api4xxAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.riskAlertTopic));

    // API Gateway 5XX error rate alarm
    const api5xxAlarm = new cloudwatch.Alarm(this, 'APIGateway5xxAlarm', {
      alarmName: 'iops-dashboard-api-5xx-errors',
      alarmDescription: 'Alert when API Gateway 5xx error rate is high (backend failures)',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/ApiGateway',
        metricName: '5XXError',
        dimensionsMap: {
          ApiName: api.restApiName,
        },
        period: cdk.Duration.minutes(5),
        statistic: 'Sum',
      }),
      threshold: 10, // 10 5xx errors per 5 minutes
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });

    api5xxAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.riskAlertTopic));

    // Lambda duration alarm for cost monitoring
    const ingestDurationAlarm = new cloudwatch.Alarm(this, 'IngestLambdaDurationAlarm', {
      alarmName: 'iops-dashboard-ingest-lambda-high-duration',
      alarmDescription: 'Alert when ingest Lambda duration is consistently high (cost impact)',
      metric: ingestLambda.metricDuration({
        period: cdk.Duration.minutes(5),
        statistic: 'Average',
      }),
      threshold: 5000, // 5 seconds average
      evaluationPeriods: 3,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });

    ingestDurationAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.riskAlertTopic));

    // ========================================
    // Kinesis CloudWatch Alarms
    // ========================================

    // Kinesis iterator age alarm (processing lag)
    const kinesisIteratorAgeAlarm = new cloudwatch.Alarm(this, 'KinesisIteratorAgeAlarm', {
      alarmName: 'iops-dashboard-kinesis-iterator-age',
      alarmDescription: 'Alert when Kinesis stream processing lags behind (iterator age > 60 seconds)',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/Kinesis',
        metricName: 'GetRecords.IteratorAgeMilliseconds',
        dimensionsMap: {
          StreamName: this.eventsStream.streamName,
        },
        period: cdk.Duration.minutes(1),
        statistic: 'Maximum',
      }),
      threshold: 60000, // 60 seconds in milliseconds
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });

    kinesisIteratorAgeAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.riskAlertTopic));

    // Kinesis write throughput exceeded alarm
    const kinesisWriteThroughputAlarm = new cloudwatch.Alarm(this, 'KinesisWriteThroughputAlarm', {
      alarmName: 'iops-dashboard-kinesis-write-throughput-exceeded',
      alarmDescription: 'Alert when Kinesis write throughput exceeds provisioned capacity',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/Kinesis',
        metricName: 'WriteProvisionedThroughputExceeded',
        dimensionsMap: {
          StreamName: this.eventsStream.streamName,
        },
        period: cdk.Duration.minutes(5),
        statistic: 'Sum',
      }),
      threshold: 10, // More than 10 throttled requests in 5 minutes
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });

    kinesisWriteThroughputAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.riskAlertTopic));

    // Stream Processor Lambda error rate alarm
    const streamProcessorErrorAlarm = new cloudwatch.Alarm(this, 'StreamProcessorErrorAlarm', {
      alarmName: 'iops-dashboard-stream-processor-errors',
      alarmDescription: 'Alert when Stream Processor Lambda has high error rate',
      metric: streamProcessorLambda.metricErrors({
        period: cdk.Duration.minutes(5),
        statistic: 'Sum',
      }),
      threshold: 10, // 10 errors per 5 minutes
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });

    streamProcessorErrorAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.riskAlertTopic));

    // Malformed data rate alarm (custom metric - to be implemented in Lambda)
    const malformedDataRateAlarm = new cloudwatch.Alarm(this, 'MalformedDataRateAlarm', {
      alarmName: 'iops-dashboard-malformed-data-rate',
      alarmDescription: 'Alert when malformed data rate exceeds 5% of total events',
      metric: new cloudwatch.MathExpression({
        expression: '(malformed / total) * 100',
        usingMetrics: {
          malformed: new cloudwatch.Metric({
            namespace: 'IOpsDashboard',
            metricName: 'MalformedEvents',
            dimensionsMap: {
              StreamProcessor: 'validation',
            },
            period: cdk.Duration.minutes(5),
            statistic: 'Sum',
          }),
          total: new cloudwatch.Metric({
            namespace: 'IOpsDashboard',
            metricName: 'TotalEvents',
            dimensionsMap: {
              StreamProcessor: 'validation',
            },
            period: cdk.Duration.minutes(5),
            statistic: 'Sum',
          }),
        },
        period: cdk.Duration.minutes(5),
      }),
      threshold: 5, // 5% malformed data rate
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });

    malformedDataRateAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.malformedDataTopic));

    // ========================================
    // Stack Outputs
    // ========================================

    // API Endpoints
    new cdk.CfnOutput(this, 'IngestApiUrl', {
      value: api.url,
      description: 'URL of the ingestion API (use /metrics endpoint)',
      exportName: 'IOpsDashboard-IngestApiUrl',
    });

    new cdk.CfnOutput(this, 'MetricsEndpoint', {
      value: `${api.url}metrics`,
      description: 'POST endpoint for metric ingestion with validation',
      exportName: 'IOpsDashboard-MetricsEndpoint',
    });

    new cdk.CfnOutput(this, 'InsightsEndpoint', {
      value: `${api.url}insights/recent`,
      description: 'GET endpoint for retrieving recent insights',
      exportName: 'IOpsDashboard-InsightsEndpoint',
    });

    // DynamoDB
    new cdk.CfnOutput(this, 'DynamoDBTableName', {
      value: this.metricsTable.tableName,
      description: 'DynamoDB table for metrics and insights',
      exportName: 'IOpsDashboard-DynamoDBTableName',
    });

    // Lambda Functions
    new cdk.CfnOutput(this, 'IngestFunctionName', {
      value: ingestLambda.functionName,
      description: 'Ingest Lambda function (direct DynamoDB writes)',
      exportName: 'IOpsDashboard-IngestFunctionName',
    });

    new cdk.CfnOutput(this, 'AIFunctionName', {
      value: aiLambda.functionName,
      description: 'AI inference Lambda function (Bedrock Claude)',
      exportName: 'IOpsDashboard-AIFunctionName',
    });

    new cdk.CfnOutput(this, 'SimulatorFunctionName', {
      value: simulatorLambda.functionName,
      description: 'Simulator Lambda function (synthetic data generation)',
      exportName: 'IOpsDashboard-SimulatorFunctionName',
    });

    new cdk.CfnOutput(this, 'SimulatorRuleName', {
      value: simulatorRule.ruleName,
      description: 'EventBridge rule for simulator schedule (disabled by default)',
      exportName: 'IOpsDashboard-SimulatorRuleName',
    });

    // Alert System
    new cdk.CfnOutput(this, 'EventBusName', {
      value: this.eventBus.eventBusName,
      description: 'EventBridge event bus for risk-based alerts',
      exportName: 'IOpsDashboard-EventBusName',
    });

    new cdk.CfnOutput(this, 'EventBusArn', {
      value: this.eventBus.eventBusArn,
      description: 'ARN of the EventBridge event bus',
      exportName: 'IOpsDashboard-EventBusArn',
    });

    new cdk.CfnOutput(this, 'RiskAlertTopicArn', {
      value: this.riskAlertTopic.topicArn,
      description: 'SNS topic ARN for high-risk alerts (risk >= 80)',
      exportName: 'IOpsDashboard-RiskAlertTopicArn',
    });

    new cdk.CfnOutput(this, 'AlertDLQUrl', {
      value: alertDLQ.queueUrl,
      description: 'Dead letter queue URL for failed alert notifications',
      exportName: 'IOpsDashboard-AlertDLQUrl',
    });

    new cdk.CfnOutput(this, 'AlertDLQArn', {
      value: alertDLQ.queueArn,
      description: 'Dead letter queue ARN for failed alert notifications',
      exportName: 'IOpsDashboard-AlertDLQArn',
    });

    // Kinesis Resources
    new cdk.CfnOutput(this, 'KinesisStreamName', {
      value: this.eventsStream.streamName,
      description: 'Kinesis Data Stream name for event ingestion',
      exportName: 'IOpsDashboard-KinesisStreamName',
    });

    new cdk.CfnOutput(this, 'KinesisStreamArn', {
      value: this.eventsStream.streamArn,
      description: 'Kinesis Data Stream ARN',
      exportName: 'IOpsDashboard-KinesisStreamArn',
    });

    new cdk.CfnOutput(this, 'ArchiveBucketName', {
      value: this.archiveBucket.bucketName,
      description: 'S3 bucket for archived events',
      exportName: 'IOpsDashboard-ArchiveBucketName',
    });

    new cdk.CfnOutput(this, 'MalformedDataTopicArn', {
      value: this.malformedDataTopic.topicArn,
      description: 'SNS topic ARN for malformed data alerts',
      exportName: 'IOpsDashboard-MalformedDataTopicArn',
    });

    new cdk.CfnOutput(this, 'StreamProcessorFunctionName', {
      value: streamProcessorLambda.functionName,
      description: 'Stream Processor Lambda function name',
      exportName: 'IOpsDashboard-StreamProcessorFunctionName',
    });

    // Architecture Summary
    new cdk.CfnOutput(this, 'ArchitectureSummary', {
      value: 'API Gateway → Ingest Lambda → Kinesis Stream → Stream Processor → DynamoDB | Firehose → S3 Archive',
      description: 'Event-driven architecture with Kinesis buffering, validation, and archival',
    });
  }
}
