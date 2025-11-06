#!/bin/bash
set -e

echo "🚀 Manually deploying Insights API"

# Variables
API_ID="dp41u4qn19"
REGION="us-east-2"
LAMBDA_ZIP="../lambda/api/dist/insights-lambda.zip"
LAMBDA_NAME="IOpsDashboard-InsightsFunction"
LAMBDA_ROLE_ARN=$(aws iam list-roles --query "Roles[?RoleName=='IOpsDashboard-CoreStack-LambdaExecutionRole'].Arn" --output text)
DYNAMODB_TABLE="iops-dashboard-metrics"

echo "Step 1: Package Lambda function"
cd ../lambda/api/dist
zip -r insights-lambda.zip *.js node_modules/
cd -

echo "Step 2: Create or update Lambda function"
if aws lambda get-function --function-name $LAMBDA_NAME --region $REGION 2>/dev/null; then
  echo "Updating existing Lambda..."
  aws lambda update-function-code \
    --function-name $LAMBDA_NAME \
    --zip-file fileb://$LAMBDA_ZIP \
    --region $REGION
else
  echo "Creating new Lambda..."
  aws lambda create-function \
    --function-name $LAMBDA_NAME \
    --runtime nodejs20.x \
    --role $LAMBDA_ROLE_ARN \
    --handler get-insights.handler \
    --zip-file fileb://$LAMBDA_ZIP \
    --timeout 30 \
    --memory-size 256 \
    --environment "Variables={DYNAMODB_TABLE_NAME=$DYNAMODB_TABLE}" \
    --region $REGION
fi

LAMBDA_ARN=$(aws lambda get-function --function-name $LAMBDA_NAME --region $REGION --query 'Configuration.FunctionArn' --output text)

echo "Step 3: Get API Gateway root resource"
ROOT_ID=$(aws apigateway get-resources --rest-api-id $API_ID --region $REGION --query 'items[?path==`/`].id' --output text)

echo "Step 4: Create /insights resource"
INSIGHTS_ID=$(aws apigateway create-resource \
  --rest-api-id $API_ID \
  --parent-id $ROOT_ID \
  --path-part insights \
  --region $REGION \
  --query 'id' \
  --output text 2>/dev/null || aws apigateway get-resources --rest-api-id $API_ID --region $REGION --query 'items[?pathPart==`insights`].id' --output text)

echo "Step 5: Create /insights/recent resource"
RECENT_ID=$(aws apigateway create-resource \
  --rest-api-id $API_ID \
  --parent-id $INSIGHTS_ID \
  --path-part recent \
  --region $REGION \
  --query 'id' \
  --output text 2>/dev/null || aws apigateway get-resources --rest-api-id $API_ID --region $REGION --query 'items[?pathPart==`recent`].id' --output text)

echo "Step 6: Add GET method to /insights/recent"
aws apigateway put-method \
  --rest-api-id $API_ID \
  --resource-id $RECENT_ID \
  --http-method GET \
  --authorization-type NONE \
  --region $REGION 2>/dev/null || echo "Method already exists"

echo "Step 7: Configure Lambda integration"
aws apigateway put-integration \
  --rest-api-id $API_ID \
  --resource-id $RECENT_ID \
  --http-method GET \
  --type AWS_PROXY \
  --integration-http-method POST \
  --uri "arn:aws:apigateway:$REGION:lambda:path/2015-03-31/functions/$LAMBDA_ARN/invocations" \
  --region $REGION

echo "Step 8: Add Lambda permission for API Gateway"
aws lambda add-permission \
  --function-name $LAMBDA_NAME \
  --statement-id apigateway-insights \
  --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:$REGION:*:$API_ID/*/GET/insights/recent" \
  --region $REGION 2>/dev/null || echo "Permission already exists"

echo "Step 9: Enable CORS on /insights/recent"
aws apigateway put-method \
  --rest-api-id $API_ID \
  --resource-id $RECENT_ID \
  --http-method OPTIONS \
  --authorization-type NONE \
  --region $REGION 2>/dev/null || echo "OPTIONS already exists"

aws apigateway put-method-response \
  --rest-api-id $API_ID \
  --resource-id $RECENT_ID \
  --http-method OPTIONS \
  --status-code 200 \
  --response-parameters '{"method.response.header.Access-Control-Allow-Headers":false,"method.response.header.Access-Control-Allow-Methods":false,"method.response.header.Access-Control-Allow-Origin":false}' \
  --region $REGION 2>/dev/null || echo "OPTIONS response already exists"

aws apigateway put-integration \
  --rest-api-id $API_ID \
  --resource-id $RECENT_ID \
  --http-method OPTIONS \
  --type MOCK \
  --request-templates '{"application/json":"{\"statusCode\": 200}"}' \
  --region $REGION 2>/dev/null || echo "OPTIONS integration already exists"

aws apigateway put-integration-response \
  --rest-api-id $API_ID \
  --resource-id $RECENT_ID \
  --http-method OPTIONS \
  --status-code 200 \
  --response-parameters '{"method.response.header.Access-Control-Allow-Headers":"'"'"'Content-Type,Authorization'"'"'","method.response.header.Access-Control-Allow-Methods":"'"'"'GET,OPTIONS'"'"'","method.response.header.Access-Control-Allow-Origin":"'"'"'*'"'"'"}' \
  --region $REGION 2>/dev/null || echo "OPTIONS integration response already exists"

echo "Step 10: Deploy API"
aws apigateway create-deployment \
  --rest-api-id $API_ID \
  --stage-name prod \
  --description "Added Insights API endpoint" \
  --region $REGION

echo "✅ Done! Test with:"
echo "curl https://dp41u4qn19.execute-api.us-east-2.amazonaws.com/prod/insights/recent?limit=5"
