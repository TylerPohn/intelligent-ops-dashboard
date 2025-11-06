#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CdkStack } from '../lib/cdk-stack';
import { ExperienceStack } from '../lib/experience-stack';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
};

// Deploy Core Stack with all Lambda functions and infrastructure
const coreStack = new CdkStack(app, 'IOpsDashboard-CoreStack', {
  env,
  description: 'Core infrastructure for Intelligent Operations Dashboard with Lambdas and Kinesis',
});

// Deploy Experience Stack with WebSocket API and real-time updates
new ExperienceStack(app, 'IOpsDashboard-ExperienceStack', {
  env,
  description: 'WebSocket API and real-time dashboard updates infrastructure',
  metricsTable: coreStack.metricsTable,
});

app.synth();
