import { APIError } from '@anthropic-ai/sdk';
import dedent from 'dedent';
import { clearCache, disableCache, enableCache, getCache } from '../../../src/cache';
import { AnthropicMessagesProvider } from '../../../src/providers/anthropic/messages';
import { MCPClient } from '../../../src/providers/mcp/client';
import type Anthropic from '@anthropic-ai/sdk';

jest.mock('proxy-agent', () => ({
  ProxyAgent: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../../../src/providers/mcp/client');

describe('AnthropicMessagesProvider', () => {
  let provider: AnthropicMessagesProvider;
  let mockMCPClient: jest.Mocked<MCPClient>;

  beforeEach(() => {
    jest.resetAllMocks();
    mockMCPClient = {
      initialize: jest.fn(),
      cleanup: jest.fn(),
      getAllTools: jest.fn().mockReturnValue([]),
    } as any;
    jest.mocked(MCPClient).mockImplementation(() => mockMCPClient);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await clearCache();
  });

  describe('callApi', () => {
    const tools: Anthropic.Tool[] = [
      {
        name: 'get_weather',
        description: 'Get the current weather in a given location',
        input_schema: {
          type: 'object',
          properties: {
            location: {
              type: 'string',
              description: 'The city and state, e.g. San Francisco, CA',
            },
            unit: {
              type: 'string',
              enum: ['celsius', 'fahrenheit'],
            },
          },
          required: ['location'],
        },
      },
    ];

    const provider = new AnthropicMessagesProvider('claude-3-5-sonnet-20241022', {
      config: { tools },
    });

    it('should use cache by default for ToolUse requests', async () => {
      jest
        .spyOn(provider.anthropic.messages, 'create')
        .mockImplementation()
        .mockResolvedValue({
          content: [
            {
              type: 'text',
              text: '<thinking>I need to use the get_weather, and the user wants SF, which is likely San Francisco, CA.</thinking>',
            },
            {
              type: 'tool_use',
              id: 'toolu_01A09q90qw90lq917835lq9',
              name: 'get_weather',
              input: { location: 'San Francisco, CA', unit: 'celsius' },
            },
          ],
        } as Anthropic.Messages.Message);

      const result = await provider.callApi('What is the forecast in San Francisco?');
      expect(provider.anthropic.messages.create).toHaveBeenCalledTimes(1);
      expect(provider.anthropic.messages.create).toHaveBeenNthCalledWith(
        1,
        {
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 1024,
          messages: [
            {
              role: 'user',
              content: [
                {
                  text: 'What is the forecast in San Francisco?',
                  type: 'text',
                },
              ],
            },
          ],
          tools,
          temperature: 0,
          stream: false,
        },
        {},
      );

      expect(result).toMatchObject({
        cost: undefined,
        output: dedent`<thinking>I need to use the get_weather, and the user wants SF, which is likely San Francisco, CA.</thinking>

          {"type":"tool_use","id":"toolu_01A09q90qw90lq917835lq9","name":"get_weather","input":{"location":"San Francisco, CA","unit":"celsius"}}`,
        tokenUsage: {},
      });

      const resultFromCache = await provider.callApi('What is the forecast in San Francisco?');
      expect(provider.anthropic.messages.create).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject(resultFromCache);
    });

    it('should pass the tool choice if specified', async () => {
      const toolChoice: Anthropic.MessageCreateParams['tool_choice'] = {
        name: 'get_weather',
        type: 'tool',
      };
      provider.config.tool_choice = toolChoice;
      jest
        .spyOn(provider.anthropic.messages, 'create')
        .mockImplementation()
        .mockResolvedValue({
          content: [
            {
              type: 'text',
              text: '<thinking>I need to use the get_weather, and the user wants SF, which is likely San Francisco, CA.</thinking>',
            },
            {
              type: 'tool_use',
              id: 'toolu_01A09q90qw90lq917835lq9',
              name: 'get_weather',
              input: { location: 'San Francisco, CA', unit: 'celsius' },
            },
          ],
        } as Anthropic.Messages.Message);

      await provider.callApi('What is the forecast in San Francisco?');
      expect(provider.anthropic.messages.create).toHaveBeenCalledTimes(1);
      expect(provider.anthropic.messages.create).toHaveBeenNthCalledWith(
        1,
        {
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 1024,
          messages: [
            {
              role: 'user',
              content: [
                {
                  text: 'What is the forecast in San Francisco?',
                  type: 'text',
                },
              ],
            },
          ],
          tools,
          tool_choice: toolChoice,
          temperature: 0,
          stream: false,
        },
        {},
      );

      provider.config.tool_choice = undefined;
    });

    it('should include extra_body parameters in API call', async () => {
      const provider = new AnthropicMessagesProvider('claude-3-5-sonnet-20241022', {
        config: {
          extra_body: {
            top_p: 0.9,
            custom_param: 'test_value',
          },
        },
      });

      jest
        .spyOn(provider.anthropic.messages, 'create')
        .mockImplementation()
        .mockResolvedValue({
          content: [{ type: 'text', text: 'Test response' }],
        } as Anthropic.Messages.Message);

      await provider.callApi('Test prompt');

      expect(provider.anthropic.messages.create).toHaveBeenCalledTimes(1);
      expect(provider.anthropic.messages.create).toHaveBeenCalledWith(
        {
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 1024,
          messages: [
            {
              role: 'user',
              content: [{ type: 'text', text: 'Test prompt' }],
            },
          ],
          temperature: 0,
          stream: false,
          top_p: 0.9,
          custom_param: 'test_value',
        },
        {},
      );
    });

    it('should not include extra_body when it is not an object', async () => {
      const provider = new AnthropicMessagesProvider('claude-3-5-sonnet-20241022', {
        config: {
          extra_body: undefined,
        },
      });

      jest
        .spyOn(provider.anthropic.messages, 'create')
        .mockImplementation()
        .mockResolvedValue({
          content: [{ type: 'text', text: 'Test response' }],
        } as Anthropic.Messages.Message);

      await provider.callApi('Test prompt');

      expect(provider.anthropic.messages.create).toHaveBeenCalledTimes(1);
      expect(provider.anthropic.messages.create).toHaveBeenCalledWith(
        {
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 1024,
          messages: [
            {
              role: 'user',
              content: [{ type: 'text', text: 'Test prompt' }],
            },
          ],
          temperature: 0,
          stream: false,
        },
        {},
      );
    });

    it('should not use cache if caching is disabled for ToolUse requests', async () => {
      jest
        .spyOn(provider.anthropic.messages, 'create')
        .mockImplementation()
        .mockResolvedValue({
          content: [
            {
              type: 'text',
              text: '<thinking>I need to use the get_weather, and the user wants SF, which is likely San Francisco, CA.</thinking>',
            },
            {
              type: 'tool_use',
              id: 'toolu_01A09q90qw90lq917835lq9',
              name: 'get_weather',
              input: { location: 'San Francisco, CA', unit: 'celsius' },
            },
          ],
        } as Anthropic.Messages.Message);

      disableCache();

      const result = await provider.callApi('What is the forecast in San Francisco?');
      expect(provider.anthropic.messages.create).toHaveBeenCalledTimes(1);

      expect(result).toMatchObject({
        output: dedent`<thinking>I need to use the get_weather, and the user wants SF, which is likely San Francisco, CA.</thinking>

          {"type":"tool_use","id":"toolu_01A09q90qw90lq917835lq9","name":"get_weather","input":{"location":"San Francisco, CA","unit":"celsius"}}`,
        tokenUsage: {},
      });

      await provider.callApi('What is the forecast in San Francisco?');
      expect(provider.anthropic.messages.create).toHaveBeenCalledTimes(2);
      enableCache();
    });

    it('should return cached response for legacy caching behavior', async () => {
      jest
        .spyOn(provider.anthropic.messages, 'create')
        .mockImplementation()
        .mockResolvedValue({
          content: [],
        } as unknown as Anthropic.Messages.Message);

      const cacheKey =
        'anthropic:{"model":"claude-3-5-sonnet-20241022","max_tokens":1024,"messages":[{"role":"user","content":[{"type":"text","text":"What is the forecast in San Francisco?"}]}],"stream":false,"temperature":0,"tools":[{"name":"get_weather","description":"Get the current weather in a given location","input_schema":{"type":"object","properties":{"location":{"type":"string","description":"The city and state, e.g. San Francisco, CA"},"unit":{"type":"string","enum":["celsius","fahrenheit"]}},"required":["location"]}}]}';

      await getCache().set(cacheKey, 'Test output');

      const result = await provider.callApi('What is the forecast in San Francisco?');
      expect(result).toMatchObject({
        output: 'Test output',
        tokenUsage: {},
      });
      expect(provider.anthropic.messages.create).toHaveBeenCalledTimes(0);
    });

    it('should handle API call error', async () => {
      const provider = new AnthropicMessagesProvider('claude-3-5-sonnet-20241022');
      jest
        .spyOn(provider.anthropic.messages, 'create')
        .mockImplementation()
        .mockRejectedValue(new Error('API call failed'));

      const result = await provider.callApi('What is the forecast in San Francisco?');
      expect(result).toMatchObject({
        error: 'API call error: API call failed',
      });
    });

    it('should handle non-Error API call errors', async () => {
      const provider = new AnthropicMessagesProvider('claude-3-5-sonnet-20241022');
      jest
        .spyOn(provider.anthropic.messages, 'create')
        .mockImplementation()
        .mockRejectedValue('Non-error object');

      const result = await provider.callApi('What is the forecast in San Francisco?');
      expect(result).toMatchObject({
        error: 'API call error: Non-error object',
      });
    });

    it('should handle APIError with error details', async () => {
      const provider = new AnthropicMessagesProvider('claude-3-5-sonnet-20241022');

      const mockApiError = Object.create(APIError.prototype);
      Object.assign(mockApiError, {
        name: 'APIError',
        message: 'API Error',
        status: 400,
        error: {
          error: {
            message: 'Invalid request parameters',
            type: 'invalid_params',
          },
        },
      });

      jest
        .spyOn(provider.anthropic.messages, 'create')
        .mockImplementation()
        .mockRejectedValue(mockApiError);

      const result = await provider.callApi('What is the forecast in San Francisco?');
      expect(result).toMatchObject({
        error: 'API call error: Invalid request parameters, status 400, type invalid_params',
      });
    });

    it('should return token usage and cost', async () => {
      const provider = new AnthropicMessagesProvider('claude-3-5-sonnet-20241022', {
        config: { max_tokens: 100, temperature: 0.5, cost: 0.015 },
      });
      jest
        .spyOn(provider.anthropic.messages, 'create')
        .mockImplementation()
        .mockResolvedValue({
          content: [{ type: 'text', text: 'Test output' }],
          usage: { input_tokens: 50, output_tokens: 50, server_tool_use: null },
        } as Anthropic.Messages.Message);

      const result = await provider.callApi('What is the forecast in San Francisco?');
      expect(result).toMatchObject({
        output: 'Test output',
        tokenUsage: { total: 100, prompt: 50, completion: 50 },
        cost: 1.5,
      });
    });

    it('should handle thinking configuration', async () => {
      const provider = new AnthropicMessagesProvider('claude-3-7-sonnet-20250219', {
        config: {
          thinking: {
            type: 'enabled',
            budget_tokens: 2048,
          },
        },
      });

      jest
        .spyOn(provider.anthropic.messages, 'create')
        .mockImplementation()
        .mockResolvedValue({
          content: [
            {
              type: 'thinking',
              thinking: 'Let me analyze this step by step...',
              signature: 'test-signature',
            },
            {
              type: 'text',
              text: 'Final answer',
            },
          ],
        } as Anthropic.Messages.Message);

      const result = await provider.callApi('What is 2+2?');
      expect(provider.anthropic.messages.create).toHaveBeenCalledWith(
        {
          model: 'claude-3-7-sonnet-20250219',
          max_tokens: 2048,
          messages: [
            {
              role: 'user',
              content: [{ type: 'text', text: 'What is 2+2?' }],
            },
          ],
          stream: false,
          temperature: undefined,
          thinking: {
            type: 'enabled',
            budget_tokens: 2048,
          },
        },
        {},
      );
      expect(result.output).toBe(
        'Thinking: Let me analyze this step by step...\nSignature: test-signature\n\nFinal answer',
      );
    });

    it('should handle redacted thinking blocks', async () => {
      const provider = new AnthropicMessagesProvider('claude-3-7-sonnet-20250219');
      jest
        .spyOn(provider.anthropic.messages, 'create')
        .mockImplementation()
        .mockResolvedValue({
          content: [
            {
              type: 'redacted_thinking',
              data: 'encrypted-data',
            },
            {
              type: 'text',
              text: 'Final answer',
            },
          ],
        } as Anthropic.Messages.Message);

      const result = await provider.callApi('What is 2+2?');
      expect(result.output).toBe('Redacted Thinking: encrypted-data\n\nFinal answer');
    });

    it('should handle API errors for thinking configuration', async () => {
      const provider = new AnthropicMessagesProvider('claude-3-7-sonnet-20250219');

      // Mock API error for invalid budget
      const mockApiError = Object.create(APIError.prototype);
      Object.assign(mockApiError, {
        name: 'APIError',
        message: 'API Error',
        status: 400,
        error: {
          error: {
            message: 'Thinking budget must be at least 1024 tokens when enabled',
            type: 'invalid_request_error',
          },
        },
      });

      jest.spyOn(provider.anthropic.messages, 'create').mockRejectedValue(mockApiError);

      const result = await provider.callApi(
        JSON.stringify([
          {
            role: 'user',
            content: 'test',
            thinking: {
              type: 'enabled',
              budget_tokens: 512,
            },
          },
        ]),
      );

      expect(result.error).toBe(
        'API call error: Thinking budget must be at least 1024 tokens when enabled, status 400, type invalid_request_error',
      );

      // Test budget exceeding max_tokens
      const providerWithMaxTokens = new AnthropicMessagesProvider('claude-3-7-sonnet-20250219', {
        config: {
          max_tokens: 2048,
        },
      });

      const mockMaxTokensError = Object.create(APIError.prototype);
      Object.assign(mockMaxTokensError, {
        name: 'APIError',
        message: 'API Error',
        status: 400,
        error: {
          error: {
            message: 'Thinking budget must be less than max_tokens',
            type: 'invalid_request_error',
          },
        },
      });

      jest
        .spyOn(providerWithMaxTokens.anthropic.messages, 'create')
        .mockRejectedValue(mockMaxTokensError);

      const result2 = await providerWithMaxTokens.callApi(
        JSON.stringify([
          {
            role: 'user',
            content: 'test',
            thinking: {
              type: 'enabled',
              budget_tokens: 3000,
            },
          },
        ]),
      );

      expect(result2.error).toBe(
        'API call error: Thinking budget must be less than max_tokens, status 400, type invalid_request_error',
      );
    });

    it('should respect explicit temperature when thinking is enabled', async () => {
      const provider = new AnthropicMessagesProvider('claude-3-7-sonnet-20250219', {
        config: {
          thinking: {
            type: 'enabled',
            budget_tokens: 2048,
          },
          temperature: 0.7,
        },
      });

      jest
        .spyOn(provider.anthropic.messages, 'create')
        .mockImplementation()
        .mockResolvedValue({
          content: [{ type: 'text', text: 'Test response' }],
        } as Anthropic.Messages.Message);

      await provider.callApi('Test prompt');
      expect(provider.anthropic.messages.create).toHaveBeenCalledWith(
        {
          model: 'claude-3-7-sonnet-20250219',
          max_tokens: 2048,
          messages: [
            {
              role: 'user',
              content: [{ type: 'text', text: 'Test prompt' }],
            },
          ],
          stream: false,
          temperature: 0.7,
          thinking: {
            type: 'enabled',
            budget_tokens: 2048,
          },
        },
        {},
      );
    });

    it('should include beta features header when specified', async () => {
      const provider = new AnthropicMessagesProvider('claude-3-7-sonnet-20250219', {
        config: {
          beta: ['output-128k-2025-02-19'],
        },
      });

      jest
        .spyOn(provider.anthropic.messages, 'create')
        .mockImplementation()
        .mockResolvedValue({
          content: [{ type: 'text', text: 'Test response' }],
        } as Anthropic.Messages.Message);

      await provider.callApi('Test prompt');
      expect(provider.anthropic.messages.create).toHaveBeenCalledWith(expect.anything(), {
        headers: {
          'anthropic-beta': 'output-128k-2025-02-19',
        },
      });
    });

    it('should include multiple beta features in header', async () => {
      const provider = new AnthropicMessagesProvider('claude-3-7-sonnet-20250219', {
        config: {
          beta: ['output-128k-2025-02-19', 'another-beta-feature'],
        },
      });

      jest
        .spyOn(provider.anthropic.messages, 'create')
        .mockImplementation()
        .mockResolvedValue({
          content: [{ type: 'text', text: 'Test response' }],
        } as Anthropic.Messages.Message);

      await provider.callApi('Test prompt');
      expect(provider.anthropic.messages.create).toHaveBeenCalledWith(expect.anything(), {
        headers: {
          'anthropic-beta': 'output-128k-2025-02-19,another-beta-feature',
        },
      });
    });

    describe('finish reason handling', () => {
      it('should surface a normalized finishReason for Anthropic reasons', async () => {
        const provider = new AnthropicMessagesProvider('claude-3-5-sonnet-20241022');
        jest
          .spyOn(provider.anthropic.messages, 'create')
          .mockImplementation()
          .mockResolvedValue({
            content: [{ type: 'text', text: 'Test response' }],
            stop_reason: 'end_turn', // Should be normalized to 'stop'
            usage: { input_tokens: 10, output_tokens: 10, server_tool_use: null },
          } as Anthropic.Messages.Message);

        const result = await provider.callApi('Test prompt');
        expect(result.finishReason).toBe('stop');
      });

      it('should normalize max_tokens to length', async () => {
        const provider = new AnthropicMessagesProvider('claude-3-5-sonnet-20241022');
        jest
          .spyOn(provider.anthropic.messages, 'create')
          .mockImplementation()
          .mockResolvedValue({
            content: [{ type: 'text', text: 'Test response' }],
            stop_reason: 'max_tokens', // Should be normalized to 'length'
            usage: { input_tokens: 10, output_tokens: 10, server_tool_use: null },
          } as Anthropic.Messages.Message);

        const result = await provider.callApi('Test prompt');
        expect(result.finishReason).toBe('length');
      });

      it('should normalize tool_use to tool_calls', async () => {
        const provider = new AnthropicMessagesProvider('claude-3-5-sonnet-20241022');
        jest
          .spyOn(provider.anthropic.messages, 'create')
          .mockImplementation()
          .mockResolvedValue({
            content: [{ type: 'text', text: 'Test response' }],
            stop_reason: 'tool_use', // Should be normalized to 'tool_calls'
            usage: { input_tokens: 10, output_tokens: 10, server_tool_use: null },
          } as Anthropic.Messages.Message);

        const result = await provider.callApi('Test prompt');
        expect(result.finishReason).toBe('tool_calls');
      });

      it('should exclude finishReason when stop_reason is null', async () => {
        const provider = new AnthropicMessagesProvider('claude-3-5-sonnet-20241022');
        jest
          .spyOn(provider.anthropic.messages, 'create')
          .mockImplementation()
          .mockResolvedValue({
            content: [{ type: 'text', text: 'Test response' }],
            stop_reason: null,
            usage: { input_tokens: 10, output_tokens: 10, server_tool_use: null },
          } as Anthropic.Messages.Message);

        const result = await provider.callApi('Test prompt');
        expect(result.finishReason).toBeUndefined();
      });

      it('should exclude finishReason when stop_reason is undefined', async () => {
        const provider = new AnthropicMessagesProvider('claude-3-5-sonnet-20241022');
        jest
          .spyOn(provider.anthropic.messages, 'create')
          .mockImplementation()
          .mockResolvedValue({
            content: [{ type: 'text', text: 'Test response' }],
            stop_reason: undefined as any,
            usage: { input_tokens: 10, output_tokens: 10, server_tool_use: null },
          } as Anthropic.Messages.Message);

        const result = await provider.callApi('Test prompt');
        expect(result.finishReason).toBeUndefined();
      });

      it('should handle cached responses with finishReason', async () => {
        const provider = new AnthropicMessagesProvider('claude-3-5-sonnet-20241022');

        const cacheKey = expect.stringContaining('anthropic:');
        await getCache().set(
          cacheKey,
          JSON.stringify({
            content: [{ type: 'text', text: 'Cached response' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 5, output_tokens: 5, server_tool_use: null },
          }),
        );

        // Set up specific cache key for our test
        jest
          .spyOn(provider.anthropic.messages, 'create')
          .mockImplementation()
          .mockResolvedValue({} as any);

        const specificCacheKey =
          'anthropic:' +
          JSON.stringify({
            model: 'claude-3-5-sonnet-20241022',
            max_tokens: 1024,
            messages: [{ role: 'user', content: [{ type: 'text', text: 'Test prompt' }] }],
            stream: false,
            temperature: 0,
          });

        await getCache().set(
          specificCacheKey,
          JSON.stringify({
            content: [{ type: 'text', text: 'Cached response' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 5, output_tokens: 5, server_tool_use: null },
          }),
        );

        const result = await provider.callApi('Test prompt');
        expect(result.finishReason).toBe('stop');
        expect(result.output).toBe('Cached response');
      });

      it('should handle unknown stop reasons by passing them through', async () => {
        const provider = new AnthropicMessagesProvider('claude-3-5-sonnet-20241022');
        jest
          .spyOn(provider.anthropic.messages, 'create')
          .mockImplementation()
          .mockResolvedValue({
            content: [{ type: 'text', text: 'Test response' }],
            stop_reason: 'unknown_reason' as any,
            usage: { input_tokens: 10, output_tokens: 10, server_tool_use: null },
          } as Anthropic.Messages.Message);

        const result = await provider.callApi('Test prompt');
        expect(result.finishReason).toBe('unknown_reason');
      });
    });
  });

  describe('cleanup', () => {
    it('should await initialization before cleanup', async () => {
      provider = new AnthropicMessagesProvider('claude-3-5-sonnet-latest', {
        config: {
          mcp: {
            enabled: true,
            server: {
              command: 'npm',
              args: ['start'],
            },
          },
        },
      });

      // Simulate initialization in progress
      const initPromise = Promise.resolve();
      provider['initializationPromise'] = initPromise;

      await provider.cleanup();

      // Verify cleanup was called after initialization
      expect(mockMCPClient.cleanup).toHaveBeenCalledWith();
    });

    it('should handle cleanup when MCP is not enabled', async () => {
      provider = new AnthropicMessagesProvider('claude-3-5-sonnet-latest', {
        config: {
          mcp: {
            enabled: false,
          },
        },
      });

      await provider.cleanup();

      expect(mockMCPClient.cleanup).not.toHaveBeenCalled();
    });

    it('should handle cleanup errors gracefully', async () => {
      provider = new AnthropicMessagesProvider('claude-3-5-sonnet-latest', {
        config: {
          mcp: {
            enabled: true,
            server: {
              command: 'npm',
              args: ['start'],
            },
          },
        },
      });

      mockMCPClient.cleanup.mockRejectedValueOnce(new Error('Cleanup failed'));

      await expect(provider.cleanup()).rejects.toThrow('Cleanup failed');
    });
  });
});
