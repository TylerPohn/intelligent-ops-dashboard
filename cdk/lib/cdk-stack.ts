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
import * as path from 'path';

export class CdkStack extends cdk.Stack {
  public readonly lambdaExecutionRole: iam.Role;
  public readonly metricsTable: dynamodb.Table;
  public readonly eventBus: events.EventBus;
  public readonly riskAlertTopic: sns.Topic;

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

    // Create Ingestion Lambda (TypeScript) - Direct DynamoDB writes
    const ingestLambda = new lambda.Function(this, 'IngestFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/ingest/dist')),
      role: this.lambdaExecutionRole,
      environment: {
        DYNAMODB_TABLE_NAME: this.metricsTable.tableName,
        EVENT_BUS_NAME: 'default', // Will be updated to custom bus
      },
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      description: 'Ingests metrics and writes directly to DynamoDB with pattern detection (TypeScript)',
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

    // Create AI Inference Lambda (Python) - SageMaker + Bedrock + Rules fallback
    const aiLambda = new lambda.Function(this, 'AIFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'handler.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../src/lambda/ai-analysis'), {
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
        INSIGHTS_TABLE: this.metricsTable.tableName,
        USE_SAGEMAKER: 'true',
        SAGEMAKER_ENDPOINT: 'iops-classifier-lite',
        SAGEMAKER_REGRESSOR_ENDPOINT: 'iops-regressor-lite',
        EVENT_BUS_NAME: 'default', // Will be updated to custom bus
      },
      timeout: cdk.Duration.seconds(60),
      memorySize: 1024,
      description: 'AI inference with SageMaker ML + Bedrock + Rules fallback (Python)',
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
        `arn:aws:sagemaker:${this.region}:${this.account}:endpoint/iops-classifier-lite`,
        `arn:aws:sagemaker:${this.region}:${this.account}:endpoint/iops-regressor-lite`,
      ],
    }));

    // ========================================
    // EventBridge + SNS Risk-Based Alerts System
    // ========================================

    // Create custom EventBridge event bus for alerts
    this.eventBus = new events.EventBus(this, 'AlertEventBus', {
      eventBusName: 'iops-dashboard-alerts',
      description: 'Event bus for routing IOps Dashboard risk-based alerts',
    });

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

    // NOTE: Email subscriptions removed from CDK to avoid pending confirmation issues
    // Add subscriptions manually via AWS Console or CLI:
    // aws sns subscribe --topic-arn <ARN> --protocol email --notification-endpoint your-email@example.com

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

    // Architecture Summary
    new cdk.CfnOutput(this, 'ArchitectureSummary', {
      value: 'API Gateway /metrics → Ingest Lambda → DynamoDB → AI Lambda (Bedrock) → EventBridge (risk>=80) → SNS',
      description: 'Simplified architecture: No Kinesis, direct DynamoDB writes, risk-based alerts',
    });
  }
}
