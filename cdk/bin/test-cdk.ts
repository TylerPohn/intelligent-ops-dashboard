#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CdkStack } from '../lib/cdk-stack';
import { ExperienceStack } from '../lib/experience-stack';

try {
  const app = new cdk.App();

  const env = {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  };

  console.log('Creating CoreStack...');
  const coreStack = new CdkStack(app, 'IOpsDashboard-CoreStack', {
    env,
    description: 'Core infrastructure for Intelligent Operations Dashboard with Lambdas and Kinesis',
  });
  console.log('CoreStack created successfully');

  console.log('Creating ExperienceStack...');
  new ExperienceStack(app, 'IOpsDashboard-ExperienceStack', {
    env,
    description: 'WebSocket API and real-time dashboard updates infrastructure',
    metricsTable: coreStack.metricsTable,
  });
  console.log('ExperienceStack created successfully');

  console.log('Calling app.synth()...');
  app.synth();
  console.log('Synth completed successfully!');
} catch (error) {
  console.error('ERROR during CDK app execution:');
  console.error(error);
  process.exit(1);
}
