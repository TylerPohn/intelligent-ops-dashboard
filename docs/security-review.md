# IOps Dashboard - Security Review

**Review Date:** November 5, 2025
**Reviewer:** Architecture Review Agent
**Classification:** Internal - Security Assessment
**Status:** ⚠️ MODERATE RISK (Safe for dev, needs hardening for production)

---

## Executive Summary

The IOps Dashboard demonstrates **reasonable security for a development environment** but requires several hardening measures before production deployment. No critical vulnerabilities were found, but multiple areas need attention to meet enterprise security standards.

### 🎯 Security Posture: 6/10

**Strengths:**
- ✅ No hardcoded secrets
- ✅ IAM role-based authentication
- ✅ Encryption at rest enabled
- ✅ CORS properly configured
- ✅ No SQL injection vectors (DynamoDB)

**Weaknesses:**
- ⚠️ No API authentication/authorization
- ⚠️ Overly broad IAM permissions
- ⚠️ No WAF or rate limiting
- ⚠️ No secrets management (Secrets Manager)
- ⚠️ No VPC isolation

---

## 1. Authentication & Authorization

### ❌ API Gateway - No Authentication

**Current State:**
```typescript
// From cdk/lib/cdk-stack.ts - No auth configured
const api = new apigateway.RestApi(this, 'IngestApi', {
  // No authorizer, no API keys, no resource policies
});
```

**Risk:** Anyone with the API URL can:
- Ingest unlimited fake events
- Query insights without authorization
- Perform denial-of-service attacks

**Severity:** 🔴 HIGH (for production)

**Recommendation:**
```typescript
// Add API key requirement
const apiKey = new apigateway.ApiKey(this, 'IngestApiKey');
const usagePlan = new apigateway.UsagePlan(this, 'UsagePlan', {
  throttle: {
    rateLimit: 100,  // 100 req/sec per key
    burstLimit: 200,
  },
});
usagePlan.addApiKey(apiKey);

// OR use IAM authorization for internal services
ingestResource.addMethod('POST', integration, {
  authorizationType: apigateway.AuthorizationType.IAM,
});

// OR use Cognito for user authentication
const authorizer = new apigateway.CognitoUserPoolsAuthorizer(
  this, 'Authorizer', { cognitoUserPools: [userPool] }
);
```

**Priority:** HIGH (before production)

---

### ⚠️ Lambda Execution - IAM Only

**Current State:**
```typescript
// All Lambdas use IAM role-based auth (good)
const lambdaExecutionRole = new iam.Role(this, 'LambdaExecutionRole', {
  assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
});
```

**✅ Good:** Uses AWS IAM (no credentials in code)
**⚠️ Issue:** Single shared role for all Lambdas

**Risk:** If one Lambda is compromised, attacker gains access to:
- Kinesis (read/write)
- DynamoDB (read/write all tables)
- EventBridge (publish to any bus)
- Bedrock (expensive API calls)

**Recommendation:**
```typescript
// Create separate role per Lambda
const ingestRole = new iam.Role(this, 'IngestLambdaRole', {
  assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
});
ingestRole.addToPolicy(new iam.PolicyStatement({
  actions: ['kinesis:PutRecord'],
  resources: [this.eventStream.streamArn],
}));

const processRole = new iam.Role(this, 'ProcessLambdaRole', {
  assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
});
// Only grant permissions this Lambda actually needs
```

**Priority:** MEDIUM (best practice)

---

## 2. IAM Permissions Analysis

### 🔴 Critical: Wildcard EventBridge Permission

**Code:**
```typescript
// From cdk/lib/cdk-stack.ts (lines 201-205)
this.lambdaExecutionRole.addToPolicy(new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: ['events:PutEvents'],
  resources: ['*'],  // ⚠️ ALLOWS ANY EVENT BUS
}));
```

**Risk Assessment:**
- **Severity:** MEDIUM
- **Exploitability:** LOW (requires Lambda compromise)
- **Impact:** HIGH (can publish to AWS account's EventBridge)

**Attack Scenario:**
1. Attacker compromises Process Lambda (e.g., via dependency vulnerability)
2. Uses `events:PutEvents` permission to publish malicious events
3. Triggers other EventBridge rules in AWS account
4. Potentially escalates privileges or causes disruption

**Fix:**
```typescript
// Scope to specific event bus
this.lambdaExecutionRole.addToPolicy(new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: ['events:PutEvents'],
  resources: [this.eventBus.eventBusArn],  // ✅ SPECIFIC ARN
}));
```

**Priority:** HIGH (easy fix, significant risk reduction)

---

### ✅ Good: Scoped Bedrock Permission

**Code:**
```typescript
// From cdk/lib/cdk-stack.ts (lines 232-238)
aiLambda.addToRolePolicy(new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: ['bedrock:InvokeModel'],
  resources: [
    `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-3-5-haiku-20241022:0`,
  ],
}));
```

**✅ CORRECT:** Scoped to specific model (prevents abuse of more expensive models)

---

### ✅ Good: DynamoDB Least Privilege

**Code:**
```typescript
// From cdk/lib/cdk-stack.ts (line 67)
this.metricsTable.grantReadWriteData(this.lambdaExecutionRole);
```

**✅ CORRECT:** Uses CDK grant method (automatically scopes to table ARN + indexes)

---

### IAM Security Scorecard

| Permission | Scope | Risk | Status |
|-----------|-------|------|--------|
| Kinesis Read/Write | Specific stream | Low | ✅ Good |
| DynamoDB Read/Write | Specific table + GSI | Low | ✅ Good |
| EventBridge PutEvents | Wildcard `*` | Medium | ⚠️ Fix |
| Bedrock InvokeModel | Specific model | Low | ✅ Good |
| Lambda Basic Execution | Logs only | Low | ✅ Good |

**Overall IAM Score:** 7/10 (Good with one fix needed)

---

## 3. Data Protection

### ✅ Encryption at Rest

**DynamoDB:**
```typescript
// Default encryption enabled (AWS managed keys)
// No code needed - DynamoDB encrypts by default
```

**Kinesis:**
```
// Default encryption enabled (AWS managed keys)
// Optional: Add customer-managed KMS key
```

**SQS (DLQ):**
```typescript
// From cdk/lib/cdk-stack.ts (line 254)
encryption: sqs.QueueEncryption.SQS_MANAGED,  // ✅ ENABLED
```

**✅ VERDICT:** All data encrypted at rest

---

### ✅ Encryption in Transit

**API Gateway:** HTTPS only (enforced by default)
**Lambda ↔ AWS Services:** TLS 1.2+ (AWS internal)
**Kinesis:** TLS enforced
**EventBridge:** TLS enforced

**✅ VERDICT:** All data encrypted in transit

---

### ⚠️ Sensitive Data Handling

**Potential Issues:**

1. **Lambda Environment Variables:**
   ```typescript
   environment: {
     OPENAI_API_KEY: 'sk-xxx',  // ⚠️ COMMENTED OUT (good)
   }
   ```
   **Risk:** If uncommented, API key would be visible in AWS Console

   **Fix:** Use AWS Secrets Manager
   ```typescript
   const secret = secretsmanager.Secret.fromSecretNameV2(
     this, 'OpenAIKey', 'openai-api-key'
   );

   aiLambda.addEnvironment('OPENAI_API_KEY',
     secret.secretValueFromJson('apiKey').toString()
   );
   secret.grantRead(aiLambda);
   ```

2. **CloudWatch Logs May Contain PII:**
   ```python
   # From lambda/process/handler.py
   print(f"Processing event: {incoming_event.event_type}")
   # May log student IDs, emails, etc.
   ```

   **Risk:** PII in logs violates GDPR/CCPA
   **Fix:** Redact sensitive fields before logging
   ```python
   logger.info('Processing event', extra={
       'event_type': event_type,
       'entity_id': hash_pii(entity_id),  # Hash or mask
   })
   ```

**Priority:** MEDIUM (implement before handling real user data)

---

## 4. Network Security

### ⚠️ No VPC Isolation

**Current:** All Lambdas run in AWS-managed VPC (no network isolation)

**Pros:**
- Simpler architecture
- No NAT Gateway costs
- Internet access for external APIs (Bedrock)

**Cons:**
- Can't use private DynamoDB endpoints
- Can't use VPC security groups
- Can't block internet egress

**Recommendation for Production:**
```typescript
// Option 1: VPC with private endpoints
const vpc = new ec2.Vpc(this, 'Vpc', { natGateways: 1 });

const lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSG', {
  vpc,
  description: 'Security group for Lambda functions',
});

// Lambda in VPC
const processLambda = new lambda.Function(this, 'ProcessFunction', {
  vpc,
  securityGroups: [lambdaSecurityGroup],
  vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
});

// Private DynamoDB endpoint (no internet)
vpc.addGatewayEndpoint('DynamoDBEndpoint', {
  service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
});
```

**Trade-off:** $30-50/month for NAT Gateway
**Priority:** OPTIONAL (depends on compliance requirements)

---

### ❌ No Web Application Firewall (WAF)

**Current:** API Gateway has no WAF protection

**Risks:**
- SQL injection (not applicable to DynamoDB)
- XSS attacks (if API returns user input)
- DDoS attacks (rate limiting only at API Gateway level)
- Bot traffic

**Recommendation:**
```typescript
const webAcl = new wafv2.CfnWebACL(this, 'ApiWaf', {
  scope: 'REGIONAL',
  defaultAction: { allow: {} },
  rules: [
    {
      name: 'RateLimitRule',
      priority: 1,
      statement: {
        rateBasedStatement: {
          limit: 2000,  // 2000 req per 5 min per IP
          aggregateKeyType: 'IP',
        },
      },
      action: { block: {} },
    },
    {
      name: 'AWSManagedRulesCommonRuleSet',
      priority: 2,
      statement: {
        managedRuleGroupStatement: {
          vendorName: 'AWS',
          name: 'AWSManagedRulesCommonRuleSet',
        },
      },
      overrideAction: { none: {} },
    },
  ],
});

// Associate with API Gateway
const association = new wafv2.CfnWebACLAssociation(this, 'ApiWafAssociation', {
  resourceArn: api.deploymentStage.stageArn,
  webAclArn: webAcl.attrArn,
});
```

**Cost:** ~$5-10/month
**Priority:** HIGH (for production)

---

## 5. Logging & Monitoring

### ⚠️ No Centralized Security Logging

**Missing:**
1. **CloudTrail Data Events:**
   - No logging of DynamoDB reads/writes
   - No logging of Lambda invocations

2. **API Gateway Access Logs:**
   - No request/response logging
   - No IP address tracking

3. **VPC Flow Logs:**
   - Not applicable (no VPC)

**Recommendation:**
```typescript
// Enable CloudTrail data events
const trail = new cloudtrail.Trail(this, 'SecurityTrail', {
  includeGlobalServiceEvents: true,
});

trail.addLambdaEventSelector([processLambda, aiLambda]);
trail.addS3EventSelector([{
  bucket: logBucket,
  objectPrefix: 'dynamodb/',
}]);

// Enable API Gateway access logging
const logGroup = new logs.LogGroup(this, 'ApiAccessLogs');
api.deploymentStage.methodOptions = {
  '/*/*': {
    loggingLevel: apigateway.MethodLoggingLevel.INFO,
    dataTraceEnabled: true,
  },
};
```

**Cost:** ~$5-15/month for logs
**Priority:** HIGH (security visibility)

---

### ⚠️ No Real-Time Security Monitoring

**Missing:**
- No GuardDuty (threat detection)
- No Security Hub (compliance posture)
- No CloudWatch anomaly detection

**Recommendation:**
```bash
# Enable GuardDuty
aws guardduty create-detector --enable

# Enable Security Hub
aws securityhub enable-security-hub

# Enable Config Rules
aws configservice put-configuration-recorder --configuration-recorder name=default,roleARN=arn:aws:iam::ACCOUNT:role/ConfigRole
```

**Cost:** ~$10-20/month
**Priority:** MEDIUM (depends on threat model)

---

## 6. Secrets Management

### ⚠️ Environment Variables for Secrets

**Current:**
```typescript
// From cdk/lib/cdk-stack.ts (line 224)
environment: {
  // OPENAI_API_KEY: 'sk-xxx',  // Commented out
}
```

**✅ Good:** No secrets currently hardcoded
**⚠️ Risk:** Pattern suggests secrets were planned for env vars

**Recommendation:**
```typescript
// Use AWS Secrets Manager
const openaiSecret = new secretsmanager.Secret(this, 'OpenAIKey', {
  description: 'OpenAI API Key for fallback inference',
  generateSecretString: {
    secretStringTemplate: JSON.stringify({}),
    generateStringKey: 'apiKey',
  },
});

aiLambda.addEnvironment('OPENAI_SECRET_ARN', openaiSecret.secretArn);
openaiSecret.grantRead(aiLambda);

// In Lambda code:
// const secret = await secretsmanager.getSecretValue({
//   SecretId: process.env.OPENAI_SECRET_ARN
// });
```

**Priority:** HIGH (before adding any secrets)

---

### ⚠️ No Secrets Rotation

**Issue:** Even with Secrets Manager, no automatic rotation configured

**Recommendation:**
```typescript
const secret = new secretsmanager.Secret(this, 'OpenAIKey', {
  rotationSchedule: secretsmanager.RotationSchedule.rate(Duration.days(30)),
  rotationLambda: rotationFunction,
});
```

**Priority:** MEDIUM (best practice)

---

## 7. Input Validation

### ✅ TypeScript Type Safety

**Ingest Lambda:**
```typescript
// Validates event structure at compile-time
interface IngestEvent {
  event_type: string;
  payload: Record<string, any>;
}
```

**✅ Good:** TypeScript prevents type confusion attacks

---

### ⚠️ No Runtime Validation

**Issue:** No schema validation at API Gateway

**Example Attack:**
```json
POST /ingest
{
  "event_type": "../../../etc/passwd",
  "payload": {
    "student_id": "<script>alert(1)</script>"
  }
}
```

**Current:** Lambda accepts and processes malformed data

**Recommendation:**
```typescript
// Add request validator
const requestValidator = new apigateway.RequestValidator(
  this, 'RequestValidator', {
    validateRequestBody: true,
    validateRequestParameters: true,
  }
);

// Define JSON schema
const eventSchema = {
  type: 'object',
  required: ['event_type', 'payload'],
  properties: {
    event_type: {
      type: 'string',
      enum: ['session_started', 'session_completed', ...],
    },
    payload: { type: 'object' },
  },
};

ingestResource.addMethod('POST', integration, {
  requestValidator,
  requestModels: {
    'application/json': new apigateway.Model(this, 'EventModel', {
      schema: eventSchema,
    }),
  },
});
```

**Priority:** MEDIUM (defense in depth)

---

## 8. Dependency Security

### ⚠️ No Dependency Scanning

**Current:** No automated vulnerability scanning for:
- Python packages (boto3, requests)
- Node.js packages (aws-sdk, etc.)
- CDK constructs

**Recommendation:**
```yaml
# Add to .github/workflows/security.yml
name: Security Scan
on: [push, pull_request]
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2

      # Python dependency scan
      - name: Python Security Check
        run: |
          pip install safety
          safety check -r lambda/ai/requirements.txt

      # Node.js dependency scan
      - name: NPM Audit
        run: |
          cd lambda/ingest && npm audit
          cd cdk && npm audit

      # SAST scan
      - name: Semgrep Scan
        run: |
          pip install semgrep
          semgrep --config auto .
```

**Priority:** HIGH (continuous security)

---

### ✅ Minimal Dependencies

**AI Lambda requirements.txt:**
```
boto3==1.34.0
requests==2.31.0
```

**✅ Good:** Only 2 dependencies (small attack surface)

---

## 9. Compliance & Regulations

### GDPR (General Data Protection Regulation)

**Requirements:**
1. ✅ Data encryption (at rest and in transit)
2. ⚠️ Right to deletion (need TTL + purge process)
3. ⚠️ Data minimization (logs may contain PII)
4. ❌ Consent management (not implemented)
5. ❌ Data breach notification (no process)

**Compliance Score:** 2/5 (needs significant work)

---

### HIPAA (Health Insurance Portability and Accountability Act)

**Not Applicable** (no health data in current schema)

**If Health Data Added:**
- ❌ Need BAA (Business Associate Agreement) with AWS
- ❌ Need HIPAA-compliant logging
- ❌ Need audit trail for all data access
- ❌ Need encrypted backups

---

### SOC 2 Type II

**Requirements:**
1. ⚠️ Access controls (IAM good, but no MFA enforcement)
2. ⚠️ Change management (no approval process for CDK changes)
3. ❌ Security monitoring (no SIEM)
4. ⚠️ Incident response (no runbook)
5. ⚠️ Vendor management (AWS is SOC 2, but no vendor assessment)

**Compliance Score:** 2/5 (needs process improvements)

---

## 10. Incident Response

### ❌ No Incident Response Plan

**Missing:**
1. Security runbooks
2. Escalation procedures
3. Backup/restore procedures
4. Post-mortem templates

**Recommendation:**
```markdown
# Security Incident Runbook

## Detection
- CloudWatch Alarm triggers
- GuardDuty findings
- Manual report

## Containment
1. Disable compromised API keys
2. Revoke Lambda IAM credentials
3. Isolate affected resources

## Eradication
1. Identify root cause
2. Patch vulnerabilities
3. Update IAM policies

## Recovery
1. Restore from backups
2. Re-deploy infrastructure
3. Verify functionality

## Post-Mortem
1. Document timeline
2. Identify improvements
3. Update runbooks
```

**Priority:** MEDIUM (before production)

---

## 11. Security Recommendations by Priority

### 🔴 HIGH PRIORITY (Before Production)

1. **Add API Authentication**
   - Implement API keys or Cognito
   - Block unauthorized access
   - **Effort:** 1 day
   - **Cost:** $0 (API keys free)

2. **Scope EventBridge Permission**
   - Change wildcard to specific ARN
   - Prevent event bus abuse
   - **Effort:** 5 minutes
   - **Cost:** $0

3. **Enable CloudTrail Data Events**
   - Track DynamoDB access
   - Enable Lambda logging
   - **Effort:** 1 hour
   - **Cost:** ~$10/month

4. **Add WAF to API Gateway**
   - Block common attacks
   - Rate limit per IP
   - **Effort:** 2 hours
   - **Cost:** ~$5-10/month

5. **Implement Secrets Manager**
   - Store API keys securely
   - Enable rotation
   - **Effort:** 4 hours
   - **Cost:** ~$0.40/secret/month

**Total Effort:** 2 days
**Total Cost:** ~$15-20/month

---

### 🟡 MEDIUM PRIORITY (Within 3 Months)

6. **Separate Lambda IAM Roles**
   - One role per function
   - Least privilege
   - **Effort:** 1 day

7. **Add Request Validation**
   - JSON schema at API Gateway
   - Runtime checks
   - **Effort:** 1 day

8. **Enable GuardDuty + Security Hub**
   - Threat detection
   - Compliance monitoring
   - **Effort:** 2 hours
   - **Cost:** ~$15/month

9. **Create Security Runbooks**
   - Incident response procedures
   - Escalation paths
   - **Effort:** 3 days

10. **PII Redaction in Logs**
    - Hash sensitive fields
    - Comply with GDPR
    - **Effort:** 2 days

**Total Effort:** 8 days
**Total Cost:** ~$15/month

---

### 🟢 LOW PRIORITY (Nice to Have)

11. **VPC Isolation**
    - Private subnets
    - VPC endpoints
    - **Effort:** 2 days
    - **Cost:** ~$30-50/month

12. **Dependency Scanning CI/CD**
    - Automated vulnerability checks
    - GitHub Actions
    - **Effort:** 1 day
    - **Cost:** $0

13. **Secrets Rotation Automation**
    - Auto-rotate every 30 days
    - Lambda rotation function
    - **Effort:** 2 days

**Total Effort:** 5 days
**Total Cost:** ~$30-50/month

---

## 12. Security Testing Checklist

### Manual Testing

- [ ] Attempt API access without authentication
- [ ] Send malformed JSON to /ingest endpoint
- [ ] Try SQL injection in event payloads
- [ ] Attempt XSS in student IDs
- [ ] Test rate limiting (1000+ req/sec)
- [ ] Verify CORS blocks unauthorized origins
- [ ] Check CloudWatch logs for PII leaks
- [ ] Attempt Lambda invocation without IAM role
- [ ] Test DynamoDB access from external IP
- [ ] Verify Bedrock API key cannot be extracted

### Automated Testing

```bash
# Install tools
pip install bandit safety semgrep

# Run SAST
semgrep --config auto .

# Check Python dependencies
safety check -r lambda/ai/requirements.txt

# Scan for secrets
trufflehog filesystem . --only-verified

# IAM policy analysis
aws accessanalyzer create-analyzer --analyzer-name iops-dashboard

# Penetration testing (external tool)
nmap -sV -sC <api-gateway-url>
```

---

## 13. Security Metrics

### Current Security Posture

| Category | Score | Grade |
|----------|-------|-------|
| Authentication/Authorization | 3/10 | ❌ F |
| IAM Permissions | 7/10 | ✅ C+ |
| Data Protection | 8/10 | ✅ B |
| Network Security | 4/10 | ⚠️ D+ |
| Logging/Monitoring | 4/10 | ⚠️ D+ |
| Secrets Management | 5/10 | ⚠️ D |
| Input Validation | 5/10 | ⚠️ D |
| Dependency Security | 5/10 | ⚠️ D |
| Compliance | 4/10 | ⚠️ D+ |
| Incident Response | 2/10 | ❌ F |

**Overall Security Score:** 47/100 = **4.7/10** (D grade)

### Target Security Posture (Production)

| Category | Target Score |
|----------|--------------|
| Authentication/Authorization | 9/10 |
| IAM Permissions | 9/10 |
| Data Protection | 9/10 |
| Network Security | 8/10 |
| Logging/Monitoring | 9/10 |
| Secrets Management | 8/10 |
| Input Validation | 8/10 |
| Dependency Security | 8/10 |
| Compliance | 7/10 |
| Incident Response | 7/10 |

**Target Overall Score:** 82/100 = **8.2/10** (B grade)

---

## 14. Summary

### 🔴 Critical Risks

| Risk | Severity | Fix Effort | Priority |
|------|----------|-----------|----------|
| No API authentication | HIGH | 1 day | 🔴 CRITICAL |
| Wildcard EventBridge permission | MEDIUM | 5 min | 🔴 CRITICAL |
| No secrets management | MEDIUM | 4 hours | 🔴 HIGH |
| No security logging | MEDIUM | 1 hour | 🔴 HIGH |
| No WAF protection | MEDIUM | 2 hours | 🔴 HIGH |

### ✅ Security Strengths

- Encryption at rest and in transit
- No hardcoded secrets
- IAM role-based authentication
- Minimal dependencies (small attack surface)
- Serverless architecture (reduced attack surface)

### 📊 Verdict

**Current Status:** Safe for development environment
**Production Ready:** NO (requires security hardening)
**Estimated Time to Production-Ready:** 2-3 weeks
**Estimated Cost Increase:** ~$30-50/month for security services

---

## Document Metadata

- **Classification:** Internal - Security Assessment
- **Author:** Architecture Review Agent
- **Review Date:** November 5, 2025
- **Next Review:** After security hardening implementation
- **Distribution:** Security Team, Engineering Lead, Compliance Officer

---

**END OF SECURITY REVIEW**
