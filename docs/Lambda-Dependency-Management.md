# Lambda Dependency Management

## Overview

This document explains how Python dependencies are managed for AWS Lambda functions in this project.

## How It Works

### CDK Automatic Bundling

The CDK stack is configured to automatically bundle Python dependencies using Docker containers. When you run `cdk deploy`, CDK will:

1. Create a Docker container with Python 3.12
2. Install dependencies from `requirements.txt`
3. Bundle them with your Lambda code
4. Upload the complete package to AWS

### What's in the Lambda Directories

Each Lambda directory should ONLY contain:

```
lambda/
├── ai/
│   ├── handler.py          ✅ Your Lambda code
│   └── requirements.txt    ✅ Dependency list
├── process/
│   ├── handler.py          ✅ Your Lambda code
│   └── requirements.txt    ✅ Dependency list
└── simulator/
    ├── handler.py          ✅ Your Lambda code
    └── requirements.txt    ✅ Dependency list
```

### What Should NOT Be in Lambda Directories

❌ **NEVER commit these to git:**
- `boto3/`, `botocore/`, `numpy/`, `pandas/`, etc. (installed packages)
- `*.dist-info/` (package metadata)
- `__pycache__/` (Python cache)
- `bin/` (package binaries)

These are automatically added to `.gitignore`.

## Local Development

### Testing Lambda Functions Locally

If you need to test a Lambda function locally with its dependencies:

```bash
# Option 1: Use a virtual environment
cd lambda/ai
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python handler.py  # Run locally
deactivate

# Option 2: Use Docker (matches AWS environment)
docker run -v $(pwd):/var/task public.ecr.aws/lambda/python:3.12 \
  bash -c "pip install -r requirements.txt && python handler.py"
```

### NEVER Do This

❌ **DON'T install packages directly into Lambda directories:**

```bash
# This is WRONG - don't do this!
cd lambda/ai
pip install -r requirements.txt -t .
```

This will dump all packages into your Lambda directory and bloat your git repository.

## Deployment

### Standard Deployment

```bash
cd cdk
npm run build
cdk deploy
```

CDK will automatically:
- Bundle Python dependencies using Docker
- Create deployment packages
- Upload to AWS Lambda

### Using Lambda Layers (Advanced)

For large dependencies or shared libraries across multiple functions, you can create Lambda Layers:

```bash
# Create layer directory structure
mkdir -p layers/python/lib/python3.12/site-packages

# Install dependencies to layer
pip install -r lambda/ai/requirements.txt -t layers/python/lib/python3.12/site-packages

# Package the layer
cd layers
zip -r ai-dependencies.zip python/

# Upload to AWS (via console or CDK)
```

Then update your CDK stack to use the layer instead of bundling.

## Troubleshooting

### "Module not found" errors in Lambda

**Cause:** Dependencies not properly bundled or layer not attached.

**Solution:**
1. Check that `requirements.txt` exists in Lambda directory
2. Verify CDK bundling configuration in `cdk/lib/cdk-stack.ts`
3. Redeploy: `cdk deploy`

### Git showing hundreds of files changed

**Cause:** Package directories installed in Lambda folders.

**Solution:**
1. Remove all package directories: `rm -rf lambda/*/boto3 lambda/*/numpy ...`
2. Check `.gitignore` includes Lambda package patterns
3. Never run `pip install -t .` in Lambda directories

### CDK bundling is slow

**Cause:** Docker bundling can be slow for large dependencies.

**Solutions:**
- Use Lambda Layers for large/stable dependencies
- Enable Docker layer caching
- Use `--no-cache` flag if builds are stale

## Best Practices

1. ✅ Keep Lambda directories clean - only handler code and requirements.txt
2. ✅ Let CDK handle bundling automatically
3. ✅ Use virtual environments for local testing
4. ✅ Use Lambda Layers for large shared dependencies
5. ✅ Keep requirements.txt minimal - only list what you actually use
6. ❌ Never install packages directly into Lambda directories
7. ❌ Never commit installed packages to git

## Reference

- [AWS CDK Lambda Documentation](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda-readme.html)
- [AWS Lambda Layers](https://docs.aws.amazon.com/lambda/latest/dg/configuration-layers.html)
- [Python Packaging for Lambda](https://docs.aws.amazon.com/lambda/latest/dg/python-package.html)
