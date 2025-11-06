# Deployment Readiness Checklist
## IOPS Dashboard - Production Deployment Validation

**Last Updated:** November 5, 2025
**Target Environment:** Production
**Deployment Type:** Full System with AI Inference

---

## Pre-Deployment Checklist

### Infrastructure Validation

#### AWS Account & Credentials
- [ ] AWS account configured with correct credentials
- [ ] Deployment IAM user has sufficient permissions
- [ ] MFA enabled on deployment account
- [ ] AWS CLI configured and tested (`aws sts get-caller-identity`)
- [ ] Target region selected (us-east-2 recommended)
- [ ] Account limits verified for all services

#### CDK Prerequisites
- [ ] CDK installed globally (`npm install -g aws-cdk`)
- [ ] CDK bootstrapped in target account/region
- [ ] CDK version >= 2.100.0
- [ ] TypeScript dependencies installed in /cdk
- [ ] CDK synthesis successful (`cdk synth`)
- [ ] No drift in existing stack (if updating)

#### Environment Configuration
- [ ] Environment variables configured (.env file or Secrets Manager)
- [ ] CRITICAL_ALERT_EMAILS set (comma-separated)
- [ ] AWS_REGION set correctly
- [ ] AI_ENABLED flag set (true/false)
- [ ] USE_SAGEMAKER flag set (false initially)
- [ ] OPENAI_API_KEY configured (optional fallback)

#### Cost Controls
- [ ] AWS Budget configured ($500/month recommended)
- [ ] Budget alerts set to 80% threshold
- [ ] CloudWatch alarms configured for cost tracking
- [ ] Bedrock request quotas reviewed (2000 RPM default)
- [ ] DynamoDB on-demand billing enabled
- [ ] Lambda concurrency limits set

---

## Code Readiness Checklist

### AI Lambda Critical Fixes

#### Retry Logic Implementation ⚠️ **REQUIRED BEFORE PROD**
- [ ] Exponential backoff retry implemented (1s, 2s, 4s)
- [ ] MAX_RETRIES constant defined (3 recommended)
- [ ] Retry on ThrottlingException
- [ ] Retry on ServiceUnavailable
- [ ] Stop retrying on ValidationException
- [ ] Test retry logic with mock throttling

**Code Required:**
```python
def generate_insight_with_retry(metric: dict, retries: int = 3) -> dict:
    for attempt in range(retries):
        try:
            return generate_insight(metric)
        except ClientError as e:
            if e.response['Error']['Code'] == 'ThrottlingException':
                if attempt < retries - 1:
                    delay = 2 ** attempt  # 1s, 2s, 4s
                    time.sleep(delay)
                    continue
            raise
```

#### Rules-Based Fallback ⚠️ **REQUIRED BEFORE PROD**
- [ ] `fallback_insight()` function implemented
- [ ] Rules for high utilization (>90% → resource_saturation)
- [ ] Rules for high latency (>2x baseline → performance_degradation)
- [ ] Rules for high error rate (>5% → connection_instability)
- [ ] Fallback insights flagged with `source: 'fallback'`
- [ ] Test fallback logic when Bedrock unavailable

**Code Required:**
```python
def fallback_insight(metric: dict) -> dict:
    if metric['utilization'] > 90:
        return {
            'prediction_type': 'resource_saturation',
            'risk_score': 85,
            'explanation': f"Port utilization at {metric['utilization']}% (fallback)",
            'recommendations': ['Scale workload', 'Check for hot spots'],
            'confidence': 0.6,
            'source': 'fallback'
        }
    # ... other rules
```

#### EventBridge High-Risk Trigger ⚠️ **REQUIRED BEFORE PROD**
- [ ] EventBridge client initialized
- [ ] `trigger_alert()` function implemented
- [ ] Alerts sent for risk_score >= 80
- [ ] Event source: 'iops.ai.lambda'
- [ ] DetailType: 'Critical Insight'
- [ ] Event includes: alert_id, risk_score, stream_id, explanation
- [ ] Test EventBridge → SNS flow end-to-end

**Code Required:**
```python
eventbridge = boto3.client('events')

def trigger_alert(insight: dict) -> None:
    if insight['risk_score'] >= 80:
        eventbridge.put_events(
            Entries=[{
                'Source': 'iops.ai.lambda',
                'DetailType': 'Critical Insight',
                'Detail': json.dumps({
                    'alert_id': insight['entity_id'],
                    'risk_score': insight['risk_score'],
                    'explanation': insight['explanation'],
                })
            }]
        )
```

#### Temperature Configuration Fix ✅ **QUICK WIN**
- [ ] Change temperature from 0.7 to 0.3
- [ ] Verify more deterministic predictions
- [ ] Test with sample metrics

**Code Change:**
```python
# lambda/ai/handler.py line 58
'temperature': 0.3,  # Changed from 0.7
```

#### SageMaker Integration ⚠️ **OPTIONAL (MVP: Bedrock only)**
- [ ] SageMaker client initialized
- [ ] USE_SAGEMAKER environment variable read
- [ ] `call_sagemaker()` function implemented
- [ ] Endpoint name from environment variable
- [ ] CSV serialization for input
- [ ] JSON deserialization for output
- [ ] Test with deployed SageMaker endpoint

---

## Testing Validation

### Unit Tests
- [ ] All unit tests passing (`npm run test`)
- [ ] Test coverage >= 90% (run `npm run test:coverage`)
- [ ] AI Lambda unit tests passing
- [ ] Bedrock client mocked properly
- [ ] Retry logic tested with mocked throttling
- [ ] Fallback logic tested
- [ ] DynamoDB writes tested
- [ ] EventBridge trigger tested

### Integration Tests
- [ ] Integration test suite passing
- [ ] End-to-end metric flow validated
- [ ] API Gateway → Lambda → DynamoDB flow tested
- [ ] Insight generation verified
- [ ] Dashboard query performance tested (<1s)
- [ ] TTL functionality verified (90-day expiration)
- [ ] High volume test passing (100 concurrent ingests)
- [ ] Data consistency under load verified

### Alert Flow Validation ⚠️ **CRITICAL**
- [ ] Generate test insight with risk_score=85
- [ ] Verify EventBridge event published
- [ ] Check SNS topic receives event
- [ ] Confirm email alert received
- [ ] Validate alert format and content
- [ ] Test alert deduplication (5-min window)
- [ ] Write automated test for alert flow

**Test Command:**
```bash
npm run test:alerts
```

### Performance Tests
- [ ] Load test with 200 concurrent streams
- [ ] API Gateway throttling tested (4000 burst, 2000 steady)
- [ ] Lambda concurrency verified
- [ ] DynamoDB write capacity sufficient
- [ ] Bedrock API latency measured (<2s P95)
- [ ] End-to-end latency <30s (metric → insight)
- [ ] Dashboard query latency <1s

**Test Command:**
```bash
npm run test:performance -- --streams=200 --duration=300
```

### Cost Validation
- [ ] Run test workload for 24 hours
- [ ] Calculate actual costs vs. estimates
- [ ] Verify Bedrock costs <$20/day
- [ ] Verify Lambda costs <$1/day
- [ ] Verify DynamoDB costs <$0.50/day
- [ ] Total daily cost <$2 (extrapolates to <$60/month)
- [ ] Cost alarms triggered correctly

---

## Security Validation

### IAM & Permissions
- [ ] Lambda execution roles follow least privilege
- [ ] No wildcard permissions in policies
- [ ] Bedrock permissions scoped to specific models
- [ ] DynamoDB permissions scoped to specific table
- [ ] EventBridge permissions scoped
- [ ] SNS publish permissions scoped
- [ ] Service roles documented

### Secrets Management
- [ ] No hardcoded credentials in code
- [ ] Environment variables not committed to git
- [ ] .env files in .gitignore
- [ ] Secrets Manager used for sensitive data (optional for MVP)
- [ ] API keys rotated regularly

### API Security
- [ ] API Gateway authentication enabled (⚠️ **Required for Prod**)
  - Cognito user pool created
  - API Gateway authorizer configured
  - Frontend auth implemented
- [ ] CORS configured correctly (not wildcard for prod)
- [ ] Request validation enabled
- [ ] Rate limiting configured (2000 RPS)
- [ ] Logging enabled for all API calls

### Data Encryption
- [ ] DynamoDB encryption at rest enabled (AWS managed)
- [ ] Lambda environment variables encrypted
- [ ] S3 buckets encrypted (if ML pipeline)
- [ ] HTTPS enforced for API Gateway
- [ ] Logs encrypted in CloudWatch

### Network Security
- [ ] VPC configuration reviewed (if applicable)
- [ ] Security groups restrict access
- [ ] No public S3 buckets
- [ ] No public snapshots or AMIs

---

## Monitoring & Alerting

### CloudWatch Alarms Verified
- [ ] Ingest Lambda error alarm tested
- [ ] Ingest Lambda throttle alarm tested
- [ ] AI Lambda error alarm tested
- [ ] DynamoDB read capacity alarm tested
- [ ] DynamoDB write capacity alarm tested
- [ ] API Gateway 4XX alarm tested
- [ ] API Gateway 5XX alarm tested
- [ ] Lambda duration alarm tested
- [ ] SNS actions configured for all alarms
- [ ] Alert notifications received

### Additional Monitoring (Recommended)
- [ ] Bedrock throttling alarm created
- [ ] Cost alarm created ($50/month threshold)
- [ ] Fallback rate metric created
- [ ] CloudWatch dashboard created
- [ ] Custom metrics implemented
  - AI inference success rate
  - Fallback usage rate
  - Insight generation latency
  - Risk score distribution

### Logging Configuration
- [ ] Lambda logs retention set (7-30 days)
- [ ] Structured logging implemented
- [ ] Log level configurable (INFO for prod)
- [ ] Error logs include stack traces
- [ ] Request IDs tracked through system
- [ ] PII not logged

---

## Documentation Validation

### Required Documentation
- [ ] README.md updated with deployment instructions
- [ ] Architecture diagram current (NO Kinesis, direct DynamoDB)
- [ ] API documentation complete
- [ ] Environment variable documentation complete
- [ ] Troubleshooting guide created ⚠️ **Missing**
- [ ] Operational runbook created ⚠️ **Missing**
- [ ] Cost breakdown documented
- [ ] Security best practices documented

### Runbook Must Include ⚠️ **Required for Prod**
- [ ] Incident response procedures
- [ ] Escalation paths
- [ ] Common issues and solutions
- [ ] Rollback procedures
- [ ] Scaling procedures
- [ ] Backup/restore procedures
- [ ] Monitoring checklist
- [ ] On-call playbook

### Code Documentation
- [ ] All functions have docstrings
- [ ] Complex logic commented
- [ ] TypeScript types documented
- [ ] API contracts documented (OpenAPI/Swagger)

---

## Deployment Steps Validation

### Pre-Deployment
- [ ] Announce maintenance window (if updating)
- [ ] Backup current DynamoDB data (if updating)
- [ ] Tag resources appropriately
- [ ] Set stack termination protection
- [ ] Document deployment plan
- [ ] Communicate with stakeholders

### Deployment Execution
- [ ] Run `./scripts/deploy/deploy-all.sh prod`
- [ ] Monitor CloudFormation stack progress
- [ ] Verify no rollback occurred
- [ ] Capture stack outputs (API endpoint, table name)
- [ ] Save deployment logs
- [ ] Record deployment metadata

### Post-Deployment Validation
- [ ] API health check passing (`/health` endpoint)
- [ ] Ingest endpoint working (`/metrics` POST)
- [ ] Query endpoint working (`/insights/recent` GET)
- [ ] Generate test data (`npm run generate:demo`)
- [ ] Verify insights appear in dashboard
- [ ] Check CloudWatch Logs for errors
- [ ] Verify alarms not triggering
- [ ] Test alert flow with high-risk insight

### Smoke Tests
- [ ] Ingest 10 test metrics via API
- [ ] Wait 30 seconds for processing
- [ ] Query insights API
- [ ] Verify 10 insights generated
- [ ] Check risk scores calculated correctly
- [ ] Verify recommendations present
- [ ] Check TTL set on all items

---

## ML Pipeline Deployment (Optional)

### Data Preparation ⚠️ **Not Done Yet**
- [ ] Generate 10K training insights
- [ ] Export to S3 bucket
- [ ] Verify CSV format correct
- [ ] Split data: 70% train, 15% val, 15% test
- [ ] 25 features engineered
- [ ] Data quality validated

### SageMaker Training
- [ ] S3 bucket created (`iops-ml-training`)
- [ ] Training data uploaded to S3
- [ ] SageMaker execution role configured
- [ ] XGBoost container image URI verified
- [ ] Classifier training job launched (50 tuning jobs)
- [ ] Regressor training job launched (50 tuning jobs)
- [ ] Training jobs completed successfully
- [ ] Model accuracy >90% validated

### Endpoint Deployment
- [ ] Classifier endpoint deployed
- [ ] Regressor endpoint deployed
- [ ] Instance type: ml.t3.medium
- [ ] Auto-scaling configured (1-3 instances)
- [ ] Endpoint health check passing
- [ ] Inference latency <500ms
- [ ] Cost monitoring enabled

### Lambda Integration
- [ ] AI Lambda updated with SageMaker support
- [ ] USE_SAGEMAKER=true environment variable set
- [ ] SAGEMAKER_ENDPOINT_NAME environment variable set
- [ ] Test inference through Lambda
- [ ] Fallback to Bedrock on SageMaker error
- [ ] Performance comparison (SageMaker vs. Bedrock)

---

## Rollback Procedures

### Trigger Conditions for Rollback
- [ ] AI Lambda error rate > 10%
- [ ] Bedrock cost > $50/day
- [ ] >50% insights using fallback
- [ ] Critical alerts false positive rate > 20%
- [ ] API Gateway 5XX errors > 5%
- [ ] DynamoDB throttling errors
- [ ] User-reported critical bugs

### Rollback Steps (Execute if Triggered)

#### Step 1: Disable AI (Immediate - 5 minutes)
```bash
aws lambda update-function-configuration \
  --function-name IOpsDashboard-AIFunction \
  --environment Variables="{AI_ENABLED=false}" \
  --region us-east-2
```

#### Step 2: Rollback CDK Stack (If Necessary - 15 minutes)
```bash
cd cdk
cdk deploy --rollback  # Or deploy previous version
```

#### Step 3: Verify Rollback
- [ ] Check AI Lambda logs (AI invocations should stop)
- [ ] Verify Bedrock costs stop increasing
- [ ] Dashboard still receiving data (existing flow)
- [ ] No data loss occurred
- [ ] Monitor for 1 hour

#### Step 4: Root Cause Analysis
- [ ] Review CloudWatch Logs for errors
- [ ] Check Bedrock API responses
- [ ] Analyze insight quality issues
- [ ] Review cost breakdown
- [ ] Document findings

#### Step 5: Fix and Re-Deploy
- [ ] Fix identified issues
- [ ] Test in dev environment
- [ ] Re-deploy with AI_ENABLED=false
- [ ] Gradually re-enable with lower sampling rate

### Rollback Validation
- [ ] System back to stable state
- [ ] No ongoing errors
- [ ] Users notified of resolution
- [ ] Post-mortem documented
- [ ] Action items created

---

## Success Criteria

### Technical Metrics
- [ ] 99.9% AI Lambda success rate
- [ ] <5% fallback usage
- [ ] Zero data loss
- [ ] <30s end-to-end latency (metric → insight)
- [ ] <2s Bedrock API P95 latency
- [ ] Handle 100+ events/minute sustained

### Quality Metrics
- [ ] >90% prediction type accuracy (vs. expert review)
- [ ] Risk scores within ±10 points of manual assessment
- [ ] >85% recommendations rated "actionable"
- [ ] <5% false positive rate for critical alerts

### Cost Metrics
- [ ] Stay within $500/month budget
- [ ] <$0.01 cost per insight
- [ ] 50%+ cost reduction via optimizations (after initial period)

### Operational Metrics
- [ ] Zero manual intervention required
- [ ] Alerts arrive within 60s of detection
- [ ] 24/7 autonomous operation
- [ ] No unplanned downtime

---

## Final Sign-Off

### Development Team
- [ ] Code review completed
- [ ] All tests passing
- [ ] Documentation complete
- [ ] Deployment guide validated

### Operations Team
- [ ] Monitoring configured
- [ ] Alerts tested
- [ ] Runbook reviewed
- [ ] On-call rotation prepared

### Security Team
- [ ] Security scan completed
- [ ] IAM permissions reviewed
- [ ] Secrets management validated
- [ ] Compliance requirements met

### Management
- [ ] Budget approved
- [ ] Timeline accepted
- [ ] Risk assessment reviewed
- [ ] Go/No-Go decision made

---

## Deployment Decision

**Date:** _______________
**Environment:** [ ] Staging [ ] Production
**Deployment Lead:** _______________

### Go/No-Go Criteria

**GO if:**
- All critical checklist items completed (marked ⚠️ **REQUIRED**)
- All tests passing
- Security validation passed
- Documentation complete
- Monitoring configured
- Rollback plan tested

**NO-GO if:**
- Any critical item incomplete
- Test failures
- Security issues unresolved
- Missing documentation
- Monitoring not configured
- Rollback plan not tested

### Decision
- [ ] **GO** - Proceed with deployment
- [ ] **NO-GO** - Address issues and re-evaluate

**Reason (if NO-GO):** _______________________________________________

**Signatures:**
- Deployment Lead: _________________ Date: _______
- Tech Lead: _________________ Date: _______
- Security Lead: _________________ Date: _______

---

## Post-Deployment Checklist

### Immediate (First Hour)
- [ ] Monitor CloudWatch Logs for errors
- [ ] Verify insights being generated
- [ ] Check alarm states (should be OK)
- [ ] Test alert flow end-to-end
- [ ] Measure API response times
- [ ] Check DynamoDB metrics

### First 24 Hours
- [ ] Monitor cost accumulation
- [ ] Check Bedrock throttling metrics
- [ ] Verify fallback rate <5%
- [ ] Review all CloudWatch alarms
- [ ] Test dashboard UI thoroughly
- [ ] Gather initial user feedback

### First Week
- [ ] Daily cost review
- [ ] Performance metrics review
- [ ] Quality spot checks (insight accuracy)
- [ ] False positive rate tracking
- [ ] User satisfaction survey
- [ ] Optimization opportunities identified

### First Month
- [ ] Monthly cost review vs. budget
- [ ] Implement cost optimizations
- [ ] Quality improvements based on feedback
- [ ] Tune risk score thresholds
- [ ] Refine prompts with examples
- [ ] Document lessons learned

---

## Appendix

### Useful Commands

#### Check Deployment Status
```bash
aws cloudformation describe-stacks \
  --stack-name iops-dashboard-prod \
  --region us-east-2
```

#### Get Stack Outputs
```bash
aws cloudformation describe-stacks \
  --stack-name iops-dashboard-prod \
  --query 'Stacks[0].Outputs' \
  --region us-east-2
```

#### Check Lambda Logs
```bash
aws logs tail /aws/lambda/IOpsDashboard-AIFunction \
  --follow --region us-east-2
```

#### Test API Endpoint
```bash
curl -X POST https://API_ENDPOINT/metrics \
  -H "Content-Type: application/json" \
  -d '{"stream_id": "test", "timestamp": "2025-11-05T12:00:00Z", ...}'
```

#### Check Bedrock Costs
```bash
aws ce get-cost-and-usage \
  --time-period Start=2025-11-01,End=2025-11-06 \
  --granularity DAILY \
  --metrics UnblendedCost \
  --filter '{"Dimensions":{"Key":"SERVICE","Values":["Amazon Bedrock"]}}'
```

### Contact Information

**On-Call Rotation:**
- Primary: _______________
- Secondary: _______________
- Escalation: _______________

**Stakeholders:**
- Product Owner: _______________
- Tech Lead: _______________
- DevOps Lead: _______________

**External Contacts:**
- AWS Support: Case # _______________
- Vendor Support: _______________

---

**Checklist Version:** 1.0
**Last Updated:** November 5, 2025
**Next Review:** After first production deployment
