import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { WebSocketLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { DynamoEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { StartingPosition } from 'aws-cdk-lib/aws-lambda';
import * as path from 'path';

export interface ExperienceStackProps extends cdk.StackProps {
  metricsTable: dynamodb.ITable;
}

export class ExperienceStack extends cdk.Stack {
  public readonly webSocketApi: apigwv2.WebSocketApi;
  public readonly connectionsTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: ExperienceStackProps) {
    super(scope, id, props);

    // Create DynamoDB table for tracking active WebSocket connections
    this.connectionsTable = new dynamodb.Table(this, 'ConnectionsTable', {
      tableName: 'iops-dashboard-websocket-connections',
      partitionKey: { name: 'connectionId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For dev/demo only
      timeToLiveAttribute: 'ttl',
    });

    // Add GSI for querying connections by connected timestamp
    this.connectionsTable.addGlobalSecondaryIndex({
      indexName: 'ConnectedAtIndex',
      partitionKey: { name: 'connected', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'connectedAt', type: dynamodb.AttributeType.NUMBER },
    });

    // Create shared Lambda execution role for WebSocket handlers
    const webSocketRole = new iam.Role(this, 'WebSocketLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Grant DynamoDB permissions
    this.connectionsTable.grantReadWriteData(webSocketRole);
    props.metricsTable.grantStreamRead(webSocketRole);

    // Create Connect Lambda Handler
    const connectHandler = new lambda.Function(this, 'ConnectFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'connect.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/websocket/dist')),
      role: webSocketRole,
      environment: {
        CONNECTIONS_TABLE_NAME: this.connectionsTable.tableName,
      },
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      description: 'Handles WebSocket connection events',
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Create Disconnect Lambda Handler
    const disconnectHandler = new lambda.Function(this, 'DisconnectFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'disconnect.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/websocket/dist')),
      role: webSocketRole,
      environment: {
        CONNECTIONS_TABLE_NAME: this.connectionsTable.tableName,
      },
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      description: 'Handles WebSocket disconnection events',
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Create Default Message Handler (required for WebSocket API)
    // This handles any messages that don't match specific routes
    const defaultHandler = new lambda.Function(this, 'DefaultFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'default.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/websocket/dist')),
      role: webSocketRole,
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      description: 'Default handler for WebSocket messages',
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Create WebSocket API
    // RouteSelectionExpression is intentionally omitted to use the $default route
    // This allows any message without a specific route to be handled by the default handler
    this.webSocketApi = new apigwv2.WebSocketApi(this, 'WebSocketApi', {
      apiName: 'IOpsDashboard-WebSocketApi',
      description: 'WebSocket API for real-time dashboard updates',
      routeSelectionExpression: '$default', // Explicitly set to use $default route for all messages
      connectRouteOptions: {
        integration: new WebSocketLambdaIntegration('ConnectIntegration', connectHandler),
      },
      disconnectRouteOptions: {
        integration: new WebSocketLambdaIntegration('DisconnectIntegration', disconnectHandler),
      },
      defaultRouteOptions: {
        integration: new WebSocketLambdaIntegration('DefaultIntegration', defaultHandler),
      },
    });

    // Create WebSocket Stage
    const webSocketStage = new apigwv2.WebSocketStage(this, 'WebSocketStage', {
      webSocketApi: this.webSocketApi,
      stageName: 'prod',
      autoDeploy: true,
    });

    // Create Stream Processor Lambda for broadcasting updates
    const streamProcessorHandler = new lambda.Function(this, 'StreamProcessorFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'stream-processor.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/websocket/dist')),
      role: webSocketRole,
      environment: {
        CONNECTIONS_TABLE_NAME: this.connectionsTable.tableName,
        WEBSOCKET_API_ENDPOINT: webSocketStage.callbackUrl,
      },
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      description: 'Processes DynamoDB streams and broadcasts to WebSocket clients',
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Grant execute-api:ManageConnections permission for posting to WebSocket connections
    streamProcessorHandler.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['execute-api:ManageConnections'],
      resources: [
        `arn:aws:execute-api:${this.region}:${this.account}:${this.webSocketApi.apiId}/${webSocketStage.stageName}/POST/@connections/*`,
      ],
    }));

    // Add DynamoDB Stream event source to stream processor
    streamProcessorHandler.addEventSource(
      new DynamoEventSource(props.metricsTable, {
        startingPosition: StartingPosition.LATEST,
        batchSize: 100,
        bisectBatchOnError: true,
        retryAttempts: 3,
        maxBatchingWindow: cdk.Duration.seconds(5), // Batch records for up to 5 seconds
      })
    );

    // Outputs
    new cdk.CfnOutput(this, 'WebSocketUrl', {
      value: webSocketStage.url,
      description: 'WebSocket URL for real-time updates',
      exportName: 'IOpsDashboard-WebSocketUrl',
    });

    new cdk.CfnOutput(this, 'WebSocketApiId', {
      value: this.webSocketApi.apiId,
      description: 'WebSocket API ID',
      exportName: 'IOpsDashboard-WebSocketApiId',
    });

    new cdk.CfnOutput(this, 'ConnectionsTableName', {
      value: this.connectionsTable.tableName,
      description: 'Name of the WebSocket connections DynamoDB table',
      exportName: 'IOpsDashboard-ConnectionsTableName',
    });

    new cdk.CfnOutput(this, 'StreamProcessorFunctionName', {
      value: streamProcessorHandler.functionName,
      description: 'Name of the stream processor Lambda function',
      exportName: 'IOpsDashboard-StreamProcessorFunctionName',
    });
  }
}
