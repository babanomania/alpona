/**
 * @alpona/agent — the framework-agnostic surface. LangGraph stays an
 * implementation detail of graph.ts; nothing here re-exports its types.
 */

export {
  AlponaAgent,
  type AlponaAgentOptions,
  type EmitEvent,
  type QueryExecutor,
} from './graph.js';

export { AnthropicAgent, type AnthropicAgentOptions } from './backends/anthropic.js';
export { OpenAiAgent, type OpenAiAgentOptions } from './backends/openai.js';
export { MockAgent } from './backends/mock.js';

export {
  retrieveDictionary,
  type RetrievalOptions,
  type RetrievalResult,
} from './retrieval/index.js';

export { extractJson } from './json.js';

export type {
  AgentBackend,
  Intent,
  ClassifyOutput,
  PlannedWidget,
  PlannerOutput,
  BinderRequest,
  BinderOutput,
  CopyRequest,
  CopyOutput,
  AnswerRequest,
  AnswerOutput,
  RefineRequest,
  RefineOutput,
} from './stages.js';
