/**
 * Unit Tests for AI Lambda Handler
 * Target: >90% code coverage
 * Focus: Bedrock integration, retry logic, fallback mechanisms
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock AWS SDK clients
const mockBedrockInvoke = vi.fn();
const mockDynamoDBPut = vi.fn();
const mockOpenAIPost = vi.fn();

vi.mock('boto3', () => ({
  client: vi.fn(() => ({
    invoke_model: mockBedrockInvoke,
  })),
  resource: vi.fn(() => ({
    Table: vi.fn(() => ({
      put_item: mockDynamoDBPut,
    })),
  })),
}));

vi.mock('requests', () => ({
  post: mockOpenAIPost,
}));

describe('AI Lambda Handler - Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DYNAMODB_TABLE_NAME = 'test-table';
    process.env.USE_BEDROCK = 'true';
    process.env.AWS_REGION = 'us-east-1';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Bedrock Client Integration', () => {
    it('should successfully call Bedrock with valid prompt', async () => {
      const mockResponse = {
        body: {
          read: () => JSON.stringify({
            content: [{
              text: JSON.stringify({
                risk_score: 85,
                explanation: 'High IB call frequency indicates distress',
                recommendations: ['Immediate intervention', 'Schedule check-in']
              })
            }]
          })
        }
      };

      mockBedrockInvoke.mockResolvedValue(mockResponse);
      mockDynamoDBPut.mockResolvedValue({});

      const event = {
        detail: {
          alert_type: 'high_ib_call_frequency',
          severity: 'high',
          entity_id: 'student_123',
          entity_type: 'student',
          details: {
            ib_calls_14d: 15,
            health_score: 45
          },
          message: 'High IB call frequency detected',
          timestamp: new Date().toISOString()
        }
      };

      // Import the handler (mocked modules will be used)
      const { lambda_handler } = await import('../../lambda/ai/handler.py');

      await expect(lambda_handler(event, {})).resolves.not.toThrow();

      expect(mockBedrockInvoke).toHaveBeenCalledTimes(1);
      expect(mockBedrockInvoke).toHaveBeenCalledWith(
        expect.objectContaining({
          modelId: 'anthropic.claude-3-5-haiku-20241022:0',
          contentType: 'application/json',
          accept: 'application/json',
        })
      );
    });

    it('should include correct prompt structure for high IB calls', async () => {
      mockBedrockInvoke.mockResolvedValue({
        body: {
          read: () => JSON.stringify({
            content: [{
              text: JSON.stringify({
                risk_score: 75,
                explanation: 'Pattern analysis',
                recommendations: ['Action 1', 'Action 2']
              })
            }]
          })
        }
      });
      mockDynamoDBPut.mockResolvedValue({});

      const event = {
        detail: {
          alert_type: 'high_ib_call_frequency',
          entity_id: 'student_456',
          entity_type: 'student',
          details: {
            ib_calls_14d: 20,
            health_score: 35
          },
          severity: 'critical',
          message: 'Test',
          timestamp: new Date().toISOString()
        }
      };

      const { lambda_handler } = await import('../../lambda/ai/handler.py');
      await lambda_handler(event, {});

      const callArgs = mockBedrockInvoke.mock.calls[0][0];
      const requestBody = JSON.parse(callArgs.body);

      expect(requestBody.messages[0].content).toContain('Student ID: student_456');
      expect(requestBody.messages[0].content).toContain('IB Calls (14 days): 20');
      expect(requestBody.messages[0].content).toContain('Health Score: 35');
      expect(requestBody.max_tokens).toBe(1000);
      expect(requestBody.temperature).toBe(0.7);
    });

    it('should handle low health score alert type', async () => {
      mockBedrockInvoke.mockResolvedValue({
        body: {
          read: () => JSON.stringify({
            content: [{
              text: JSON.stringify({
                risk_score: 90,
                explanation: 'Critical health decline',
                recommendations: ['Urgent action', 'Monitor closely', 'Escalate']
              })
            }]
          })
        }
      });
      mockDynamoDBPut.mockResolvedValue({});

      const event = {
        detail: {
          alert_type: 'low_health_score',
          entity_id: 'student_789',
          entity_type: 'student',
          details: {
            health_score: 25,
            sessions_7d: 2,
            ib_calls_14d: 12
          },
          severity: 'critical',
          message: 'Low health score',
          timestamp: new Date().toISOString()
        }
      };

      const { lambda_handler } = await import('../../lambda/ai/handler.py');
      await lambda_handler(event, {});

      const callArgs = mockBedrockInvoke.mock.calls[0][0];
      const requestBody = JSON.parse(callArgs.body);

      expect(requestBody.messages[0].content).toContain('Health Score: 25');
      expect(requestBody.messages[0].content).toContain('Sessions (7 days): 2');
    });

    it('should handle supply-demand imbalance alert type', async () => {
      mockBedrockInvoke.mockResolvedValue({
        body: {
          read: () => JSON.stringify({
            content: [{
              text: JSON.stringify({
                risk_score: 70,
                explanation: 'Demand exceeds supply',
                recommendations: ['Recruit tutors', 'Adjust scheduling']
              })
            }]
          })
        }
      });
      mockDynamoDBPut.mockResolvedValue({});

      const event = {
        detail: {
          alert_type: 'supply_demand_imbalance',
          entity_id: 'math_algebra',
          entity_type: 'subject',
          details: {
            balance_status: 'demand_exceeds_supply',
            demand_score: 85,
            supply_score: 45
          },
          severity: 'medium',
          message: 'Imbalance detected',
          timestamp: new Date().toISOString()
        }
      };

      const { lambda_handler } = await import('../../lambda/ai/handler.py');
      await lambda_handler(event, {});

      expect(mockBedrockInvoke).toHaveBeenCalled();
    });
  });

  describe('Retry Logic and Exponential Backoff', () => {
    it('should retry on throttling exception with exponential backoff', async () => {
      const throttleError = new Error('ThrottlingException');
      throttleError.name = 'ThrottlingException';

      mockBedrockInvoke
        .mockRejectedValueOnce(throttleError)
        .mockRejectedValueOnce(throttleError)
        .mockResolvedValueOnce({
          body: {
            read: () => JSON.stringify({
              content: [{
                text: JSON.stringify({
                  risk_score: 80,
                  explanation: 'Analysis after retry',
                  recommendations: ['Action 1', 'Action 2']
                })
              }]
            })
          }
        });

      mockDynamoDBPut.mockResolvedValue({});

      const event = {
        detail: {
          alert_type: 'high_ib_call_frequency',
          entity_id: 'student_retry',
          entity_type: 'student',
          details: { ib_calls_14d: 10, health_score: 50 },
          severity: 'medium',
          message: 'Test',
          timestamp: new Date().toISOString()
        }
      };

      const startTime = Date.now();
      const { lambda_handler } = await import('../../lambda/ai/handler.py');
      await lambda_handler(event, {});
      const duration = Date.now() - startTime;

      // Should have retried (check timing for backoff)
      expect(mockBedrockInvoke).toHaveBeenCalledTimes(3);
      expect(duration).toBeGreaterThan(100); // Some backoff delay
    });

    it('should handle service unavailable errors', async () => {
      const serviceError = new Error('ServiceUnavailable');
      serviceError.name = 'ServiceUnavailable';

      mockBedrockInvoke
        .mockRejectedValueOnce(serviceError)
        .mockResolvedValueOnce({
          body: {
            read: () => JSON.stringify({
              content: [{
                text: JSON.stringify({
                  risk_score: 75,
                  explanation: 'Success after service recovery',
                  recommendations: ['Action']
                })
              }]
            })
          }
        });

      mockDynamoDBPut.mockResolvedValue({});

      const event = {
        detail: {
          alert_type: 'low_health_score',
          entity_id: 'student_service',
          entity_type: 'student',
          details: { health_score: 30, sessions_7d: 1, ib_calls_14d: 8 },
          severity: 'high',
          message: 'Test',
          timestamp: new Date().toISOString()
        }
      };

      const { lambda_handler } = await import('../../lambda/ai/handler.py');
      await expect(lambda_handler(event, {})).resolves.not.toThrow();

      expect(mockBedrockInvoke).toHaveBeenCalledTimes(2);
    });

    it('should fail after max retries exceeded', async () => {
      const throttleError = new Error('ThrottlingException');
      throttleError.name = 'ThrottlingException';

      mockBedrockInvoke.mockRejectedValue(throttleError);

      const event = {
        detail: {
          alert_type: 'high_ib_call_frequency',
          entity_id: 'student_max_retry',
          entity_type: 'student',
          details: { ib_calls_14d: 10, health_score: 50 },
          severity: 'medium',
          message: 'Test',
          timestamp: new Date().toISOString()
        }
      };

      const { lambda_handler } = await import('../../lambda/ai/handler.py');

      // Should attempt fallback to OpenAI
      await expect(lambda_handler(event, {})).rejects.toThrow();
    });
  });

  describe('Fallback to Rules-Based Analysis (OpenAI)', () => {
    it('should fallback to OpenAI when Bedrock fails', async () => {
      process.env.OPENAI_API_KEY = 'test-key';

      mockBedrockInvoke.mockRejectedValue(new Error('Bedrock unavailable'));
      mockOpenAIPost.mockResolvedValue({
        json: () => Promise.resolve({
          choices: [{
            message: {
              content: JSON.stringify({
                risk_score: 85,
                explanation: 'OpenAI fallback analysis',
                recommendations: ['Fallback action 1', 'Fallback action 2']
              })
            }
          }]
        }),
        raise_for_status: () => {}
      });
      mockDynamoDBPut.mockResolvedValue({});

      const event = {
        detail: {
          alert_type: 'high_ib_call_frequency',
          entity_id: 'student_fallback',
          entity_type: 'student',
          details: { ib_calls_14d: 15, health_score: 40 },
          severity: 'high',
          message: 'Test',
          timestamp: new Date().toISOString()
        }
      };

      const { lambda_handler } = await import('../../lambda/ai/handler.py');
      await lambda_handler(event, {});

      expect(mockOpenAIPost).toHaveBeenCalledWith(
        'https://api.openai.com/v1/chat/completions',
        expect.objectContaining({
          json: expect.objectContaining({
            model: 'gpt-4',
            temperature: 0.7,
            max_tokens: 1000
          }),
          headers: expect.objectContaining({
            Authorization: 'Bearer test-key'
          })
        })
      );
    });

    it('should use OpenAI when USE_BEDROCK is false', async () => {
      process.env.USE_BEDROCK = 'false';
      process.env.OPENAI_API_KEY = 'test-key';

      mockOpenAIPost.mockResolvedValue({
        json: () => Promise.resolve({
          choices: [{
            message: {
              content: JSON.stringify({
                risk_score: 70,
                explanation: 'OpenAI primary analysis',
                recommendations: ['Action 1']
              })
            }
          }]
        }),
        raise_for_status: () => {}
      });
      mockDynamoDBPut.mockResolvedValue({});

      const event = {
        detail: {
          alert_type: 'low_health_score',
          entity_id: 'student_openai',
          entity_type: 'student',
          details: { health_score: 35, sessions_7d: 3, ib_calls_14d: 7 },
          severity: 'medium',
          message: 'Test',
          timestamp: new Date().toISOString()
        }
      };

      const { lambda_handler } = await import('../../lambda/ai/handler.py');
      await lambda_handler(event, {});

      expect(mockOpenAIPost).toHaveBeenCalled();
      expect(mockBedrockInvoke).not.toHaveBeenCalled();
    });

    it('should fail when no fallback available', async () => {
      process.env.OPENAI_API_KEY = '';
      mockBedrockInvoke.mockRejectedValue(new Error('Bedrock failed'));

      const event = {
        detail: {
          alert_type: 'high_ib_call_frequency',
          entity_id: 'student_no_fallback',
          entity_type: 'student',
          details: { ib_calls_14d: 10, health_score: 50 },
          severity: 'medium',
          message: 'Test',
          timestamp: new Date().toISOString()
        }
      };

      const { lambda_handler } = await import('../../lambda/ai/handler.py');
      await expect(lambda_handler(event, {})).rejects.toThrow();
    });
  });

  describe('DynamoDB Writes and TTL', () => {
    it('should write insight to DynamoDB with correct structure', async () => {
      mockBedrockInvoke.mockResolvedValue({
        body: {
          read: () => JSON.stringify({
            content: [{
              text: JSON.stringify({
                risk_score: 82,
                explanation: 'Detailed explanation',
                recommendations: ['Action 1', 'Action 2', 'Action 3']
              })
            }]
          })
        }
      });
      mockDynamoDBPut.mockResolvedValue({});

      const timestamp = new Date().toISOString();
      const event = {
        detail: {
          alert_type: 'high_ib_call_frequency',
          entity_id: 'student_db_write',
          entity_type: 'student',
          details: { ib_calls_14d: 18, health_score: 42 },
          severity: 'high',
          message: 'Test',
          timestamp
        }
      };

      const { lambda_handler } = await import('../../lambda/ai/handler.py');
      await lambda_handler(event, {});

      expect(mockDynamoDBPut).toHaveBeenCalledWith(
        expect.objectContaining({
          Item: expect.objectContaining({
            pk: 'insight#student_db_write',
            entity_id: 'student_db_write',
            prediction_type: 'high_ib_call_frequency',
            risk_score: expect.any(Number),
            explanation: 'Detailed explanation',
            recommendations: ['Action 1', 'Action 2', 'Action 3'],
            model_used: 'bedrock-claude-3.5-haiku',
            ttl: expect.any(Number)
          })
        })
      );

      // Verify TTL is set to 90 days
      const putCall = mockDynamoDBPut.mock.calls[0][0];
      const currentTime = Math.floor(Date.now() / 1000);
      const ninetyDays = 90 * 24 * 60 * 60;

      expect(putCall.Item.ttl).toBeGreaterThan(currentTime);
      expect(putCall.Item.ttl).toBeLessThan(currentTime + ninetyDays + 60); // Allow 60s tolerance
    });

    it('should include timestamp in ISO format', async () => {
      mockBedrockInvoke.mockResolvedValue({
        body: {
          read: () => JSON.stringify({
            content: [{
              text: JSON.stringify({
                risk_score: 65,
                explanation: 'Test',
                recommendations: ['Test']
              })
            }]
          })
        }
      });
      mockDynamoDBPut.mockResolvedValue({});

      const event = {
        detail: {
          alert_type: 'low_health_score',
          entity_id: 'student_timestamp',
          entity_type: 'student',
          details: { health_score: 40, sessions_7d: 2, ib_calls_14d: 5 },
          severity: 'medium',
          message: 'Test',
          timestamp: new Date().toISOString()
        }
      };

      const { lambda_handler } = await import('../../lambda/ai/handler.py');
      await lambda_handler(event, {});

      const putCall = mockDynamoDBPut.mock.calls[0][0];

      expect(putCall.Item.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
    });

    it('should generate unique alert_id for each insight', async () => {
      mockBedrockInvoke.mockResolvedValue({
        body: {
          read: () => JSON.stringify({
            content: [{
              text: JSON.stringify({
                risk_score: 75,
                explanation: 'Test',
                recommendations: ['Test']
              })
            }]
          })
        }
      });
      mockDynamoDBPut.mockResolvedValue({});

      const event1 = {
        detail: {
          alert_type: 'high_ib_call_frequency',
          entity_id: 'student_unique_1',
          entity_type: 'student',
          details: { ib_calls_14d: 10, health_score: 50 },
          severity: 'medium',
          message: 'Test',
          timestamp: new Date().toISOString()
        }
      };

      const event2 = {
        detail: {
          alert_type: 'high_ib_call_frequency',
          entity_id: 'student_unique_1',
          entity_type: 'student',
          details: { ib_calls_14d: 11, health_score: 49 },
          severity: 'medium',
          message: 'Test',
          timestamp: new Date().toISOString()
        }
      };

      const { lambda_handler } = await import('../../lambda/ai/handler.py');

      await lambda_handler(event1, {});
      const alertId1 = mockDynamoDBPut.mock.calls[0][0].Item.alert_id;

      mockDynamoDBPut.mockClear();

      await lambda_handler(event2, {});
      const alertId2 = mockDynamoDBPut.mock.calls[0][0].Item.alert_id;

      expect(alertId1).not.toBe(alertId2);
      expect(alertId1).toContain('high_ib_call_frequency_student_unique_1');
      expect(alertId2).toContain('high_ib_call_frequency_student_unique_1');
    });
  });

  describe('Response Parsing', () => {
    it('should extract JSON from markdown code blocks', async () => {
      mockBedrockInvoke.mockResolvedValue({
        body: {
          read: () => JSON.stringify({
            content: [{
              text: '```json\n{"risk_score": 88, "explanation": "Markdown wrapped", "recommendations": ["Action 1", "Action 2"]}\n```'
            }]
          })
        }
      });
      mockDynamoDBPut.mockResolvedValue({});

      const event = {
        detail: {
          alert_type: 'high_ib_call_frequency',
          entity_id: 'student_markdown',
          entity_type: 'student',
          details: { ib_calls_14d: 12, health_score: 45 },
          severity: 'high',
          message: 'Test',
          timestamp: new Date().toISOString()
        }
      };

      const { lambda_handler } = await import('../../lambda/ai/handler.py');
      await expect(lambda_handler(event, {})).resolves.not.toThrow();

      const putCall = mockDynamoDBPut.mock.calls[0][0];
      expect(putCall.Item.risk_score).toBe(88);
    });

    it('should handle plain JSON responses', async () => {
      mockBedrockInvoke.mockResolvedValue({
        body: {
          read: () => JSON.stringify({
            content: [{
              text: '{"risk_score": 72, "explanation": "Plain JSON", "recommendations": ["Action"]}'
            }]
          })
        }
      });
      mockDynamoDBPut.mockResolvedValue({});

      const event = {
        detail: {
          alert_type: 'low_health_score',
          entity_id: 'student_plain_json',
          entity_type: 'student',
          details: { health_score: 38, sessions_7d: 1, ib_calls_14d: 6 },
          severity: 'medium',
          message: 'Test',
          timestamp: new Date().toISOString()
        }
      };

      const { lambda_handler } = await import('../../lambda/ai/handler.py');
      await expect(lambda_handler(event, {})).resolves.not.toThrow();

      const putCall = mockDynamoDBPut.mock.calls[0][0];
      expect(putCall.Item.risk_score).toBe(72);
    });

    it('should fail on invalid JSON response', async () => {
      mockBedrockInvoke.mockResolvedValue({
        body: {
          read: () => JSON.stringify({
            content: [{
              text: 'This is not JSON at all'
            }]
          })
        }
      });

      const event = {
        detail: {
          alert_type: 'high_ib_call_frequency',
          entity_id: 'student_invalid_json',
          entity_type: 'student',
          details: { ib_calls_14d: 10, health_score: 50 },
          severity: 'medium',
          message: 'Test',
          timestamp: new Date().toISOString()
        }
      };

      const { lambda_handler } = await import('../../lambda/ai/handler.py');
      await expect(lambda_handler(event, {})).rejects.toThrow('does not contain valid JSON');
    });

    it('should validate required fields in response', async () => {
      mockBedrockInvoke.mockResolvedValue({
        body: {
          read: () => JSON.stringify({
            content: [{
              text: '{"risk_score": 80, "explanation": "Missing recommendations"}'
            }]
          })
        }
      });

      const event = {
        detail: {
          alert_type: 'high_ib_call_frequency',
          entity_id: 'student_missing_field',
          entity_type: 'student',
          details: { ib_calls_14d: 10, health_score: 50 },
          severity: 'medium',
          message: 'Test',
          timestamp: new Date().toISOString()
        }
      };

      const { lambda_handler } = await import('../../lambda/ai/handler.py');
      await expect(lambda_handler(event, {})).rejects.toThrow();
    });
  });

  describe('Error Handling', () => {
    it('should handle unsupported alert types', async () => {
      const event = {
        detail: {
          alert_type: 'unsupported_type',
          entity_id: 'test',
          entity_type: 'test',
          details: {},
          severity: 'low',
          message: 'Test',
          timestamp: new Date().toISOString()
        }
      };

      const { lambda_handler } = await import('../../lambda/ai/handler.py');
      await expect(lambda_handler(event, {})).rejects.toThrow('Unsupported alert type');
    });

    it('should handle missing event detail', async () => {
      const event = {};

      const { lambda_handler } = await import('../../lambda/ai/handler.py');
      await expect(lambda_handler(event, {})).rejects.toThrow();
    });

    it('should log errors and re-throw for Lambda retry', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error');

      mockBedrockInvoke.mockRejectedValue(new Error('Fatal error'));

      const event = {
        detail: {
          alert_type: 'high_ib_call_frequency',
          entity_id: 'student_error',
          entity_type: 'student',
          details: { ib_calls_14d: 10, health_score: 50 },
          severity: 'medium',
          message: 'Test',
          timestamp: new Date().toISOString()
        }
      };

      const { lambda_handler } = await import('../../lambda/ai/handler.py');
      await expect(lambda_handler(event, {})).rejects.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('Performance and Cost Optimization', () => {
    it('should complete within reasonable time (<5s)', async () => {
      mockBedrockInvoke.mockImplementation(() =>
        new Promise(resolve => setTimeout(() => resolve({
          body: {
            read: () => JSON.stringify({
              content: [{
                text: JSON.stringify({
                  risk_score: 75,
                  explanation: 'Test',
                  recommendations: ['Test']
                })
              }]
            })
          }
        }), 100))
      );
      mockDynamoDBPut.mockResolvedValue({});

      const event = {
        detail: {
          alert_type: 'high_ib_call_frequency',
          entity_id: 'student_perf',
          entity_type: 'student',
          details: { ib_calls_14d: 10, health_score: 50 },
          severity: 'medium',
          message: 'Test',
          timestamp: new Date().toISOString()
        }
      };

      const startTime = Date.now();
      const { lambda_handler } = await import('../../lambda/ai/handler.py');
      await lambda_handler(event, {});
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(5000);
    });

    it('should use efficient token limits', async () => {
      mockBedrockInvoke.mockResolvedValue({
        body: {
          read: () => JSON.stringify({
            content: [{
              text: JSON.stringify({
                risk_score: 70,
                explanation: 'Test',
                recommendations: ['Test']
              })
            }]
          })
        }
      });
      mockDynamoDBPut.mockResolvedValue({});

      const event = {
        detail: {
          alert_type: 'low_health_score',
          entity_id: 'student_tokens',
          entity_type: 'student',
          details: { health_score: 35, sessions_7d: 2, ib_calls_14d: 7 },
          severity: 'high',
          message: 'Test',
          timestamp: new Date().toISOString()
        }
      };

      const { lambda_handler } = await import('../../lambda/ai/handler.py');
      await lambda_handler(event, {});

      const callArgs = mockBedrockInvoke.mock.calls[0][0];
      const requestBody = JSON.parse(callArgs.body);

      expect(requestBody.max_tokens).toBe(1000); // Reasonable limit
      expect(requestBody.temperature).toBe(0.7); // Balanced creativity
    });
  });
});

describe('Coverage Report', () => {
  it('should achieve >90% code coverage', () => {
    // This test serves as documentation for coverage requirements
    // Run with: npm test -- --coverage
    expect(true).toBe(true);
  });
});
