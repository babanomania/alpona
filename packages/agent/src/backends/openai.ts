import OpenAI from 'openai';
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
import { extractJson } from './live.js';
import {
  binderSystemPrompt,
  binderUserPrompt,
  copySystemPrompt,
  copyUserPrompt,
  plannerSystemPrompt,
  refineSystemPrompt,
  refineUserPrompt,
} from './prompts.js';

export interface OpenAiAgentOptions {
  apiKey?: string;
  /** Point at any OpenAI-compatible server (LM Studio, vLLM, Ollama…). */
  baseUrl?: string;
  plannerModel: string;
  binderModel: string;
  copyModel: string;
  dialect: string;
  /** Injected by tests to fake the transport. */
  fetch?: typeof globalThis.fetch;
}

/**
 * OpenAI reasoning models (gpt-5*, o3, o4…) accept reasoning_effort and
 * JSON mode; local models served behind a compatible API generally do
 * not, and some servers reject unknown parameters outright — so both are
 * gated on the model family rather than sent unconditionally.
 */
function isOpenAiReasoningModel(model: string): boolean {
  return /^(gpt-5|o\d)/.test(model);
}

/**
 * The OpenAI-compatible backend: same stage shape as LiveAgent, speaking
 * the Chat Completions dialect. With no baseUrl it targets the OpenAI
 * API; with one it works against any compatible server (LM Studio runs a
 * local model on http://localhost:1234/v1). Reasoning models spend high
 * effort on binder/refine and minimal on planner/copy, mirroring the
 * fast-model/strong-model split of the Anthropic backend. All outputs
 * pass the same zod gate — a malformed response throws and is handled by
 * the pipeline's heal path.
 */
export class OpenAiAgent implements AgentBackend {
  private readonly client: OpenAI;

  constructor(
    private readonly dictionary: DataDictionary,
    private readonly options: OpenAiAgentOptions,
  ) {
    this.client = new OpenAI({
      // Local OpenAI-compatible servers accept any key; the SDK requires one.
      apiKey: options.apiKey ?? 'local',
      ...(options.baseUrl ? { baseURL: options.baseUrl } : {}),
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
  }

  private async complete(opts: {
    model: string;
    system: string;
    user: string;
    maxTokens: number;
    thinking?: boolean;
  }): Promise<unknown> {
    const reasoning = isOpenAiReasoningModel(opts.model);
    const response = await this.client.chat.completions.create({
      model: opts.model,
      // Thinking models (OpenAI reasoning models, but also local ones like
      // Gemma behind LM Studio) spend completion tokens on reasoning before
      // any visible JSON, so thinking stages get extra headroom.
      max_completion_tokens: opts.thinking ? opts.maxTokens * 2 : opts.maxTokens,
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user },
      ],
      ...(reasoning
        ? {
            // 'low' and 'high' are the two levels every gpt-5 generation
            // accepts ('minimal' and 'none' each exist in only some).
            reasoning_effort: opts.thinking ? ('high' as const) : ('low' as const),
            response_format: { type: 'json_object' as const },
          }
        : {}),
    });
    const message = response.choices[0]?.message;
    // Some OpenAI-compatible servers return thinking-model output in a
    // non-standard reasoning_content field; fall back to it when the
    // standard content is empty rather than failing the stage outright.
    const text =
      message?.content ||
      (message as undefined | { reasoning_content?: string })?.reasoning_content ||
      '';
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
      // Local thinking models reason even for short captions; 1024 (the
      // Anthropic budget) truncates them mid-thought.
      maxTokens: 2048,
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
