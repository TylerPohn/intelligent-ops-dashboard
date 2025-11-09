#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CdkStack } from '../lib/cdk-stack';
import { ExperienceStack } from '../lib/experience-stack';

try {
  console.log('[CDK] Starting CDK app initialization...');

  const app = new cdk.App();

  // Set default values for required environment variables
  const criticalEmails = process.env.CRITICAL_ALERT_EMAILS || 'no-reply@example.com';
  const warningEmails = process.env.WARNING_ALERT_EMAILS || 'no-reply@example.com';
  const infoEmails = process.env.INFO_ALERT_EMAILS || 'no-reply@example.com';

  console.log('[CDK] Alert email configuration:');
  console.log(`  CRITICAL: ${criticalEmails}`);
  console.log(`  WARNING: ${warningEmails}`);
  console.log(`  INFO: ${infoEmails}`);

  const env = {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  };

  console.log('[CDK] Environment configuration:');
  console.log(`  Account: ${env.account}`);
  console.log(`  Region: ${env.region}`);

  // Deploy Core Stack with all Lambda functions and infrastructure
  console.log('[CDK] Creating Core Stack...');
  const coreStack = new CdkStack(app, 'IOpsDashboard-CoreStack', {
    env,
    description: 'Core infrastructure for Intelligent Operations Dashboard with Lambdas and Kinesis',
  });
  console.log('[CDK] Core Stack created successfully');

  // Deploy Experience Stack with WebSocket API and real-time updates
  console.log('[CDK] Creating Experience Stack...');
  new ExperienceStack(app, 'IOpsDashboard-ExperienceStack', {
    env,
    description: 'WebSocket API and real-time dashboard updates infrastructure',
    metricsTable: coreStack.metricsTable,
  });
  console.log('[CDK] Experience Stack created successfully');

  // NOTE: Commenting out app.synth() to allow CDK CLI to handle synth and deploy
  // console.log('[CDK] Running app.synth()...');
  // app.synth();
  // console.log('[CDK] app.synth() completed successfully');
} catch (error) {
  console.error('[CDK] FATAL ERROR during CDK initialization:');
  console.error(error);
  process.exit(1);
}
