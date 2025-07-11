import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  DerivedMetric,
  EnvOverrides,
  EvaluateOptions,
  EvaluateTestSuiteWithEvaluateOptions,
  ProviderOptions,
  TestCase,
  UnifiedConfig,
  Scenario,
} from '../../../types';

export interface State {
  env: EnvOverrides;
  testCases: TestCase[];
  description: string;
  providers: ProviderOptions[];
  prompts: any[];
  defaultTest: TestCase | string;
  derivedMetrics: DerivedMetric[];
  evaluateOptions: EvaluateOptions;
  scenarios: Scenario[];
  extensions: string[];
  setEnv: (env: EnvOverrides) => void;
  setTestCases: (testCases: TestCase[]) => void;
  setDescription: (description: string) => void;
  setProviders: (providers: ProviderOptions[]) => void;
  setPrompts: (prompts: any[]) => void;
  setDefaultTest: (testCase: TestCase | string) => void;
  setDerivedMetrics: (derivedMetrics: DerivedMetric[]) => void;
  setEvaluateOptions: (options: EvaluateOptions) => void;
  setScenarios: (scenarios: Scenario[]) => void;
  setStateFromConfig: (config: Partial<UnifiedConfig>) => void;
  getTestSuite: () => EvaluateTestSuiteWithEvaluateOptions;
  setExtensions: (extensions: string[]) => void;
}

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      env: {},
      testCases: [],
      description: '',
      providers: [],
      prompts: [],
      extensions: [],
      defaultTest: {},
      derivedMetrics: [],
      evaluateOptions: {},
      scenarios: [],
      setEnv: (env) => set({ env }),
      setTestCases: (testCases) => set({ testCases }),
      setDescription: (description) => set({ description }),
      setProviders: (providers) => set({ providers }),
      setPrompts: (prompts) => set({ prompts }),
      setDefaultTest: (testCase) => set({ defaultTest: testCase }),
      setDerivedMetrics: (derivedMetrics) => set({ derivedMetrics }),
      setEvaluateOptions: (options) => set({ evaluateOptions: options }),
      setScenarios: (scenarios) => set({ scenarios }),
      setExtensions: (extensions) => set({ extensions }),
      setStateFromConfig: (config: Partial<UnifiedConfig>) => {
        const updates: Partial<State> = {};
        if (config.description) {
          updates.description = config.description || '';
        }
        if (config.tests) {
          updates.testCases = config.tests as TestCase[];
        }
        if (config.providers) {
          updates.providers = config.providers as ProviderOptions[];
        }
        if (config.prompts) {
          if (typeof config.prompts === 'string') {
            updates.prompts = [config.prompts];
          } else if (Array.isArray(config.prompts)) {
            updates.prompts = config.prompts;
          } else {
            console.warn('Invalid prompts config', config.prompts);
          }
        }
        if (config.defaultTest) {
          updates.defaultTest = config.defaultTest;
        }
        if (config.derivedMetrics) {
          updates.derivedMetrics = config.derivedMetrics;
        }
        if (config.evaluateOptions) {
          updates.evaluateOptions = config.evaluateOptions;
        }
        if (config.scenarios) {
          updates.scenarios = config.scenarios as Scenario[];
        }
        if (config.extensions) {
          updates.extensions = config.extensions;
        }
        set(updates);
      },
      getTestSuite: () => {
        const {
          description,
          env,
          extensions,
          prompts,
          providers,
          scenarios,
          testCases,
          evaluateOptions,
          defaultTest,
          derivedMetrics,
        } = get();
        return {
          description,
          env,
          extensions,
          prompts,
          providers,
          scenarios,
          tests: testCases,
          evaluateOptions,
          defaultTest,
          derivedMetrics,
        };
      },
    }),
    {
      name: 'promptfoo',
      skipHydration: true,
    },
  ),
);
