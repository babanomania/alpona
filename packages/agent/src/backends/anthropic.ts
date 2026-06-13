import Anthropic from '@anthropic-ai/sdk';
import type { DataDictionary } from '@alpona/core';
import type {
  AgentBackend,
  BinderOutput,
  BinderRequest,
  CopyOutput,
  CopyRequest,
  PlannerOutput,
  RefineOutput,
  RefineRequest,
} from './stages.js';
import {
  binderOutputSchema,
  copyOutputSchema,
  plannerOutputSchema,
  refineOutputSchema,
} from './stages.js';
import {
  binderSystemPrompt,
  binderUserPrompt,
  copySystemPrompt,
  copyUserPrompt,
  plannerSystemPrompt,
  refineSystemPrompt,
  refineUserPrompt,
} from './prompts.js';

export interface LiveAgentOptions {
  apiKey?: string;
  plannerModel: string;
  binderModel: string;
  copyModel: string;
  dialect: string;
}

/** Extracts the first JSON object from a model response. */
export function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no JSON object in model response');
  return JSON.parse(text.slice(start, end + 1));
}

/**
 * The live backend: one Anthropic call per pipeline stage. Planner and
 * copy run on a fast model; binders run on a strong model with adaptive
 * thinking. All outputs pass through zod before anything downstream
 * trusts them — a malformed response throws and is retried by the
 * pipeline's heal path, never patched up silently here.
 */
export class LiveAgent implements AgentBackend {
  private readonly client: Anthropic;

  constructor(
    private readonly dictionary: DataDictionary,
    private readonly options: LiveAgentOptions,
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

  async plan(userPrompt: string): Promise<PlannerOutput> {
    const raw = await this.complete({
      model: this.options.plannerModel,
      system: plannerSystemPrompt(this.dictionary),
      user: userPrompt,
      maxTokens: 4096,
    });
    return plannerOutputSchema.parse(raw);
  }

  async bind(request: BinderRequest): Promise<BinderOutput> {
    const raw = await this.complete({
      model: this.options.binderModel,
      system: binderSystemPrompt(this.dictionary, this.options.dialect),
      user: binderUserPrompt(request),
      maxTokens: 8192,
      thinking: true,
    });
    return binderOutputSchema.parse(raw);
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
