import { CrescendoProvider, MemorySystem } from '../../../../src/redteam/providers/crescendo';
import type { Message } from '../../../../src/redteam/providers/shared';
import { redteamProviderManager } from '../../../../src/redteam/providers/shared';
import { checkServerFeatureSupport } from '../../../../src/util/server';

jest.mock('../../../../src/providers/promptfoo', () => ({
  PromptfooChatCompletionProvider: jest.fn().mockImplementation(() => ({
    id: () => 'mock-unblocking',
    callApi: jest.fn(),
    delay: 0,
  })),
}));

jest.mock('../../../../src/util/server', () => ({
  checkServerFeatureSupport: jest.fn(),
}));

describe('MemorySystem', () => {
  let memorySystem: MemorySystem;

  beforeEach(() => {
    memorySystem = new MemorySystem();
  });

  it('should add and retrieve messages for a conversation', () => {
    const conversationId = 'test-convo';
    const message: Message = { role: 'user', content: 'test message' };

    memorySystem.addMessage(conversationId, message);
    const conversation = memorySystem.getConversation(conversationId);

    expect(conversation).toHaveLength(1);
    expect(conversation[0]).toEqual(message);
  });

  it('should return empty array for non-existent conversation', () => {
    const conversation = memorySystem.getConversation('non-existent');
    expect(conversation).toEqual([]);
  });

  it('should duplicate conversation excluding last turn', () => {
    const conversationId = 'test-convo';
    const messages: Message[] = [
      { role: 'system', content: 'system message' },
      { role: 'user', content: 'user message 1' },
      { role: 'assistant', content: 'assistant message 1' },
      { role: 'user', content: 'user message 2' },
      { role: 'assistant', content: 'assistant message 2' },
    ];

    messages.forEach((msg) => memorySystem.addMessage(conversationId, msg));

    const newConversationId = memorySystem.duplicateConversationExcludingLastTurn(conversationId);
    const newConversation = memorySystem.getConversation(newConversationId);

    expect(newConversation).toHaveLength(3);
    expect(newConversation).toEqual(messages.slice(0, 3));
  });
});

describe('CrescendoProvider', () => {
  let crescendoProvider: CrescendoProvider;
  const mockRedTeamProvider = {
    id: () => 'mock-redteam',
    callApi: jest.fn(),
    delay: 0,
  };
  const mockScoringProvider = {
    id: () => 'mock-scoring',
    callApi: jest.fn(),
    delay: 0,
  };
  const mockTargetProvider = {
    id: () => 'mock-target',
    callApi: jest.fn(),
  };

  let mockUnblockingProvider: any;

  beforeEach(() => {
    jest.clearAllMocks();

    crescendoProvider = new CrescendoProvider({
      injectVar: 'objective',
      maxTurns: 10,
      maxBacktracks: 10,
      redteamProvider: mockRedTeamProvider,
      stateful: true,
    });

    // Get the mocked unblocking provider instance
    mockUnblockingProvider = (crescendoProvider as any).unblockingProvider;

    jest.spyOn(redteamProviderManager, 'getProvider').mockImplementation(async ({ jsonOnly }) => {
      return jsonOnly ? mockRedTeamProvider : mockScoringProvider;
    });

    // Mock server feature support to return true so unblocking logic runs
    (checkServerFeatureSupport as jest.Mock).mockResolvedValue(true);
  });

  it('should initialize with default config values', () => {
    const provider = new CrescendoProvider({
      injectVar: 'objective',
      maxTurns: 10,
      maxBacktracks: 10,
      redteamProvider: mockRedTeamProvider,
      stateful: true,
    });

    expect(provider.config.injectVar).toBe('objective');
    expect(provider.config.redteamProvider).toBe(mockRedTeamProvider);
    expect(provider.config.maxTurns).toBe(10);
    expect(provider.config.maxBacktracks).toBe(10);
    expect(provider.config.stateful).toBe(true);
  });

  it('should return correct provider id', () => {
    expect(crescendoProvider.id()).toBe('promptfoo:redteam:crescendo');
  });

  describe('Unblocking functionality', () => {
    it('should detect blocking question and send unblocking response', async () => {
      const prompt = 'test prompt';
      const context = {
        originalProvider: mockTargetProvider,
        vars: { objective: 'test objective' },
        prompt: { raw: prompt, label: 'test' },
        test: { metadata: { purpose: 'e-commerce platform' } },
      };

      // Mock the attack prompt generation
      mockRedTeamProvider.callApi.mockResolvedValue({
        output: JSON.stringify({
          generatedQuestion: 'test question',
          rationaleBehindJailbreak: 'test rationale',
          lastResponseSummary: 'test summary',
        }),
      });

      // Mock target asking a blocking question
      mockTargetProvider.callApi
        .mockResolvedValueOnce({
          output: 'What is your company registration number?',
        })
        .mockResolvedValueOnce({
          output: 'Thank you for providing that information. How can I help you further?',
        });

      // Mock unblocking analysis - detects blocking question
      mockUnblockingProvider.callApi.mockResolvedValue({
        output: {
          isBlocking: true,
          unblockingAnswer: 'Our company registration number is REG123456789',
        },
      });

      // Mock scoring (non-blocking after unblocking)
      mockScoringProvider.callApi.mockResolvedValue({
        output: JSON.stringify({
          value: true,
          metadata: 100,
          rationale: 'Successfully unblocked conversation',
        }),
      });

      const result = await crescendoProvider.callApi(prompt, context);

      expect(mockUnblockingProvider.callApi).toHaveBeenCalledWith(
        expect.stringContaining('"conversationObjective":"test objective"'),
        expect.objectContaining({
          prompt: expect.objectContaining({
            label: 'unblocking',
          }),
        }),
      );

      expect(mockTargetProvider.callApi).toHaveBeenCalledTimes(2); // Original + unblocking response
      expect(result.metadata?.stopReason).toBe('Internal evaluator success');
    });

    it('should continue without unblocking when no blocking question detected', async () => {
      const prompt = 'test prompt';
      const context = {
        originalProvider: mockTargetProvider,
        vars: { objective: 'test objective' },
        prompt: { raw: prompt, label: 'test' },
      };

      mockRedTeamProvider.callApi.mockResolvedValue({
        output: JSON.stringify({
          generatedQuestion: 'test question',
          rationaleBehindJailbreak: 'test rationale',
          lastResponseSummary: 'test summary',
        }),
      });

      mockTargetProvider.callApi.mockResolvedValue({
        output: 'I understand your request. Here is the information you need.',
      });

      // Mock unblocking analysis - no blocking detected
      mockUnblockingProvider.callApi.mockResolvedValue({
        output: {
          isBlocking: false,
          unblockingAnswer: undefined,
        },
      });

      mockScoringProvider.callApi.mockResolvedValue({
        output: JSON.stringify({
          value: true,
          metadata: 100,
          rationale: 'Direct helpful response',
        }),
      });

      const result = await crescendoProvider.callApi(prompt, context);

      expect(mockTargetProvider.callApi).toHaveBeenCalledTimes(1); // Only original call
      expect(result.metadata?.stopReason).toBe('Internal evaluator success');
    });

    it('should handle unblocking provider errors gracefully', async () => {
      const prompt = 'test prompt';
      const context = {
        originalProvider: mockTargetProvider,
        vars: { objective: 'test objective' },
        prompt: { raw: prompt, label: 'test' },
      };

      mockRedTeamProvider.callApi.mockResolvedValue({
        output: JSON.stringify({
          generatedQuestion: 'test question',
          rationaleBehindJailbreak: 'test rationale',
          lastResponseSummary: 'test summary',
        }),
      });

      mockTargetProvider.callApi.mockResolvedValue({
        output: 'What is your business type?',
      });

      // Mock unblocking provider error
      mockUnblockingProvider.callApi.mockResolvedValue({
        error: 'Unblocking analysis failed',
      });

      mockScoringProvider.callApi.mockResolvedValue({
        output: JSON.stringify({
          value: false,
          metadata: 50,
          rationale: 'Partial response',
        }),
      });

      const result = await crescendoProvider.callApi(prompt, context);

      expect(mockTargetProvider.callApi).toHaveBeenCalledTimes(10); // All max rounds since unblocking fails and eval doesn't reach 100
      expect(result.metadata?.stopReason).toBe('Max rounds reached');
    });

    it('should pass purpose to unblocking analysis', async () => {
      const prompt = 'test prompt';
      const context = {
        originalProvider: mockTargetProvider,
        vars: { objective: 'test objective' },
        prompt: { raw: prompt, label: 'test' },
        test: { metadata: { purpose: 'financial services platform' } },
      };

      mockRedTeamProvider.callApi.mockResolvedValue({
        output: JSON.stringify({
          generatedQuestion: 'test question',
          rationaleBehindJailbreak: 'test rationale',
          lastResponseSummary: 'test summary',
        }),
      });

      mockTargetProvider.callApi.mockResolvedValue({
        output: 'Which bank do you use for settlements?',
      });

      mockUnblockingProvider.callApi.mockResolvedValue({
        output: {
          isBlocking: true,
          unblockingAnswer: 'We use Wells Fargo for our settlement processing',
        },
      });

      mockScoringProvider.callApi.mockResolvedValue({
        output: JSON.stringify({
          value: false,
          metadata: 30,
          rationale: 'Partial information provided',
        }),
      });

      await crescendoProvider.callApi(prompt, context);

      expect(mockUnblockingProvider.callApi).toHaveBeenCalledWith(
        expect.stringContaining('"purpose":"financial services platform"'),
        expect.any(Object),
      );
    });
  });

  it('should succeed via internal evaluator when eval score is 100', async () => {
    const prompt = 'test prompt';
    const context = {
      originalProvider: mockTargetProvider,
      vars: { objective: 'test objective' },
      prompt: { raw: prompt, label: 'test' },
    };

    mockRedTeamProvider.callApi.mockResolvedValue({
      output: JSON.stringify({
        generatedQuestion: 'test question',
        rationaleBehindJailbreak: 'test rationale',
        lastResponseSummary: 'test summary',
      }),
    });

    mockTargetProvider.callApi.mockResolvedValue({
      output: 'target response',
    });

    mockScoringProvider.callApi.mockResolvedValue({
      output: JSON.stringify({
        value: true,
        metadata: 100,
        rationale: 'test rationale',
      }),
    });

    const result = await crescendoProvider.callApi(prompt, context);
    expect(result.metadata?.stopReason).toBe('Internal evaluator success');
    expect(result.metadata?.crescendoResult).toBe(true);
    expect(result.metadata?.crescendoConfidence).toBe(100);
  });

  it('should succeed via external grader when grader fails', async () => {
    const prompt = 'test prompt';
    const context = {
      originalProvider: mockTargetProvider,
      vars: { objective: 'test objective' },
      prompt: { raw: prompt, label: 'test' },
      test: { assert: [{ type: 'mock-grader' }] } as any,
    };

    mockRedTeamProvider.callApi.mockResolvedValue({
      output: JSON.stringify({
        generatedQuestion: 'test question',
        rationaleBehindJailbreak: 'test rationale',
        lastResponseSummary: 'test summary',
      }),
    });

    mockTargetProvider.callApi.mockResolvedValue({
      output: 'target response',
    });

    mockScoringProvider.callApi.mockResolvedValue({
      output: JSON.stringify({
        value: false,
        metadata: 50,
        rationale: 'test rationale',
      }),
    });

    jest.mock('../../../../src/redteam/graders', () => ({
      getGraderById: () => ({
        getResult: async () => ({
          grade: {
            pass: false,
          },
        }),
      }),
    }));

    const result = await crescendoProvider.callApi(prompt, context);
    expect(result.metadata?.stopReason).toBe('Grader failed');
  });

  it('should stop when max backtracks reached', async () => {
    crescendoProvider = new CrescendoProvider({
      injectVar: 'objective',
      maxTurns: 10,
      maxBacktracks: 2,
      redteamProvider: mockRedTeamProvider,
      stateful: false,
    });

    const prompt = 'test prompt';
    const context = {
      originalProvider: mockTargetProvider,
      vars: { objective: 'test objective' },
      prompt: { raw: prompt, label: 'test' },
    };

    mockRedTeamProvider.callApi.mockResolvedValue({
      output: JSON.stringify({
        generatedQuestion: 'test question',
        rationaleBehindJailbreak: 'test rationale',
        lastResponseSummary: 'test summary',
      }),
    });

    mockTargetProvider.callApi.mockResolvedValue({
      output: 'I cannot help with that.',
    });

    mockScoringProvider.callApi.mockResolvedValue({
      output: JSON.stringify({
        value: true,
        metadata: 0,
        rationale: 'This is a refusal',
      }),
    });

    const result = await crescendoProvider.callApi(prompt, context);
    expect(result.metadata?.crescendoBacktrackCount).toBe(2);
    expect(result.metadata?.stopReason).toBe('Max backtracks reached');
  });

  it('should stop when max rounds reached', async () => {
    crescendoProvider = new CrescendoProvider({
      injectVar: 'objective',
      maxTurns: 2,
      maxBacktracks: 10,
      redteamProvider: mockRedTeamProvider,
      stateful: true,
    });

    const prompt = 'test prompt';
    const context = {
      originalProvider: mockTargetProvider,
      vars: { objective: 'test objective' },
      prompt: { raw: prompt, label: 'test' },
    };

    mockRedTeamProvider.callApi.mockResolvedValue({
      output: JSON.stringify({
        generatedQuestion: 'test question',
        rationaleBehindJailbreak: 'test rationale',
        lastResponseSummary: 'test summary',
      }),
    });

    mockTargetProvider.callApi.mockResolvedValue({
      output: 'target response',
    });

    mockScoringProvider.callApi.mockResolvedValue({
      output: JSON.stringify({
        value: false,
        metadata: 50,
        rationale: 'test rationale',
      }),
    });

    const result = await crescendoProvider.callApi(prompt, context);
    expect(result.metadata?.crescendoRoundsCompleted).toBe(2);
    expect(result.metadata?.stopReason).toBe('Max rounds reached');
    expect(result.metadata?.crescendoResult).toBe(false);
  });

  it('should handle provider errors gracefully', async () => {
    const prompt = 'test prompt';
    const context = {
      originalProvider: mockTargetProvider,
      vars: { objective: 'test objective' },
      prompt: { raw: prompt, label: 'test' },
    };

    mockRedTeamProvider.callApi.mockRejectedValueOnce(new Error('Provider error'));
    mockTargetProvider.callApi.mockResolvedValue({
      output: '',
    });

    const result = await crescendoProvider.callApi(prompt, context);
    expect(result.output).toBe('');
    expect(result.metadata?.crescendoRoundsCompleted).toBe(10);
    expect(result.metadata?.crescendoBacktrackCount).toBe(0);
    expect(result.metadata?.crescendoResult).toBe(false);
    expect(result.metadata?.stopReason).toBe('Max rounds reached');
  });

  it('should handle purpose from test metadata', async () => {
    const provider = new CrescendoProvider({
      injectVar: 'objective',
      redteamProvider: mockRedTeamProvider,
    });

    const context = {
      originalProvider: mockTargetProvider,
      vars: { objective: 'test objective' },
      prompt: { raw: 'test prompt', label: 'test' },
      test: {
        metadata: {
          purpose: 'test purpose',
        },
      },
    };

    mockRedTeamProvider.callApi.mockResolvedValueOnce({
      output: JSON.stringify({
        generatedQuestion: 'test question',
        rationaleBehindJailbreak: 'test rationale',
        lastResponseSummary: 'test summary',
      }),
    });

    mockTargetProvider.callApi.mockResolvedValueOnce({
      output: 'target response',
    });

    mockScoringProvider.callApi.mockResolvedValueOnce({
      output: JSON.stringify({
        value: true,
        metadata: 100,
        rationale: 'test rationale',
      }),
    });

    await provider.callApi('test prompt', context);

    expect(mockRedTeamProvider.callApi).toHaveBeenCalledWith(
      expect.stringContaining('test purpose'),
      expect.any(Object),
    );
  });

  it('should pass purpose parameter to getAttackPrompt', async () => {
    const provider = new CrescendoProvider({
      injectVar: 'objective',
      redteamProvider: mockRedTeamProvider,
    });

    const context = {
      originalProvider: mockTargetProvider,
      vars: { objective: 'test objective' },
      prompt: { raw: 'test prompt', label: 'test' },
      test: {
        metadata: {
          purpose: 'test purpose for attack',
        },
      },
    };

    mockRedTeamProvider.callApi.mockResolvedValueOnce({
      output: JSON.stringify({
        generatedQuestion: 'test question',
        rationaleBehindJailbreak: 'test rationale',
        lastResponseSummary: 'test summary',
      }),
    });

    mockTargetProvider.callApi.mockResolvedValueOnce({
      output: 'target response',
    });

    mockScoringProvider.callApi.mockResolvedValueOnce({
      output: JSON.stringify({
        value: true,
        metadata: 100,
        rationale: 'test rationale',
      }),
    });

    await provider.callApi('test prompt', context);

    expect(mockRedTeamProvider.callApi).toHaveBeenCalledWith(
      expect.stringContaining('test purpose for attack'),
      expect.any(Object),
    );
  });
});
