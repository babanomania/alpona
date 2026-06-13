import Anthropic from '@anthropic-ai/sdk';
import type { DataDictionary } from '@alpona/core';
import type {
  AgentBackend,
  AnswerOutput,
  AnswerRequest,
  BinderOutput,
  BinderRequest,
  ClassifyOutput,
  CopyOutput,
  CopyRequest,
  PlannerOutput,
  RefineOutput,
  RefineRequest,
} from '../stages.js';
import {
  answerOutputSchema,
  binderOutputSchema,
  classifyOutputSchema,
  copyOutputSchema,
  plannerOutputSchema,
  refineOutputSchema,
} from '../stages.js';
import {
  answerSystemPrompt,
  answerUserPrompt,
  askSystemPrompt,
  askUserPrompt,
  binderSystemPrompt,
  binderUserPrompt,
  classifySystemPrompt,
  copySystemPrompt,
  copyUserPrompt,
  plannerSystemPrompt,
  refineSystemPrompt,
  refineUserPrompt,
} from '../prompts.js';
import { extractJson } from '../json.js';

export interface AnthropicAgentOptions {
  apiKey?: string;
  plannerModel: string;
  binderModel: string;
  copyModel: string;
  dialect: string;
}

/**
 * The Anthropic backend: one API call per pipeline stage. Classify,
 * planner, copy, and answer run on a fast model; binders run on a strong
 * model with adaptive thinking. All outputs pass through zod before
 * anything downstream trusts them — a malformed response throws and is
 * retried by the graph's heal path, never patched up silently here.
 */
export class AnthropicAgent implements AgentBackend {
  private readonly client: Anthropic;

  constructor(
    private readonly dictionary: DataDictionary,
    private readonly options: AnthropicAgentOptions,
  ) {
    this.client = new Anthropic(options.apiKey ? { apiKey: options.apiKey } : {});
  }

  private async complete(opts: {
    model: string;
    system: string;
    user: string;
    maxTokens: number;
    thinking?: boolean;
  }): Promise<unknown> {
    const response = await this.client.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens,
      system: [{ type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: opts.user }],
      ...(opts.thinking ? { thinking: { type: 'adaptive' as const } } : {}),
    });
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');
    return extractJson(text);
  }

  async classify(userPrompt: string): Promise<ClassifyOutput> {
    const raw = await this.complete({
      model: this.options.copyModel,
      system: classifySystemPrompt(),
      user: userPrompt,
      maxTokens: 128,
    });
    return classifyOutputSchema.parse(raw);
  }

  async plan(userPrompt: string, dictionary?: DataDictionary): Promise<PlannerOutput> {
    const raw = await this.complete({
      model: this.options.plannerModel,
      system: plannerSystemPrompt(dictionary ?? this.dictionary),
      user: userPrompt,
      maxTokens: 4096,
    });
    return plannerOutputSchema.parse(raw);
  }

  async bind(request: BinderRequest): Promise<BinderOutput> {
    const grounding = request.dictionary ?? this.dictionary;
    const ask = request.intent === 'ask';
    const raw = await this.complete({
      model: this.options.binderModel,
      system: ask
        ? askSystemPrompt(grounding, this.options.dialect)
        : binderSystemPrompt(grounding, this.options.dialect),
      user: ask ? askUserPrompt(request.userPrompt, request.feedback) : binderUserPrompt(request),
      maxTokens: 8192,
      thinking: true,
    });
    return binderOutputSchema.parse(raw);
  }

  async answer(request: AnswerRequest): Promise<AnswerOutput> {
    const raw = await this.complete({
      model: this.options.copyModel,
      system: answerSystemPrompt(),
      user: answerUserPrompt(request),
      maxTokens: 512,
    });
    return answerOutputSchema.parse(raw);
  }

  async copy(request: CopyRequest): Promise<CopyOutput> {
    const raw = await this.complete({
      model: this.options.copyModel,
      system: copySystemPrompt(),
      user: copyUserPrompt(request),
      maxTokens: 1024,
    });
    return copyOutputSchema.parse(raw);
  }

  async refine(request: RefineRequest): Promise<RefineOutput> {
    const raw = await this.complete({
      model: this.options.binderModel,
      system: refineSystemPrompt(this.dictionary),
      user: refineUserPrompt(request.spec, request.prompt, request.targetWidgetId),
      maxTokens: 8192,
      thinking: true,
    });
    return refineOutputSchema.parse(raw);
  }
}
