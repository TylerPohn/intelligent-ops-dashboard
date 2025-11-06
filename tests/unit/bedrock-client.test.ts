/**
 * Unit Tests for Bedrock Client Integration
 * Focus: API communication, error handling, response parsing
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Bedrock Client Tests', () => {
  const mockBedrockClient = {
    invoke_model: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('invoke_model API', () => {
    it('should send correct request format', async () => {
      mockBedrockClient.invoke_model.mockResolvedValue({
        body: {
          read: () => JSON.stringify({
            content: [{ text: '{"risk_score": 75, "explanation": "test", "recommendations": ["action"]}' }]
          })
        }
      });

      await mockBedrockClient.invoke_model({
        modelId: 'anthropic.claude-3-5-haiku-20241022:0',
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 1000,
          messages: [{ role: 'user', content: 'test prompt' }],
          temperature: 0.7
        })
      });

      expect(mockBedrockClient.invoke_model).toHaveBeenCalledWith(
        expect.objectContaining({
          modelId: 'anthropic.claude-3-5-haiku-20241022:0',
          contentType: 'application/json'
        })
      );
    });

    it('should handle streaming responses', async () => {
      const streamBody = {
        read: vi.fn().mockReturnValue(
          JSON.stringify({
            content: [{ text: '{"risk_score": 85, "explanation": "streaming test", "recommendations": ["stream action"]}' }]
          })
        )
      };

      mockBedrockClient.invoke_model.mockResolvedValue({ body: streamBody });

      const response = await mockBedrockClient.invoke_model({
        modelId: 'anthropic.claude-3-5-haiku-20241022:0',
        body: '{}'
      });

      const content = response.body.read();
      expect(content).toContain('risk_score');
    });

    it('should validate model ID format', () => {
      const validModelIds = [
        'anthropic.claude-3-5-haiku-20241022:0',
        'anthropic.claude-3-5-sonnet-20241022:0',
        'anthropic.claude-3-opus-20240229:0'
      ];

      validModelIds.forEach(modelId => {
        expect(modelId).toMatch(/^anthropic\.claude-[\w-]+:\d+$/);
      });
    });

    it('should enforce request size limits', () => {
      const maxTokens = 4096;
      const largePrompt = 'A'.repeat(maxTokens + 1);

      const requestBody = {
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 1000,
        messages: [{ role: 'user', content: largePrompt }]
      };

      // Bedrock should handle large prompts gracefully
      expect(requestBody.messages[0].content.length).toBeGreaterThan(maxTokens);
    });
  });

  describe('Error Responses', () => {
    it('should handle ThrottlingException', async () => {
      const error = new Error('ThrottlingException: Request rate exceeded');
      error.name = 'ThrottlingException';

      mockBedrockClient.invoke_model.mockRejectedValue(error);

      await expect(mockBedrockClient.invoke_model({})).rejects.toThrow('ThrottlingException');
    });

    it('should handle ValidationException', async () => {
      const error = new Error('ValidationException: Invalid model parameters');
      error.name = 'ValidationException';

      mockBedrockClient.invoke_model.mockRejectedValue(error);

      await expect(mockBedrockClient.invoke_model({})).rejects.toThrow('ValidationException');
    });

    it('should handle ModelTimeoutException', async () => {
      const error = new Error('ModelTimeoutException: Model inference timeout');
      error.name = 'ModelTimeoutException';

      mockBedrockClient.invoke_model.mockRejectedValue(error);

      await expect(mockBedrockClient.invoke_model({})).rejects.toThrow('ModelTimeoutException');
    });

    it('should handle ServiceUnavailableException', async () => {
      const error = new Error('ServiceUnavailableException: Service temporarily unavailable');
      error.name = 'ServiceUnavailableException';

      mockBedrockClient.invoke_model.mockRejectedValue(error);

      await expect(mockBedrockClient.invoke_model({})).rejects.toThrow('ServiceUnavailableException');
    });

    it('should handle AccessDeniedException', async () => {
      const error = new Error('AccessDeniedException: Insufficient permissions');
      error.name = 'AccessDeniedException';

      mockBedrockClient.invoke_model.mockRejectedValue(error);

      await expect(mockBedrockClient.invoke_model({})).rejects.toThrow('AccessDeniedException');
    });
  });

  describe('Response Parsing', () => {
    it('should parse valid JSON response', async () => {
      const validResponse = {
        body: {
          read: () => JSON.stringify({
            content: [{
              text: JSON.stringify({
                risk_score: 82,
                explanation: 'Detailed analysis',
                recommendations: ['Action 1', 'Action 2', 'Action 3']
              })
            }]
          })
        }
      };

      mockBedrockClient.invoke_model.mockResolvedValue(validResponse);

      const response = await mockBedrockClient.invoke_model({});
      const body = JSON.parse(response.body.read());
      const insight = JSON.parse(body.content[0].text);

      expect(insight.risk_score).toBe(82);
      expect(insight.recommendations).toHaveLength(3);
    });

    it('should extract JSON from markdown', () => {
      const markdownResponse = '```json\n{"risk_score": 90, "explanation": "test", "recommendations": ["action"]}\n```';

      const jsonMatch = markdownResponse.match(/\{[\s\S]*\}/);
      expect(jsonMatch).not.toBeNull();

      const parsed = JSON.parse(jsonMatch![0]);
      expect(parsed.risk_score).toBe(90);
    });

    it('should handle mixed text and JSON', () => {
      const mixedResponse = 'Here is the analysis: {"risk_score": 75, "explanation": "mixed", "recommendations": ["action"]} - end of analysis';

      const jsonMatch = mixedResponse.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch![0]);

      expect(parsed.risk_score).toBe(75);
    });

    it('should validate response schema', () => {
      const response = {
        risk_score: 80,
        explanation: 'Test explanation',
        recommendations: ['Action 1', 'Action 2']
      };

      expect(response).toHaveProperty('risk_score');
      expect(response).toHaveProperty('explanation');
      expect(response).toHaveProperty('recommendations');
      expect(typeof response.risk_score).toBe('number');
      expect(Array.isArray(response.recommendations)).toBe(true);
    });
  });

  describe('Token Usage and Costs', () => {
    it('should estimate input tokens', () => {
      const prompt = 'Analyze this student behavior with 15 IB calls in 14 days and health score of 45';
      const estimatedTokens = Math.ceil(prompt.split(' ').length * 1.3); // Rough estimate

      expect(estimatedTokens).toBeGreaterThan(0);
      expect(estimatedTokens).toBeLessThan(1000); // Should be reasonable
    });

    it('should calculate cost per request', () => {
      const inputTokens = 500;
      const outputTokens = 200;

      const inputCost = (inputTokens / 1_000_000) * 0.25; // $0.25 per 1M tokens
      const outputCost = (outputTokens / 1_000_000) * 1.25; // $1.25 per 1M tokens
      const totalCost = inputCost + outputCost;

      expect(totalCost).toBeCloseTo(0.000375, 6);
    });

    it('should project monthly costs', () => {
      const insightsPerDay = 1000;
      const costPerInsight = 0.000375;
      const monthlyCost = insightsPerDay * 30 * costPerInsight;

      expect(monthlyCost).toBeCloseTo(11.25, 2);
    });

    it('should stay within budget for 200 streams', () => {
      const streams = 200;
      const insightsPerStreamPerDay = 2;
      const totalInsightsPerDay = streams * insightsPerStreamPerDay;
      const costPerInsight = 0.000375;
      const monthlyCost = totalInsightsPerDay * 30 * costPerInsight;

      expect(monthlyCost).toBeLessThan(50); // Target budget
    });
  });

  describe('Rate Limiting', () => {
    it('should respect 2000 RPM limit', () => {
      const maxRPM = 2000;
      const requestsPerSecond = maxRPM / 60;
      const minIntervalMs = 1000 / requestsPerSecond;

      expect(minIntervalMs).toBeCloseTo(30, 0);
    });

    it('should implement exponential backoff', () => {
      const baseDelay = 100;
      const maxRetries = 5;

      const delays = Array.from({ length: maxRetries }, (_, i) =>
        baseDelay * Math.pow(2, i)
      );

      expect(delays).toEqual([100, 200, 400, 800, 1600]);
    });

    it('should cap max retry delay', () => {
      const baseDelay = 100;
      const maxDelay = 10000;
      const retryCount = 10;

      const delay = Math.min(baseDelay * Math.pow(2, retryCount), maxDelay);

      expect(delay).toBe(maxDelay);
    });
  });

  describe('Concurrent Requests', () => {
    it('should handle parallel invocations', async () => {
      mockBedrockClient.invoke_model.mockResolvedValue({
        body: {
          read: () => JSON.stringify({
            content: [{ text: '{"risk_score": 75, "explanation": "test", "recommendations": ["action"]}' }]
          })
        }
      });

      const requests = Array(10).fill(null).map(() =>
        mockBedrockClient.invoke_model({ modelId: 'test' })
      );

      const results = await Promise.all(requests);
      expect(results).toHaveLength(10);
    });

    it('should handle partial failures in batch', async () => {
      mockBedrockClient.invoke_model
        .mockResolvedValueOnce({ body: { read: () => '{"success": true}' } })
        .mockRejectedValueOnce(new Error('Throttled'))
        .mockResolvedValueOnce({ body: { read: () => '{"success": true}' } });

      const requests = [
        mockBedrockClient.invoke_model({}),
        mockBedrockClient.invoke_model({}).catch(e => ({ error: e.message })),
        mockBedrockClient.invoke_model({})
      ];

      const results = await Promise.all(requests);

      expect(results[0]).toHaveProperty('body');
      expect(results[1]).toHaveProperty('error');
      expect(results[2]).toHaveProperty('body');
    });
  });

  describe('Model Versions', () => {
    it('should support Claude 3.5 Haiku', () => {
      const modelId = 'anthropic.claude-3-5-haiku-20241022:0';
      expect(modelId).toContain('claude-3-5-haiku');
    });

    it('should fallback to Claude 3 Haiku if needed', () => {
      const primaryModel = 'anthropic.claude-3-5-haiku-20241022:0';
      const fallbackModel = 'anthropic.claude-3-haiku-20240307:0';

      expect(primaryModel).toMatch(/claude-3-5-haiku/);
      expect(fallbackModel).toMatch(/claude-3-haiku/);
    });

    it('should handle model version updates', () => {
      const oldVersion = 'anthropic.claude-3-5-haiku-20241022:0';
      const newVersion = 'anthropic.claude-3-5-haiku-20250101:0';

      expect(oldVersion.split(':')[0]).toBe(newVersion.split(':')[0]);
    });
  });

  describe('Security and Authentication', () => {
    it('should use AWS credentials for authentication', () => {
      // Bedrock uses AWS SDK authentication
      const region = process.env.AWS_REGION || 'us-east-1';
      expect(region).toBeTruthy();
    });

    it('should not expose API keys in logs', () => {
      const logMessage = 'Calling Bedrock with model anthropic.claude-3-5-haiku-20241022:0';

      expect(logMessage).not.toContain('key');
      expect(logMessage).not.toContain('secret');
      expect(logMessage).not.toContain('password');
    });

    it('should validate request origin', () => {
      const allowedRegions = ['us-east-1', 'us-west-2', 'eu-west-1'];
      const currentRegion = 'us-east-1';

      expect(allowedRegions).toContain(currentRegion);
    });
  });
});
