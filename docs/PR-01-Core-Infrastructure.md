# PR-01: Core Infrastructure CDK Stack

## Overview
Set up the foundational AWS infrastructure using CDK, including the main stack definition, basic IAM roles, and core networking resources.

## Dependencies
- None (First PR)

## AWS Credentials Setup
**IMPORTANT**: Before running any AWS CLI or CDK commands, ensure you have AWS credentials configured.

See `/Users/tyler/Desktop/Gauntlet/iops-dashboard/docs/AWS-credentials.md` for credential setup instructions.

Quick verification:
```bash
aws sts get-caller-identity
```

## Objectives
- Initialize CDK project structure
- Create Core Stack with basic resources
- Set up IAM roles for Lambda execution
- Configure VPC (optional, use default VPC for now)

## Step-by-Step Instructions

### 1. Initialize CDK Project (DONE)
```bash
# Navigate to cdk directory
cd cdk

# Initialize CDK app if not already done
npm install -g aws-cdk
cdk init app --language=typescript
```

### 2. Install Required Dependencies
```bash
npm install @aws-cdk/aws-lambda \
            @aws-cdk/aws-iam \
            @aws-cdk/aws-logs \
            aws-cdk-lib constructs
```

### 3. Create Core Stack File (Created already but empty)
**File:** `cdk/lib/core-stack.ts`

```typescript
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';

export class CoreStack extends cdk.Stack {
  // Export these for use in other stacks
  public readonly lambdaExecutionRole: iam.Role;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create Lambda execution role
    this.lambdaExecutionRole = new iam.Role(this, 'LambdaExecutionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Execution role for all dashboard Lambdas',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Create CloudWatch log group for centralized logging
    const logGroup = new logs.LogGroup(this, 'DashboardLogGroup', {
      logGroupName: '/aws/iops-dashboard',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Output the role ARN for reference
    new cdk.CfnOutput(this, 'LambdaRoleArn', {
      value: this.lambdaExecutionRole.roleArn,
      description: 'ARN of Lambda execution role',
      exportName: 'IOpsDashboard-LambdaRoleArn',
    });

    // Output the log group name
    new cdk.CfnOutput(this, 'LogGroupName', {
      value: logGroup.logGroupName,
      description: 'CloudWatch log group for dashboard',
      exportName: 'IOpsDashboard-LogGroupName',
    });
  }
}
```

### 4. Update CDK App Entry Point
**File:** `cdk/bin/cdk.ts`

```typescript
#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CoreStack } from '../lib/core-stack';

const app = new cdk.App();

// Deploy Core Stack
new CoreStack(app, 'IOpsDashboard-CoreStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
  description: 'Core infrastructure for Intelligent Operations Dashboard',
});

app.synth();
```

### 5. Update cdk.json Configuration
**File:** `cdk/cdk.json`

Add/update these settings:
```json
{
  "app": "npx ts-node --prefer-ts-exts bin/cdk.ts",
  "context": {
    "@aws-cdk/core:enableStackNameDuplicates": false,
    "aws-cdk:enableDiffNoFail": true,
    "@aws-cdk/core:stackRelativeExports": true
  }
}
```

### 6. Bootstrap CDK (First Time Only)
```bash
# Run from cdk directory
cdk bootstrap
```

### 7. Synthesize and Deploy
```bash
# Synthesize CloudFormation template
cdk synth

# Deploy the stack
cdk deploy IOpsDashboard-CoreStack
```

## Verification Steps

1. **Check CloudFormation Console**
   - Navigate to AWS CloudFormation console
   - Verify stack `IOpsDashboard-CoreStack` shows `CREATE_COMPLETE`

2. **Verify IAM Role**
   ```bash
   aws iam get-role --role-name IOpsDashboard-CoreStack-LambdaExecutionRole-*
   ```

3. **Verify CloudWatch Log Group**
   ```bash
   aws logs describe-log-groups --log-group-name-prefix /aws/iops-dashboard
   ```

4. **Check Stack Outputs**
   ```bash
   aws cloudformation describe-stacks --stack-name IOpsDashboard-CoreStack \
     --query 'Stacks[0].Outputs'
   ```

## Expected Outputs
- Lambda execution role ARN
- CloudWatch log group name
- Stack deployed successfully with no errors

## Troubleshooting

### Issue: CDK Bootstrap Fails
**Solution:** Ensure AWS credentials are configured:
```bash
aws configure
# Verify with:
aws sts get-caller-identity
```

### Issue: TypeScript Compilation Errors
**Solution:** Ensure all dependencies are installed:
```bash
npm install
```

### Issue: Stack Already Exists
**Solution:** Update instead of create:
```bash
cdk deploy --force
```

## Files Created
- `cdk/lib/core-stack.ts`
- `cdk/bin/cdk.ts`
- `cdk/cdk.json` (updated)

## Next Steps
- Proceed to PR-02: Data Ingestion Lambda
- The Lambda execution role created here will be used by all subsequent Lambdas

## Estimated Time
- 30-45 minutes for first-time setup
- 15-20 minutes if CDK already bootstrapped

## Skills Required
- Basic TypeScript knowledge
- Familiarity with AWS CLI
- Understanding of IAM roles (basic)

## References
- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [CDK TypeScript Workshop](https://cdkworkshop.com/)
- [IAM Roles for Lambda](https://docs.aws.amazon.com/lambda/latest/dg/lambda-intro-execution-role.html)
